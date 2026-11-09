-- Security and money-integrity hardening.
--
--  1. Subscription webhooks: every RevenueCat event is recorded once (unique
--     event id), applied in one transaction, and older events can't roll a
--     newer plan state back.
--  2. AI receipt scans: the monthly quota is reserved atomically before the AI
--     call and refunded if it fails; retries with the same request id are free.
--  3. Cash kitty: every move locks the kitty row, so two payouts (or a payout
--     and a handover) can't both spend the same cash; closed kitties are
--     frozen; retries with the same client id don't double-record.
--  4. Function privileges: nothing is callable without signing in except the
--     invite preview; internal helpers and trigger functions aren't callable
--     by app users at all.
--  5. Storage: size and type limits on every bucket, image-only file names,
--     and a per-user upload rate limit.
--  6. Locations: hidden as soon as a trip ends and deleted at that moment, even
--     where the hourly clean-up job (pg_cron) isn't available.
--
-- Forward-only and safe to re-run on a database that already has the earlier
-- migrations: no data is deleted except stale locations of ended trips.

-- ---------------------------------------------------------------------------
-- 0. Functions created from now on are not callable by everyone by default.
--    (Grant each client-facing function explicitly.)
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- ---------------------------------------------------------------------------
-- 1. Subscription events (RevenueCat)
-- ---------------------------------------------------------------------------
alter table public.accounts
  add column if not exists plan_event_at timestamptz,
  add column if not exists plan_product_id text,
  add column if not exists plan_store text;

create table if not exists public.subscription_events (
  id text primary key check (char_length(id) between 1 and 200),
  user_id uuid references public.profiles (id) on delete set null,
  type text not null,
  event_at timestamptz not null,
  environment text,
  product_id text,
  entitlement_ids text[],
  expires_at timestamptz,
  outcome text not null,
  received_at timestamptz not null default now()
);
create index if not exists subscription_events_user_idx on public.subscription_events (user_id, event_at desc);
alter table public.subscription_events enable row level security;
revoke all on public.subscription_events from public, anon, authenticated;

