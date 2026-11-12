-- Invite friends: each person has an invite code; someone new who signs up
-- with it (within 14 days of making their account) is linked to whoever
-- invited them. Once the new person is on a trip with at least one other
-- person, both get a month of Tripley Pro (accounts.bonus_pro_until, kept
-- apart from the subscription the store manages). At most 6 rewards a year
-- for whoever invites. Codes say nothing about the person.

alter table public.accounts add column if not exists bonus_pro_until timestamptz;

create table if not exists public.referral_codes (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z2-9]{8}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.referrals (
  referred_id uuid primary key references public.profiles (id) on delete cascade,
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  check (referred_id <> referrer_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id, rewarded_at);

alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
drop policy if exists "referral codes: your own" on public.referral_codes;
create policy "referral codes: your own" on public.referral_codes for select to authenticated using (user_id = auth.uid());
drop policy if exists "referrals: yours" on public.referrals;
create policy "referrals: yours" on public.referrals for select to authenticated using (referrer_id = auth.uid() or referred_id = auth.uid());
revoke all on public.referral_codes, public.referrals from anon;
revoke insert, update, delete on public.referral_codes, public.referrals from authenticated;
grant select on public.referral_codes, public.referrals to authenticated;

-- Your code (made the first time you ask). No 0/O/1/I, so it's easy to read out.
create or replace function public.my_referral_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_bytes bytea;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select code into v_code from public.referral_codes where user_id = auth.uid();
  while v_code is null loop
    -- Random bytes from a v4 UUID (skipping its fixed version and variant bytes).
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code := (select string_agg(substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 32), 1), '' order by i) from unnest(array[0, 1, 2, 3, 4, 5, 10, 11]) i);
    begin
      insert into public.referral_codes (user_id, code) values (auth.uid(), v_code);
    exception when unique_violation then
      select code into v_code from public.referral_codes where user_id = auth.uid();
    end;
  end loop;
  return v_code;
end;
$$;

-- Both get a month of Pro (added to any bonus month still running).
create or replace function public.reward_referral(p_referred uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref public.referrals%rowtype;
begin
  select * into v_ref from public.referrals where referred_id = p_referred and rewarded_at is null for update;
  if not found then
    return false;
  end if;
  if not exists (
    select 1 from public.trip_members m
    where m.user_id = p_referred and (select count(*) from public.trip_members o where o.trip_id = m.trip_id) >= 2
  ) then
    return false;
  end if;
  if (select count(*) from public.referrals r where r.referrer_id = v_ref.referrer_id and r.rewarded_at > now() - interval '365 days') >= 6 then
    return false;
  end if;
  update public.referrals set rewarded_at = now() where referred_id = p_referred;
  insert into public.accounts (user_id) values (v_ref.referrer_id), (p_referred) on conflict (user_id) do nothing;
  update public.accounts
    set bonus_pro_until = greatest(coalesce(bonus_pro_until, now()), now()) + interval '30 days', updated_at = now()
    where user_id in (v_ref.referrer_id, p_referred);
  perform public.notify(v_ref.referrer_id, null, 'referral_reward', 'A month of Tripley Pro',
    public.display_name_of(p_referred) || ' is planning a trip with Tripley thanks to you. You both get a month of Pro.', '{}'::jsonb);
  perform public.notify(p_referred, null, 'referral_reward', 'A month of Tripley Pro',
    'Thanks for joining from ' || public.display_name_of(v_ref.referrer_id) || '’s invite. You both get a month of Pro.', '{}'::jsonb);
  return true;
end;
$$;

-- Someone new uses a friend's code (once, within 14 days of signing up).
create or replace function public.claim_referral(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referrer uuid;
  v_created timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select user_id into v_referrer from public.referral_codes where code = upper(btrim(coalesce(p_code, '')));
  if v_referrer is null then
    raise exception 'That invite code isn''t right.' using errcode = '22023';
  end if;
  if v_referrer = auth.uid() then
    raise exception 'That''s your own code.' using errcode = '22023';
  end if;
  if exists (select 1 from public.referrals where referred_id = auth.uid()) then
    return 'already';
  end if;
  select created_at into v_created from auth.users where id = auth.uid();
  if v_created < now() - interval '14 days' then
    raise exception 'Invite codes are for new accounts (in their first 14 days).' using errcode = '22023';
  end if;
  insert into public.referrals (referred_id, referrer_id) values (auth.uid(), v_referrer);
  return case when public.reward_referral(auth.uid()) then 'rewarded' else 'linked' end;
end;
$$;

-- Joining a trip with others is what turns an invite into a reward.
create or replace function public.handle_member_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member record;
begin
  for v_member in
    select m.user_id from public.trip_members m
    join public.referrals r on r.referred_id = m.user_id and r.rewarded_at is null
    where m.trip_id = new.trip_id
  loop
    perform public.reward_referral(v_member.user_id);
  end loop;
  return new;
end;
$$;
drop trigger if exists trip_members_referral on public.trip_members;
create trigger trip_members_referral after insert on public.trip_members
  for each row execute function public.handle_member_referral();

revoke execute on function public.reward_referral(uuid) from public, anon, authenticated;
revoke execute on function public.handle_member_referral() from public, anon, authenticated;
revoke execute on function public.my_referral_code() from public, anon;
revoke execute on function public.claim_referral(text) from public, anon;
grant execute on function public.my_referral_code() to authenticated;
grant execute on function public.claim_referral(text) to authenticated;

-- AI reading: Pro also from a bonus month. Only the Pro check changes from
-- 20261122000000_bookings_and_documents.sql.
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
  if p_path is null or p_path !~ ('^' || p_trip::text || '/([A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp|pdf)|ai-plan-[0-9a-f-]{36})$') then
    return jsonb_build_object('status', 'bad_request');
  end if;

  select * into v_acc from public.accounts where user_id = p_user for update;
  -- Pro from a subscription, or a bonus month from inviting friends.
  if not found or not (
    (v_acc.plan = 'pro' and (v_acc.plan_expires_at is null or v_acc.plan_expires_at > now()))
    or coalesce(v_acc.bonus_pro_until > now(), false)
  ) then
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
