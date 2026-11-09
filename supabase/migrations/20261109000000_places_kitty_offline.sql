-- Places & arrival alerts, map pins and photo memories, the cash kitty, locked
-- exchange rates, and bills that can be saved offline and synced exactly once.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))
$$;

-- ---------------------------------------------------------------------------
-- Places: stays, airports, meet-up points, food, sights and photo memories
-- ---------------------------------------------------------------------------
alter table public.trip_members add column arrival_alerts boolean not null default true;
grant update (arrival_alerts) on public.trip_members to authenticated;

create table public.trip_places (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null default 'other'
    check (kind in ('stay', 'airport', 'meetup', 'food', 'sight', 'memory', 'other')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  note text check (note is null or char_length(note) <= 500),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_m int not null default 150 check (radius_m between 30 and 2000),
  -- Tell the group when someone arrives here.
  alerts boolean not null default false,
  photo_path text check (photo_path is null or split_part(photo_path, '/', 1) = trip_id::text),
  created_at timestamptz not null default now()
);
create index trip_places_trip_idx on public.trip_places (trip_id, created_at desc);

alter table public.trip_places enable row level security;
create policy "places: members can read"
  on public.trip_places for select to authenticated
  using (public.is_trip_member(trip_id));
create policy "places: members can add"
  on public.trip_places for insert to authenticated
  with check (created_by = auth.uid() and public.is_trip_member(trip_id));
create policy "places: creator or organizer can edit"
  on public.trip_places for update to authenticated
  using (created_by = auth.uid() or public.is_trip_organizer(trip_id))
  with check (public.is_trip_member(trip_id));
create policy "places: creator or organizer can delete"
  on public.trip_places for delete to authenticated
  using (created_by = auth.uid() or public.is_trip_organizer(trip_id));
revoke all on public.trip_places from anon;
revoke update on public.trip_places from authenticated;
grant select, insert, delete on public.trip_places to authenticated;
grant update (kind, name, note, lat, lng, radius_m, alerts, photo_path) on public.trip_places to authenticated;

-- Who is inside which alerting place (server-side only, no client access).
create table public.place_presence (
  place_id uuid not null references public.trip_places (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  inside boolean not null,
  entered_at timestamptz,
  last_alert_at timestamptz,
  primary key (place_id, user_id)
);
alter table public.place_presence enable row level security;
revoke all on public.place_presence from anon, authenticated;

-- When a dot moves into an alerting place, tell the rest of the group (once per
-- 30 minutes per person and place). The first position we see for someone
-- never alerts, so joining or adding a place doesn't announce where people are.
create or replace function public.handle_location_for_places()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_place public.trip_places%rowtype;
  v_prev public.place_presence%rowtype;
  v_dist double precision;
  v_slack double precision := least(greatest(coalesce(new.accuracy_m, 0), 0), 50);
  v_inside boolean;
  v_trip_name text;
begin
  for v_place in
    select * from public.trip_places p where p.trip_id = new.trip_id and p.alerts
  loop
    v_dist := public.distance_m(new.lat, new.lng, v_place.lat, v_place.lng);
    select * into v_prev from public.place_presence pp
      where pp.place_id = v_place.id and pp.user_id = new.user_id;

    if not found then
      insert into public.place_presence (place_id, user_id, inside, entered_at)
      values (v_place.id, new.user_id, v_dist <= v_place.radius_m + v_slack,
              case when v_dist <= v_place.radius_m + v_slack then now() end);
      continue;
    end if;

    -- Leave only once well outside, so a wobbly dot doesn't flap in and out.
    v_inside := case when v_prev.inside
                     then v_dist <= v_place.radius_m * 1.5 + v_slack
                     else v_dist <= v_place.radius_m + v_slack end;

    if v_inside and not v_prev.inside then
      if coalesce(v_prev.last_alert_at, '-infinity'::timestamptz) < now() - interval '30 minutes' then
        select t.name into v_trip_name from public.trips t where t.id = new.trip_id;
        insert into public.notifications (user_id, trip_id, kind, title, body, data)
        select m.user_id, new.trip_id, 'arrival', v_trip_name,
               public.display_name_of(new.user_id) || ' arrived at ' || v_place.name,
               jsonb_build_object('trip_id', new.trip_id, 'place_id', v_place.id, 'user_id', new.user_id)
        from public.trip_members m
        where m.trip_id = new.trip_id and m.user_id <> new.user_id and m.arrival_alerts;
        update public.place_presence set inside = true, entered_at = now(), last_alert_at = now()
          where place_id = v_place.id and user_id = new.user_id;
      else
        update public.place_presence set inside = true, entered_at = now()
          where place_id = v_place.id and user_id = new.user_id;
      end if;
    elsif not v_inside and v_prev.inside then
      update public.place_presence set inside = false
        where place_id = v_place.id and user_id = new.user_id;
    end if;
  end loop;
  return new;
end;
$$;
revoke execute on function public.handle_location_for_places() from public, anon, authenticated;

create trigger on_location_places
  after insert or update of lat, lng on public.member_locations
  for each row execute function public.handle_location_for_places();

-- Photos for places and memories, in the trip's folder.
insert into storage.buckets (id, name, public)
values ('trip-photos', 'trip-photos', false)
on conflict (id) do nothing;

create policy "trip-photos: trip members can read"
  on storage.objects for select to authenticated
  using (bucket_id = 'trip-photos' and public.is_trip_member(public.try_uuid((storage.foldername(name))[1])));
create policy "trip-photos: trip members can upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'trip-photos' and public.is_trip_member(public.try_uuid((storage.foldername(name))[1])));
create policy "trip-photos: uploader can delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'trip-photos' and owner = auth.uid());

-- ---------------------------------------------------------------------------
-- Cash kitty
-- ---------------------------------------------------------------------------
create table public.trip_kitties (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  name text not null default 'Kitty' check (char_length(btrim(name)) between 1 and 60),
  holder_id uuid not null references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index trip_kitties_trip_idx on public.trip_kitties (trip_id, created_at);

-- Cash the holder adds from their own pocket (no one else to pay, so no payment row).
create table public.kitty_own_cash (
  id uuid primary key default gen_random_uuid(),
  kitty_id uuid not null references public.trip_kitties (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  amount_base_minor bigint not null check (amount_base_minor > 0),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index kitty_own_cash_kitty_idx on public.kitty_own_cash (kitty_id);

alter table public.settlements
  add column kitty_id uuid references public.trip_kitties (id),
  add column kitty_role text check (kitty_role is null or kitty_role in ('contribution', 'handover', 'payout')),
  add constraint settlements_kitty_role_with_kitty check ((kitty_id is null) = (kitty_role is null));
create index settlements_kitty_idx on public.settlements (kitty_id) where kitty_id is not null;

alter table public.bills
  add column kitty_id uuid references public.trip_kitties (id),
  -- Exchange rate source and when it was fixed for this bill.
  add column fx_source text check (fx_source is null or fx_source in ('ecb', 'manual')),
  add column fx_locked_at timestamptz,
  -- Made on the device, so a bill saved offline is only added once when it syncs.
  add column client_id uuid unique;
create index bills_kitty_idx on public.bills (kitty_id) where kitty_id is not null;

alter table public.trip_kitties enable row level security;
alter table public.kitty_own_cash enable row level security;
create policy "kitties: members can read"
  on public.trip_kitties for select to authenticated
  using (public.is_trip_member(trip_id));
create policy "kitty cash: members can read"
  on public.kitty_own_cash for select to authenticated
  using (exists (select 1 from public.trip_kitties k where k.id = kitty_id and public.is_trip_member(k.trip_id)));
revoke all on public.trip_kitties, public.kitty_own_cash from anon;
revoke insert, update, delete on public.trip_kitties, public.kitty_own_cash from authenticated;
grant select on public.trip_kitties, public.kitty_own_cash to authenticated;

-- Normal "mark as paid" can't touch kitty fields; kitty moves go through the functions below.
drop policy "settlements: payer records a payment" on public.settlements;
create policy "settlements: payer records a payment"
  on public.settlements for insert to authenticated
  with check (from_user = auth.uid() and status = 'paid' and kitty_id is null and public.is_trip_member(trip_id));

create or replace function public.guard_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_member_of(new.trip_id, new.from_user) or not public.is_member_of(new.trip_id, new.to_user) then
    raise exception 'Both people must be in the trip.' using errcode = '22023';
  end if;
  if new.kitty_id is not null and not exists (
    select 1 from public.trip_kitties k where k.id = new.kitty_id and k.trip_id = new.trip_id
  ) then
    raise exception 'That kitty is not in this trip.' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Cash that should be in the pot right now.
create or replace function public.kitty_cash(p_kitty uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(s.amount_base_minor) from public.settlements s
              where s.kitty_id = p_kitty and s.kitty_role = 'contribution' and s.status <> 'disputed'), 0)
  + coalesce((select sum(o.amount_base_minor) from public.kitty_own_cash o where o.kitty_id = p_kitty), 0)
  - coalesce((select sum(b.total_base_minor) from public.bills b where b.kitty_id = p_kitty), 0)
  - coalesce((select sum(s.amount_base_minor) from public.settlements s
              where s.kitty_id = p_kitty and s.kitty_role = 'payout' and s.status <> 'disputed'), 0)
$$;

create or replace function public.create_kitty(p_trip uuid, p_name text, p_holder uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_trip_member(p_trip) then
    raise exception 'You are not in this trip.' using errcode = '42501';
  end if;
  if not public.is_member_of(p_trip, p_holder) then
    raise exception 'The person holding the cash must be in the trip.' using errcode = '22023';
  end if;
  insert into public.trip_kitties (trip_id, name, holder_id, created_by)
  values (p_trip, coalesce(nullif(btrim(p_name), ''), 'Kitty'), p_holder, auth.uid())
  returning id into v_id;
  if p_holder <> auth.uid() then
    perform public.notify(
      p_holder, p_trip, 'kitty_holder', (select name from public.trips where id = p_trip),
      public.display_name_of(auth.uid()) || ' made you the holder of the "' || coalesce(nullif(btrim(p_name), ''), 'Kitty') || '" cash kitty',
      jsonb_build_object('trip_id', p_trip, 'kitty_id', v_id)
    );
  end if;
  return v_id;
end;
$$;

-- Someone puts cash in. The holder recording it counts as confirmed; the person
-- who gave it recording it waits for the holder to confirm (like a payment).
create or replace function public.kitty_add_cash(p_kitty uuid, p_from uuid, p_amount bigint, p_note text default null)
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
  select * into v_k from public.trip_kitties where id = p_kitty;
  if not found or not public.is_trip_member(v_k.trip_id) then
    raise exception 'Kitty not found.' using errcode = 'P0002';
  end if;
  if v_k.closed_at is not null then
    raise exception 'This kitty is closed.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Enter an amount.' using errcode = '22023';
  end if;
  if not public.is_member_of(v_k.trip_id, p_from) then
    raise exception 'They must be in the trip.' using errcode = '22023';
  end if;

  if p_from = v_k.holder_id then
    if v_uid <> v_k.holder_id then
      raise exception 'Only the holder can add their own cash.' using errcode = '42501';
    end if;
    insert into public.kitty_own_cash (kitty_id, user_id, amount_base_minor, note)
    values (p_kitty, p_from, p_amount, left(p_note, 300))
    returning id into v_id;
  elsif v_uid = v_k.holder_id or v_uid = p_from then
    insert into public.settlements (trip_id, from_user, to_user, amount_base_minor, method, note, status, responded_at, kitty_id, kitty_role)
    values (v_k.trip_id, p_from, v_k.holder_id, p_amount, 'Cash kitty', left(p_note, 300),
            case when v_uid = v_k.holder_id then 'confirmed' else 'paid' end::public.settlement_status,
            case when v_uid = v_k.holder_id then now() end, p_kitty, 'contribution')
    returning id into v_id;
  else
    raise exception 'Only the holder or the person putting cash in can record it.' using errcode = '42501';
  end if;
  return v_id;
end;
$$;

-- The holder passes the pot (all the cash in it) to someone else.
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
  if p_to = v_k.holder_id or not public.is_member_of(v_k.trip_id, p_to) then
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

-- The holder gives leftover cash back to someone; they confirm they got it.
create or replace function public.kitty_payout(p_kitty uuid, p_to uuid, p_amount bigint, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_k public.trip_kitties%rowtype;
  v_id uuid;
begin
  select * into v_k from public.trip_kitties where id = p_kitty;
  if not found or not public.is_trip_member(v_k.trip_id) then
    raise exception 'Kitty not found.' using errcode = 'P0002';
  end if;
  if v_k.holder_id <> auth.uid() then
    raise exception 'Only the person holding the kitty can give cash back.' using errcode = '42501';
  end if;
  if p_to = v_k.holder_id or not public.is_member_of(v_k.trip_id, p_to) then
    raise exception 'Choose someone else in the trip.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Enter an amount.' using errcode = '22023';
  end if;
  if p_amount > public.kitty_cash(p_kitty) then
    raise exception 'There isn''t that much cash in the kitty.' using errcode = '22023';
  end if;
  insert into public.settlements (trip_id, from_user, to_user, amount_base_minor, method, note, status, kitty_id, kitty_role)
  values (v_k.trip_id, v_k.holder_id, p_to, p_amount, 'Cash kitty', left(p_note, 300), 'paid', p_kitty, 'payout')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.close_kitty(p_kitty uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.trip_kitties k set closed_at = now()
  where k.id = p_kitty and k.closed_at is null
    and (k.holder_id = auth.uid() or public.is_trip_organizer(k.trip_id));
  if not found then
    raise exception 'Only the holder or the organizer can close the kitty.' using errcode = '42501';
  end if;
end;
$$;

-- Kitty-aware wording for payment notifications.
create or replace function public.handle_settlement_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips%rowtype;
  v_amount text;
begin
  select * into v_trip from public.trips where id = new.trip_id;
  v_amount := public.format_minor(new.amount_base_minor, v_trip.base_currency);
  if tg_op = 'INSERT' and new.kitty_role = 'handover' then
    return new; -- kitty_handover sends its own message
  elsif tg_op = 'INSERT' and new.kitty_role = 'contribution' and new.status = 'confirmed' then
    perform public.notify(
      new.from_user, new.trip_id, 'settlement_recorded', v_trip.name,
      public.display_name_of(new.to_user) || ' recorded the ' || v_amount || ' you put in the kitty',
      jsonb_build_object('trip_id', new.trip_id, 'settlement_id', new.id, 'kitty_id', new.kitty_id)
    );
  elsif tg_op = 'INSERT' and new.kitty_role = 'contribution' then
    perform public.notify(
      new.to_user, new.trip_id, 'settlement_paid', v_trip.name,
      public.display_name_of(new.from_user) || ' put ' || v_amount || ' in the kitty. Tap to confirm you got it.',
      jsonb_build_object('trip_id', new.trip_id, 'settlement_id', new.id, 'kitty_id', new.kitty_id)
    );
  elsif tg_op = 'INSERT' and new.kitty_role = 'payout' then
    perform public.notify(
      new.to_user, new.trip_id, 'settlement_paid', v_trip.name,
      public.display_name_of(new.from_user) || ' gave you ' || v_amount || ' back from the kitty. Tap to confirm you got it.',
      jsonb_build_object('trip_id', new.trip_id, 'settlement_id', new.id, 'kitty_id', new.kitty_id)
    );
  elsif tg_op = 'INSERT' and new.status = 'confirmed' then
    -- Recorded by the person who received the money (e.g. cash).
    perform public.notify(
      new.from_user, new.trip_id, 'settlement_recorded', v_trip.name,
      public.display_name_of(new.to_user) || ' recorded that you paid them ' || v_amount,
      jsonb_build_object('trip_id', new.trip_id, 'settlement_id', new.id)
    );
  elsif tg_op = 'INSERT' then
    perform public.notify(
      new.to_user, new.trip_id, 'settlement_paid', v_trip.name,
      public.display_name_of(new.from_user) || ' marked ' || v_amount || ' as paid to you. Tap to confirm.',
      jsonb_build_object('trip_id', new.trip_id, 'settlement_id', new.id)
    );
  elsif tg_op = 'UPDATE' and new.status <> old.status then
    perform public.notify(
      new.from_user, new.trip_id, 'settlement_' || new.status::text, v_trip.name,
      public.display_name_of(new.to_user)
        || case new.status
             when 'confirmed' then ' confirmed your payment of ' || v_amount
             else ' says they haven''t received ' || v_amount || ' yet'
           end,
      jsonb_build_object('trip_id', new.trip_id, 'settlement_id', new.id)
    );
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_bill: idempotent offline saves (client_id), kitty bills, locked rates
-- ---------------------------------------------------------------------------
create or replace function public.save_bill(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_trip public.trips%rowtype;
  v_existing public.bills%rowtype;
  v_bill_id uuid := public.try_uuid(nullif(p ->> 'id', ''));
  v_is_new boolean := v_bill_id is null;
  v_client_id uuid := public.try_uuid(nullif(p ->> 'client_id', ''));
  v_kitty_id uuid := public.try_uuid(nullif(p ->> 'kitty_id', ''));
  v_kitty public.trip_kitties%rowtype;
  v_paid_by uuid := public.try_uuid(p ->> 'paid_by');
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_currency text := upper(btrim(coalesce(p ->> 'currency', '')));
  v_rate numeric := coalesce(nullif(p ->> 'fx_rate', '')::numeric, 1);
  v_fx_source text := nullif(p ->> 'fx_source', '');
  v_fx_locked_at timestamptz;
  v_mode public.split_mode := (p ->> 'split_mode')::public.split_mode;
  v_tax bigint := coalesce((p ->> 'tax_minor')::bigint, 0);
  v_service bigint := coalesce((p ->> 'service_minor')::bigint, 0);
  v_tip bigint := coalesce((p ->> 'tip_minor')::bigint, 0);
  v_discount bigint := coalesce((p ->> 'discount_minor')::bigint, 0);
  v_total bigint := (p ->> 'total_minor')::bigint;
  v_total_base bigint := (p ->> 'total_base_minor')::bigint;
  v_items jsonb := coalesce(p -> 'items', '[]'::jsonb);
  v_shares jsonb := coalesce(p -> 'shares', '[]'::jsonb);
  v_source text := coalesce(nullif(p ->> 'source', ''), 'manual');
  v_subtotal bigint;
  v_sum bigint;
  v_sum_base bigint;
  v_expected_base numeric;
  v_item jsonb;
  v_item_id uuid;
  v_pos int := 0;
begin
  if v_uid is null then
    raise exception 'Please sign in first.' using errcode = '28000';
  end if;

  -- Already saved (a retry of a bill saved offline): return it, change nothing.
  if v_is_new and v_client_id is not null then
    select b.id into v_bill_id from public.bills b where b.client_id = v_client_id;
    if found then
      if not public.can_read_bill(v_bill_id) then
        raise exception 'Bill not found.' using errcode = 'P0002';
      end if;
      return v_bill_id;
    end if;
  end if;

  select * into v_trip from public.trips where id = public.try_uuid(p ->> 'trip_id');
  if not found or not public.is_member_of(v_trip.id, v_uid) then
    raise exception 'You are not in this trip.' using errcode = '42501';
  end if;
  if v_paid_by is null or not public.is_member_of(v_trip.id, v_paid_by) then
    raise exception 'The person who paid must be in the trip.' using errcode = '22023';
  end if;
  if v_title = '' then
    raise exception 'Give the bill a name.' using errcode = '22023';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Unknown currency.' using errcode = '22023';
  end if;
  if v_currency = v_trip.base_currency then
    v_rate := 1;
    v_fx_source := null;
  elsif v_fx_source is not null and v_fx_source not in ('ecb', 'manual') then
    v_fx_source := 'manual';
  end if;
  if v_rate <= 0 then
    raise exception 'The exchange rate must be positive.' using errcode = '22023';
  end if;
  if v_total is null or v_total < 0 or v_total_base is null or v_total_base < 0 then
    raise exception 'The bill total is missing.' using errcode = '22023';
  end if;
  if least(v_tax, v_service, v_tip, v_discount) < 0 then
    raise exception 'Tax, tip and discounts can''t be negative.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_typeof(v_shares) <> 'array' then
    raise exception 'Malformed bill.' using errcode = '22023';
  end if;

  if not v_is_new then
    select * into v_existing from public.bills where id = v_bill_id for update;
    if not found or v_existing.trip_id <> v_trip.id then
      raise exception 'Bill not found.' using errcode = 'P0002';
    end if;
    if v_uid <> v_existing.created_by and v_uid <> v_existing.paid_by
       and not public.is_trip_organizer(v_trip.id) then
      raise exception 'Only the person who added or paid this bill can edit it.' using errcode = '42501';
    end if;
  end if;

  -- Paid from the kitty? Editing keeps the bill's kitty unless the edit says otherwise.
  if not v_is_new and not (p ? 'kitty_id') then
    v_kitty_id := v_existing.kitty_id;
  end if;
  if v_kitty_id is not null then
    select * into v_kitty from public.trip_kitties where id = v_kitty_id;
    if not found or v_kitty.trip_id <> v_trip.id then
      raise exception 'That kitty is not in this trip.' using errcode = '22023';
    end if;
    -- New kitty spending must come from the current holder of an open kitty;
    -- older kitty bills can still be edited after it changes hands.
    if v_is_new or v_kitty_id is distinct from v_existing.kitty_id or v_paid_by <> v_existing.paid_by then
      if v_kitty.closed_at is not null then
        raise exception 'This kitty is closed.' using errcode = '22023';
      end if;
      if v_paid_by <> v_kitty.holder_id then
        raise exception 'Bills from the kitty are paid by the person holding it.' using errcode = '22023';
      end if;
    end if;
  end if;

  -- The rate is locked when first saved, and again only if the currency or rate changes.
  if v_currency = v_trip.base_currency then
    v_fx_locked_at := null;
  elsif not v_is_new and v_existing.currency = v_currency and v_existing.fx_rate = v_rate then
    v_fx_locked_at := coalesce(v_existing.fx_locked_at, v_existing.created_at);
    v_fx_source := coalesce(v_existing.fx_source, v_fx_source);
  else
    v_fx_locked_at := now();
  end if;

  -- Items
  if exists (
    select 1 from jsonb_array_elements(v_items) i
    where coalesce((i ->> 'line_total_minor')::bigint, -1) < 0
  ) then
    raise exception 'Every item needs a price.' using errcode = '22023';
  end if;
  select coalesce(sum((i ->> 'line_total_minor')::bigint), 0) into v_subtotal
  from jsonb_array_elements(v_items) i;

  if v_mode = 'itemized' then
    if jsonb_array_length(v_items) = 0 then
      raise exception 'Add at least one item.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_items) i
      where (i ->> 'line_total_minor')::bigint > 0
        and jsonb_array_length(coalesce(i -> 'shares', '[]'::jsonb)) = 0
    ) then
      raise exception 'Every item needs at least one person.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_items) i,
        jsonb_array_elements(coalesce(i -> 'shares', '[]'::jsonb)) s
      where not public.is_member_of(v_trip.id, public.try_uuid(s ->> 'user_id'))
         or coalesce((s ->> 'weight')::int, 1) not between 1 and 1000
    ) then
      raise exception 'Everyone in the split must be in the trip.' using errcode = '22023';
    end if;
    if v_total <> v_subtotal + v_tax + v_service + v_tip - v_discount then
      raise exception 'The total doesn''t match the items, tax and tip.' using errcode = '22023';
    end if;
  else
    -- Equal split: one total, no extras.
    v_subtotal := v_total;
    v_tax := 0; v_service := 0; v_tip := 0; v_discount := 0;
  end if;

  -- Shares
  if jsonb_array_length(v_shares) = 0 then
    raise exception 'Choose who is splitting this bill.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_shares) s
    where not public.is_member_of(v_trip.id, public.try_uuid(s ->> 'user_id'))
  ) then
    raise exception 'Everyone in the split must be in the trip.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(v_shares))
     <> (select count(distinct s ->> 'user_id') from jsonb_array_elements(v_shares) s) then
    raise exception 'Someone appears twice in the split.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_shares) s
    where coalesce((s ->> 'amount_minor')::bigint, -1) < 0
       or coalesce((s ->> 'amount_base_minor')::bigint, -1) < 0
  ) then
    raise exception 'Shares can''t be negative.' using errcode = '22023';
  end if;
  select sum((s ->> 'amount_minor')::bigint), sum((s ->> 'amount_base_minor')::bigint)
    into v_sum, v_sum_base
  from jsonb_array_elements(v_shares) s;
  if v_sum <> v_total then
    raise exception 'The shares don''t add up to the total.' using errcode = '22023';
  end if;
  if v_sum_base <> v_total_base then
    raise exception 'The converted shares don''t add up to the converted total.' using errcode = '22023';
  end if;
  v_expected_base := v_total * v_rate
    * (10::numeric ^ (public.currency_exponent(v_trip.base_currency) - public.currency_exponent(v_currency)));
  if abs(v_total_base - round(v_expected_base)) > 1 then
    raise exception 'The converted total doesn''t match the exchange rate.' using errcode = '22023';
  end if;

  -- Write
  if v_is_new then
    insert into public.bills (
      trip_id, paid_by, created_by, title, bill_date, currency, fx_rate, fx_source, fx_locked_at, split_mode,
      subtotal_minor, tax_minor, service_minor, tip_minor, discount_minor,
      total_minor, total_base_minor, receipt_path, source, notes, kitty_id, client_id
    ) values (
      v_trip.id, v_paid_by, v_uid, v_title,
      coalesce(nullif(p ->> 'bill_date', '')::date, current_date),
      v_currency, v_rate, v_fx_source, v_fx_locked_at, v_mode,
      v_subtotal, v_tax, v_service, v_tip, v_discount,
      v_total, v_total_base, nullif(p ->> 'receipt_path', ''), v_source, nullif(p ->> 'notes', ''),
      v_kitty_id, v_client_id
    ) returning id into v_bill_id;
  else
    update public.bills set
      paid_by = v_paid_by, title = v_title,
      bill_date = coalesce(nullif(p ->> 'bill_date', '')::date, bill_date),
      currency = v_currency, fx_rate = v_rate, fx_source = v_fx_source, fx_locked_at = v_fx_locked_at,
      split_mode = v_mode,
      subtotal_minor = v_subtotal, tax_minor = v_tax, service_minor = v_service,
      tip_minor = v_tip, discount_minor = v_discount,
      total_minor = v_total, total_base_minor = v_total_base,
      receipt_path = coalesce(nullif(p ->> 'receipt_path', ''), receipt_path),
      source = v_source, notes = nullif(p ->> 'notes', ''),
      kitty_id = v_kitty_id
    where id = v_bill_id;
    delete from public.bill_items where bill_id = v_bill_id;
    delete from public.bill_shares where bill_id = v_bill_id;
  end if;

  for v_item in select * from jsonb_array_elements(v_items) loop
    insert into public.bill_items (bill_id, position, name, quantity, line_total_minor)
    values (
      v_bill_id, v_pos, left(btrim(coalesce(v_item ->> 'name', '')), 200),
      coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1),
      (v_item ->> 'line_total_minor')::bigint
    ) returning id into v_item_id;
    if v_mode = 'itemized' then
      insert into public.bill_item_shares (item_id, user_id, weight)
      select v_item_id, (s ->> 'user_id')::uuid, sum(coalesce((s ->> 'weight')::int, 1))
      from jsonb_array_elements(coalesce(v_item -> 'shares', '[]'::jsonb)) s
      group by (s ->> 'user_id')::uuid;
    end if;
    v_pos := v_pos + 1;
  end loop;

  insert into public.bill_shares (bill_id, user_id, amount_minor, amount_base_minor)
  select v_bill_id, (s ->> 'user_id')::uuid, (s ->> 'amount_minor')::bigint, (s ->> 'amount_base_minor')::bigint
  from jsonb_array_elements(v_shares) s;

  -- Tell everyone who owes something on this bill.
  insert into public.notifications (user_id, trip_id, kind, title, body, data)
  select (s ->> 'user_id')::uuid, v_trip.id,
         case when v_is_new then 'bill_added' else 'bill_updated' end,
         v_trip.name,
         public.display_name_of(v_uid)
           || case when v_is_new then ' added "' else ' updated "' end || v_title
           || case when v_kitty_id is not null then '" (paid from the kitty)' else '"' end
           || ' · your share ' || public.format_minor((s ->> 'amount_base_minor')::bigint, v_trip.base_currency),
         jsonb_build_object('trip_id', v_trip.id, 'bill_id', v_bill_id)
  from jsonb_array_elements(v_shares) s
  where (s ->> 'user_id')::uuid <> v_uid
    and (s ->> 'user_id')::uuid <> v_paid_by
    and (s ->> 'amount_base_minor')::bigint > 0;

  return v_bill_id;
end;
$$;

revoke execute on function public.kitty_cash(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: places and the kitty update live for everyone on the trip
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.trip_places, public.trip_kitties, public.kitty_own_cash;
  end if;
end;
$$;