-- Applies one webhook event. Called only by the webhook (service role).
-- Returns {"outcome": applied | duplicate | stale | ignored_* , "user_id": ...}.
create or replace function public.apply_subscription_event(
  p_event jsonb,
  p_entitlement text default 'pro',
  p_allow_sandbox boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := p_event ->> 'id';
  v_type text := upper(coalesce(p_event ->> 'type', ''));
  v_env text := upper(coalesce(nullif(p_event ->> 'environment', ''), 'PRODUCTION'));
  v_at timestamptz;
  v_exp timestamptz;
  v_ents text[];
  v_user uuid;
  v_candidate text;
  v_acc public.accounts%rowtype;
  v_outcome text;
  v_from uuid;
  v_to uuid;
  v_moved_exp timestamptz;
  v_moved boolean := false;
begin
  if jsonb_typeof(p_event) is distinct from 'object' then
    raise exception 'Malformed event.' using errcode = '22023';
  end if;
  if v_id is null or v_id !~ '^[A-Za-z0-9_.:-]{1,200}$' then
    raise exception 'Malformed event id.' using errcode = '22023';
  end if;
  if v_type !~ '^[A-Z_]{1,60}$' then
    raise exception 'Malformed event type.' using errcode = '22023';
  end if;
  if coalesce(p_event ->> 'event_timestamp_ms', '') !~ '^[0-9]{1,15}$' then
    raise exception 'Malformed event time.' using errcode = '22023';
  end if;
  v_at := to_timestamp((p_event ->> 'event_timestamp_ms')::bigint / 1000.0);
  if coalesce(p_event ->> 'expiration_at_ms', '') ~ '^[0-9]{1,15}$' then
    v_exp := to_timestamp((p_event ->> 'expiration_at_ms')::bigint / 1000.0);
  end if;
  if jsonb_typeof(p_event -> 'entitlement_ids') = 'array' then
    select array_agg(e) into v_ents from jsonb_array_elements_text(p_event -> 'entitlement_ids') e;
  elsif nullif(p_event ->> 'entitlement_id', '') is not null then
    v_ents := array[p_event ->> 'entitlement_id'];
  end if;

  -- The Supabase user id is the app user id, the original id or an alias.
  for v_candidate in
    select x from (
      select p_event ->> 'app_user_id' as x, 1 as o
      union all select p_event ->> 'original_app_user_id', 2
      union all select a, 3 from jsonb_array_elements_text(
        case when jsonb_typeof(p_event -> 'aliases') = 'array' then p_event -> 'aliases' else '[]'::jsonb end) a
    ) c order by o
  loop
    v_user := public.try_uuid(v_candidate);
    exit when v_user is not null and exists (select 1 from public.profiles where id = v_user);
    v_user := null;
  end loop;

  -- Record the event first. A duplicate (or a copy delivered at the same time)
  -- hits the primary key and changes nothing.
  insert into public.subscription_events (id, user_id, type, event_at, environment, product_id, entitlement_ids, expires_at, outcome)
  values (v_id, v_user, v_type, v_at, left(v_env, 20), left(p_event ->> 'product_id', 200), v_ents, v_exp, 'processing')
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  if v_env = 'SANDBOX' and not p_allow_sandbox then
    v_outcome := 'ignored_sandbox';
  elsif v_type = 'TEST' then
    v_outcome := 'ignored_test';
  elsif v_type = 'TRANSFER' then
    -- The subscription moved between app users: the old ones lose Pro and the
    -- new one takes over the latest expiry the old ones had.
    for v_from in
      select distinct p.id from jsonb_array_elements_text(
        case when jsonb_typeof(p_event -> 'transferred_from') = 'array' then p_event -> 'transferred_from' else '[]'::jsonb end) f
      join public.profiles p on p.id = public.try_uuid(f)
      order by p.id
    loop
      select * into v_acc from public.accounts where user_id = v_from for update;
      if found and (v_acc.plan_event_at is null or v_at >= v_acc.plan_event_at) then
        if v_acc.plan = 'pro' then
          v_moved := true;
          v_moved_exp := case
            when v_acc.plan_expires_at is null or v_moved_exp = 'infinity' then 'infinity'::timestamptz
            else greatest(v_moved_exp, v_acc.plan_expires_at) end;
        end if;
        update public.accounts
          set plan = 'free', plan_expires_at = null, plan_event_at = v_at, updated_at = now()
          where user_id = v_from;
      end if;
    end loop;
    select p.id into v_to from jsonb_array_elements_text(
      case when jsonb_typeof(p_event -> 'transferred_to') = 'array' then p_event -> 'transferred_to' else '[]'::jsonb end) t
      join public.profiles p on p.id = public.try_uuid(t)
      limit 1;
    if v_to is not null and v_moved then
      select * into v_acc from public.accounts where user_id = v_to for update;
      if found and (v_acc.plan_event_at is null or v_at >= v_acc.plan_event_at) then
        update public.accounts
          set plan = 'pro',
              plan_expires_at = case when v_moved_exp = 'infinity' then null else v_moved_exp end,
              plan_event_at = v_at, updated_at = now()
          where user_id = v_to;
      end if;
    end if;
    v_user := coalesce(v_to, v_user);
    v_outcome := 'applied';
  elsif v_ents is not null and not (p_entitlement = any (v_ents)) then
    v_outcome := 'ignored_entitlement';
  elsif v_user is null then
    v_outcome := 'ignored_no_user';
  else
    select * into v_acc from public.accounts where user_id = v_user for update;
    if not found then
      insert into public.accounts (user_id) values (v_user) on conflict (user_id) do nothing;
      select * into v_acc from public.accounts where user_id = v_user for update;
    end if;

    if v_acc.plan_event_at is not null and v_at < v_acc.plan_event_at then
      -- Older than what we already applied (retries and delays reorder events).
      v_outcome := 'stale';
    elsif v_type in ('INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'NON_RENEWING_PURCHASE',
                     'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT', 'REFUND_REVERSED') then
      update public.accounts
        set plan = 'pro', plan_expires_at = v_exp, plan_event_at = v_at,
            plan_product_id = left(p_event ->> 'product_id', 200), plan_store = left(p_event ->> 'store', 40),
            updated_at = now()
        where user_id = v_user;
      v_outcome := 'applied';
    elsif v_type = 'CANCELLATION' then
      if upper(coalesce(p_event ->> 'cancel_reason', '')) = 'CUSTOMER_SUPPORT' then
        -- Refunded: Pro ends now.
        update public.accounts
          set plan = 'free', plan_expires_at = null, plan_event_at = v_at, updated_at = now()
          where user_id = v_user;
      else
        -- Auto-renew turned off: still Pro until the paid period ends.
        update public.accounts
          set plan = 'pro', plan_expires_at = coalesce(v_exp, plan_expires_at), plan_event_at = v_at, updated_at = now()
          where user_id = v_user;
      end if;
      v_outcome := 'applied';
    elsif v_type = 'BILLING_ISSUE' then
      -- Keeps Pro through the store's grace period, if any.
      update public.accounts
        set plan_expires_at = case when plan = 'pro' then coalesce(v_exp, plan_expires_at) else plan_expires_at end,
            plan_event_at = v_at, updated_at = now()
        where user_id = v_user;
      v_outcome := 'applied';
    elsif v_type = 'EXPIRATION' then
      update public.accounts
        set plan = 'free', plan_expires_at = null, plan_event_at = v_at, updated_at = now()
        where user_id = v_user;
      v_outcome := 'applied';
    elsif v_type = 'SUBSCRIPTION_PAUSED' then
      -- Pro continues until the EXPIRATION event that follows.
      v_outcome := 'recorded';
    else
      v_outcome := 'ignored_type';
    end if;
  end if;

  update public.subscription_events set outcome = v_outcome, user_id = v_user where id = v_id;
  return jsonb_build_object('outcome', v_outcome, 'user_id', v_user);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. AI receipt scans: reserve -> finish, or release (refund)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_scan_requests (
  id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  path text not null,
  period text not null,
  status text not null check (status in ('reserved', 'done', 'released')),
  -- The read receipt, kept for a day so a retry after a timeout gets it back.
  result jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ai_scan_requests_user_idx on public.ai_scan_requests (user_id, created_at desc);
alter table public.ai_scan_requests enable row level security;
revoke all on public.ai_scan_requests from public, anon, authenticated;

create or replace function public.ai_scan_period()
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(now() at time zone 'utc', 'YYYY-MM')
$$;

-- Reserves one scan from this month's quota, atomically (the account row is
-- locked, so two requests for the last scan can't both get it).
-- Returns {"status": reserved | done | in_progress | pro_required | not_member
--                    | quota_exceeded | rate_limited | bad_request, ...}.
create or replace function public.reserve_ai_scan(
  p_user uuid,
  p_request uuid,
  p_trip uuid,
  p_path text,
  p_limit int,
  p_per_minute int default 6
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc public.accounts%rowtype;
  v_req public.ai_scan_requests%rowtype;
  v_period text := public.ai_scan_period();
  v_used int;
  v_recent int;
  v_refunds int;
begin
  if p_user is null or p_request is null or p_trip is null or coalesce(p_limit, -1) < 0 then
    return jsonb_build_object('status', 'bad_request');
  end if;
  if p_path is null or p_path !~ ('^' || p_trip::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$') then
    return jsonb_build_object('status', 'bad_request');
  end if;

  select * into v_acc from public.accounts where user_id = p_user for update;
  if not found or v_acc.plan <> 'pro' or (v_acc.plan_expires_at is not null and v_acc.plan_expires_at <= now()) then
    return jsonb_build_object('status', 'pro_required');
  end if;
  if not public.is_member_of(p_trip, p_user) then
    return jsonb_build_object('status', 'not_member');
  end if;

  v_used := case when v_acc.ai_scans_period = v_period then v_acc.ai_scans_used else 0 end;

  -- Reservations whose function died without finishing are refunded.
  with stale as (
    update public.ai_scan_requests r set status = 'released', finished_at = now()
    where r.user_id = p_user and r.status = 'reserved' and r.created_at < now() - interval '10 minutes'
    returning r.period
  )
  select count(*) filter (where period = v_period) into v_refunds from stale;
  v_used := greatest(0, v_used - v_refunds);
  -- Read receipts are only kept for a day; old request rows for 90 days.
  update public.ai_scan_requests set result = null
    where user_id = p_user and result is not null and finished_at < now() - interval '1 day';
  delete from public.ai_scan_requests where user_id = p_user and created_at < now() - interval '90 days';

  select * into v_req from public.ai_scan_requests where id = p_request;
  if found then
    if v_req.user_id <> p_user or v_req.trip_id <> p_trip or v_req.path <> p_path then
      return jsonb_build_object('status', 'bad_request');
    end if;
    if v_req.status = 'done' and v_req.result is not null then
      -- A retry of a scan that already worked: same answer, no extra charge.
      update public.accounts set ai_scans_used = v_used, ai_scans_period = v_period where user_id = p_user;
      return jsonb_build_object('status', 'done', 'result', v_req.result, 'scans_left', greatest(0, p_limit - v_used));
    end if;
    if v_req.status = 'reserved' then
      update public.accounts set ai_scans_used = v_used, ai_scans_period = v_period where user_id = p_user;
      return jsonb_build_object('status', 'in_progress');
    end if;
  end if;

  if v_used >= p_limit then
    update public.accounts set ai_scans_used = v_used, ai_scans_period = v_period where user_id = p_user;
    return jsonb_build_object('status', 'quota_exceeded', 'limit', p_limit);
  end if;
  select count(*) into v_recent from public.ai_scan_requests
    where user_id = p_user and created_at > now() - interval '1 minute';
  if v_recent >= greatest(coalesce(p_per_minute, 6), 1) then
    update public.accounts set ai_scans_used = v_used, ai_scans_period = v_period where user_id = p_user;
    return jsonb_build_object('status', 'rate_limited');
  end if;

  update public.accounts
    set ai_scans_used = v_used + 1, ai_scans_period = v_period, updated_at = now()
    where user_id = p_user;
  insert into public.ai_scan_requests (id, user_id, trip_id, path, period, status, created_at)
  values (p_request, p_user, p_trip, p_path, v_period, 'reserved', now())
  on conflict (id) do update
    set status = 'reserved', period = excluded.period, result = null, created_at = now(), finished_at = null;
  return jsonb_build_object('status', 'reserved', 'scans_left', p_limit - v_used - 1);
end;
$$;

-- The AI read the receipt: keep the reservation as a used scan.
create or replace function public.finish_ai_scan(p_user uuid, p_request uuid, p_result jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_scan_requests
    set status = 'done', result = p_result, finished_at = now()
    where id = p_request and user_id = p_user and status = 'reserved';
  return found;
end;
$$;

-- The AI call failed: give the scan back.
create or replace function public.release_ai_scan(p_user uuid, p_request uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period text;
begin
  -- Same lock order as reserve_ai_scan (account, then request).
  perform 1 from public.accounts where user_id = p_user for update;
  update public.ai_scan_requests
    set status = 'released', finished_at = now()
    where id = p_request and user_id = p_user and status = 'reserved'
    returning period into v_period;
  if not found then
    return false;
  end if;
  update public.accounts
    set ai_scans_used = greatest(0, ai_scans_used - 1), updated_at = now()
    where user_id = p_user and ai_scans_period = v_period;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Cash kitty: locks, frozen when closed, bounded amounts, safe retries
-- ---------------------------------------------------------------------------
alter table public.settlements add column if not exists client_id uuid unique;
alter table public.kitty_own_cash add column if not exists client_id uuid unique;

-- Largest single amount accepted (in minor units: 10 billion in a 2-decimal currency).
create or replace function public.max_money_minor()
returns bigint
language sql
immutable
set search_path = ''
as $$
  select 1000000000000::bigint
$$;

drop function if exists public.kitty_add_cash(uuid, uuid, bigint, text);
create function public.kitty_add_cash(
  p_kitty uuid, p_from uuid, p_amount bigint, p_note text default null, p_client_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_k public.trip_kitties%rowtype;
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in first.' using errcode = '28000';
  end if;
  select * into v_k from public.trip_kitties where id = p_kitty for update;
  if not found or not public.is_trip_member(v_k.trip_id) then
    raise exception 'Kitty not found.' using errcode = 'P0002';
  end if;
  -- A retry of a move that already went through returns the same record.
  if p_client_id is not null then
    select s.id into v_id from public.settlements s
      where s.client_id = p_client_id and s.kitty_id = p_kitty and s.kitty_role = 'contribution'
        and s.from_user = p_from and s.amount_base_minor = p_amount;
    if found then return v_id; end if;
    select o.id into v_id from public.kitty_own_cash o
      where o.client_id = p_client_id and o.kitty_id = p_kitty and o.user_id = p_from and o.amount_base_minor = p_amount;
    if found then return v_id; end if;
    if exists (select 1 from public.settlements where client_id = p_client_id)
       or exists (select 1 from public.kitty_own_cash where client_id = p_client_id) then
      raise exception 'This request was already used for something else.' using errcode = '22023';
    end if;
  end if;
  if v_k.closed_at is not null then
    raise exception 'This kitty is closed.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Enter an amount.' using errcode = '22023';
  end if;
  if p_amount > public.max_money_minor() then
    raise exception 'That amount is too large.' using errcode = '22023';
  end if;
  if not public.is_member_of(v_k.trip_id, p_from) then
    raise exception 'They must be in the trip.' using errcode = '22023';
  end if;

  if p_from = v_k.holder_id then
    if v_uid <> v_k.holder_id then
      raise exception 'Only the holder can add their own cash.' using errcode = '42501';
    end if;
    insert into public.kitty_own_cash (kitty_id, user_id, amount_base_minor, note, client_id)
    values (p_kitty, p_from, p_amount, left(p_note, 300), p_client_id)
    returning id into v_id;
  elsif v_uid = v_k.holder_id or v_uid = p_from then
    insert into public.settlements (trip_id, from_user, to_user, amount_base_minor, method, note, status, responded_at, kitty_id, kitty_role, client_id)
    values (v_k.trip_id, p_from, v_k.holder_id, p_amount, 'Cash kitty', left(p_note, 300),
            case when v_uid = v_k.holder_id then 'confirmed' else 'paid' end::public.settlement_status,
            case when v_uid = v_k.holder_id then now() end, p_kitty, 'contribution', p_client_id)
    returning id into v_id;
  else
    raise exception 'Only the holder or the person putting cash in can record it.' using errcode = '42501';
  end if;
  return v_id;
end;
$$;

create or replace function public.kitty_handover(p_kitty uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_k public.trip_kitties%rowtype;
  v_cash bigint;
begin
  select * into v_k from public.trip_kitties where id = p_kitty for update;
  if not found or not public.is_trip_member(v_k.trip_id) then
    raise exception 'Kitty not found.' using errcode = 'P0002';
  end if;
  if v_k.holder_id <> auth.uid() then
    raise exception 'Only the person holding the kitty can hand it over.' using errcode = '42501';
  end if;
  if v_k.closed_at is not null then
    raise exception 'This kitty is closed.' using errcode = '22023';
  end if;
  if p_to is null or p_to = v_k.holder_id or not public.is_member_of(v_k.trip_id, p_to) then
    raise exception 'Choose someone else in the trip.' using errcode = '22023';
  end if;
  v_cash := public.kitty_cash(p_kitty);
  if v_cash > 0 then
    insert into public.settlements (trip_id, from_user, to_user, amount_base_minor, method, status, responded_at, kitty_id, kitty_role)
    values (v_k.trip_id, v_k.holder_id, p_to, v_cash, 'Cash kitty', 'confirmed', now(), p_kitty, 'handover');
  end if;
  update public.trip_kitties set holder_id = p_to where id = p_kitty;
  perform public.notify(
    p_to, v_k.trip_id, 'kitty_holder', (select name from public.trips where id = v_k.trip_id),
    public.display_name_of(auth.uid()) || ' handed you the "' || v_k.name || '" kitty'
      || case when v_cash > 0 then ' (' || public.format_minor(v_cash, (select base_currency from public.trips where id = v_k.trip_id)) || ' in cash)' else '' end,
    jsonb_build_object('trip_id', v_k.trip_id, 'kitty_id', p_kitty)
  );
end;
$$;

drop function if exists public.kitty_payout(uuid, uuid, bigint, text);
create function public.kitty_payout(
  p_kitty uuid, p_to uuid, p_amount bigint, p_note text default null, p_client_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_k public.trip_kitties%rowtype;
  v_id uuid;
begin
  -- The lock makes the balance check and the payout one step: a second payout,
  -- a handover or a kitty bill waits here until this one is committed.
  select * into v_k from public.trip_kitties where id = p_kitty for update;
  if not found or not public.is_trip_member(v_k.trip_id) then
    raise exception 'Kitty not found.' using errcode = 'P0002';
  end if;
  if p_client_id is not null then
    select s.id into v_id from public.settlements s
      where s.client_id = p_client_id and s.kitty_id = p_kitty and s.kitty_role = 'payout'
        and s.to_user = p_to and s.amount_base_minor = p_amount;
    if found then return v_id; end if;
    if exists (select 1 from public.settlements where client_id = p_client_id) then
      raise exception 'This request was already used for something else.' using errcode = '22023';
    end if;
  end if;
  if v_k.holder_id <> auth.uid() then
    raise exception 'Only the person holding the kitty can give cash back.' using errcode = '42501';
  end if;
  if v_k.closed_at is not null then
    raise exception 'This kitty is closed.' using errcode = '22023';
  end if;
  if p_to is null or p_to = v_k.holder_id or not public.is_member_of(v_k.trip_id, p_to) then
    raise exception 'Choose someone else in the trip.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Enter an amount.' using errcode = '22023';
  end if;
  if p_amount > public.max_money_minor() or p_amount > public.kitty_cash(p_kitty) then
    raise exception 'There isn''t that much cash in the kitty.' using errcode = '22023';
  end if;
  insert into public.settlements (trip_id, from_user, to_user, amount_base_minor, method, note, status, kitty_id, kitty_role, client_id)
  values (v_k.trip_id, v_k.holder_id, p_to, p_amount, 'Cash kitty', left(p_note, 300), 'paid', p_kitty, 'payout', p_client_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- Bills paid from a kitty take the same lock, and new kitty spending is
-- re-checked under it (save_bill checks first, but without the lock).
create or replace function public.guard_kitty_bill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_k public.trip_kitties%rowtype;
begin
  if new.kitty_id is null then
    return new;
  end if;
  select * into v_k from public.trip_kitties where id = new.kitty_id for update;
  if not found or v_k.trip_id <> new.trip_id then
    raise exception 'That kitty is not in this trip.' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' or new.kitty_id is distinct from old.kitty_id or new.paid_by is distinct from old.paid_by then
    if v_k.closed_at is not null then
      raise exception 'This kitty is closed.' using errcode = '22023';
    end if;
    if new.paid_by <> v_k.holder_id then
      raise exception 'Bills from the kitty are paid by the person holding it.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists bills_kitty_guard on public.bills;
create trigger bills_kitty_guard before insert or update on public.bills
  for each row execute function public.guard_kitty_bill();

-- Undoing or disputing a kitty move takes the lock too. Undoing a cash
-- contribution that has already been spent or given back is refused.
create or replace function public.guard_kitty_settlement_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sign int;
  v_before bigint;
  v_after bigint;
begin
  -- Rows removed because the whole trip is being deleted (cascade) pass.
  if old.kitty_id is null or pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  perform 1 from public.trip_kitties where id = old.kitty_id for update;
  if tg_op = 'UPDATE' and (new.kitty_id is distinct from old.kitty_id or new.kitty_role is distinct from old.kitty_role
                           or new.amount_base_minor <> old.amount_base_minor) then
    raise exception 'Kitty records can''t be changed.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if old.kitty_role = 'handover' then
      raise exception 'A handover can''t be undone.' using errcode = '42501';
    end if;
    v_sign := case old.kitty_role when 'contribution' then 1 when 'payout' then -1 else 0 end;
    v_before := case when old.status <> 'disputed' then old.amount_base_minor else 0 end * v_sign;
    if v_before > 0 and public.kitty_cash(old.kitty_id) - v_before < 0 then
      raise exception 'Some of this cash has already been spent or given back, so it can''t be undone.' using errcode = '22023';
    end if;
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists settlements_kitty_guard on public.settlements;
create trigger settlements_kitty_guard before update or delete on public.settlements
  for each row execute function public.guard_kitty_settlement_change();

-- ---------------------------------------------------------------------------
-- 4. Locations: gone the moment a trip ends
-- ---------------------------------------------------------------------------
drop policy if exists "locations: members can read" on public.member_locations;
create policy "locations: members can read"
  on public.member_locations for select to authenticated
  using (public.is_trip_member(trip_id) and public.trip_is_active(trip_id));

create or replace function public.handle_trip_ended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.ended_at is null and new.ended_at is not null then
    delete from public.member_locations where trip_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_trip_ended on public.trips;
create trigger on_trip_ended after update of ended_at on public.trips
  for each row execute function public.handle_trip_ended();

-- ---------------------------------------------------------------------------
-- 5. Storage: limits and image-only names
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets
      set file_size_limit = 8 * 1024 * 1024,
          allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
      where id in ('receipts', 'trip-photos');
    update storage.buckets
      set file_size_limit = 2 * 1024 * 1024,
          allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
      where id = 'avatars';
  end if;
end;
$$;

-- At most 30 uploads in 10 minutes per person (receipts, photos and avatars together).
create or replace function public.can_upload_now()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    select count(*) from storage.objects o
    where o.owner = auth.uid() and o.created_at > now() - interval '10 minutes'
  ) < 30
$$;

drop policy if exists "receipts: trip members can upload" on storage.objects;
create policy "receipts: trip members can upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and name ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$'
    and public.is_trip_member(public.try_uuid((storage.foldername(name))[1]))
    and public.can_upload_now()
  );
drop policy if exists "trip-photos: trip members can upload" on storage.objects;
create policy "trip-photos: trip members can upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'trip-photos'
    and name ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$'
    and public.is_trip_member(public.try_uuid((storage.foldername(name))[1]))
    and public.can_upload_now()
  );
drop policy if exists "avatars: upload own" on storage.objects;
create policy "avatars: upload own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$'
    and public.can_upload_now()
  );
drop policy if exists "avatars: replace own" on storage.objects;
create policy "avatars: replace own"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and owner = auth.uid())
  with check (bucket_id = 'avatars' and owner = auth.uid() and (storage.foldername(name))[1] = auth.uid()::text);
-- Removed members lose access to old receipts' rows at once (read policy checks
-- current membership); uploaders can still delete only their own files.

-- ---------------------------------------------------------------------------
-- 6. Who may call which function
-- ---------------------------------------------------------------------------
-- Nothing is callable without a session, except the invite-link preview.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;

  -- Trigger functions run as triggers only.
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from authenticated', r.sig);
  end loop;
end;
$$;

grant execute on function public.trip_preview(text) to anon, authenticated;

-- Internal helpers: used inside other functions only (they'd let a signed-in
-- user ask "is X in trip Y?" or "what is X's name?" about anyone).
revoke execute on function public.is_member_of(uuid, uuid) from authenticated;
revoke execute on function public.display_name_of(uuid) from authenticated;
revoke execute on function public.kitty_cash(uuid) from authenticated;
revoke execute on function public.ai_scan_period() from authenticated;

-- Server-only (service role).
revoke execute on function public.apply_subscription_event(jsonb, text, boolean) from authenticated;
revoke execute on function public.reserve_ai_scan(uuid, uuid, uuid, text, int, int) from authenticated;
revoke execute on function public.finish_ai_scan(uuid, uuid, jsonb) from authenticated;
revoke execute on function public.release_ai_scan(uuid, uuid) from authenticated;
grant execute on function public.apply_subscription_event(jsonb, text, boolean) to service_role;
grant execute on function public.reserve_ai_scan(uuid, uuid, uuid, text, int, int) to service_role;
grant execute on function public.finish_ai_scan(uuid, uuid, jsonb) to service_role;
grant execute on function public.release_ai_scan(uuid, uuid) to service_role;

-- App functions (each checks auth.uid() and trip membership itself).
grant execute on function public.kitty_add_cash(uuid, uuid, bigint, text, uuid) to authenticated;
grant execute on function public.kitty_payout(uuid, uuid, bigint, text, uuid) to authenticated;
-- Pure helpers only used inside other functions.
revoke execute on function public.max_money_minor() from authenticated;
revoke execute on function public.currency_exponent(text) from authenticated;
revoke execute on function public.format_minor(bigint, text) from authenticated;
revoke execute on function public.distance_m(double precision, double precision, double precision, double precision) from authenticated;
-- Used by row-level policies or column defaults, so the signed-in role needs
-- them; each only answers about the caller's own access (or nothing at all).
grant execute on function public.can_upload_now() to authenticated;
