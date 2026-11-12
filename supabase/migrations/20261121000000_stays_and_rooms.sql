-- Where everyone sleeps: a trip's stays (a rental, a hotel), their rooms and
-- beds, and who is in which room. People pick their own bed (unless the
-- organizer turns that off) and the organizer can put anyone anywhere. A stay's
-- cost can be split by room: bigger rooms pay more, and each room's share is
-- split between the people in it. That split is saved as an ordinary bill
-- (save_bill), so balances, kitty and settle-up work as before.

create table if not exists public.trip_stays (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  address text check (address is null or char_length(address) <= 300),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  check_in date,
  check_out date,
  -- Everyone picks their own bed; when false only the organizer (or whoever
  -- added the stay) moves people.
  self_pick boolean not null default true,
  bill_id uuid references public.bills (id) on delete set null,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint trip_stays_point_complete check ((lat is null) = (lng is null)),
  constraint trip_stays_dates check (check_out is null or check_in is null or check_out >= check_in)
);
create index if not exists trip_stays_trip_idx on public.trip_stays (trip_id, check_in);

create table if not exists public.trip_rooms (
  id uuid primary key default gen_random_uuid(),
  stay_id uuid not null references public.trip_stays (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  beds int not null default 2 check (beds between 1 and 20),
  -- How much of the stay's cost this room carries, relative to the others
  -- (1 = standard, 1.5 = bigger or en-suite, 0.75 = smaller).
  size_weight numeric(4, 2) not null default 1 check (size_weight between 0.25 and 4),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists trip_rooms_stay_idx on public.trip_rooms (stay_id, position);

create table if not exists public.trip_room_guests (
  stay_id uuid not null references public.trip_stays (id) on delete cascade,
  room_id uuid not null references public.trip_rooms (id) on delete cascade,
  trip_id uuid not null,
  user_id uuid not null,
  assigned_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  -- One bed per person per stay.
  primary key (stay_id, user_id),
  -- Leaving the trip frees your bed.
  foreign key (trip_id, user_id) references public.trip_members (trip_id, user_id) on delete cascade
);
create index if not exists trip_room_guests_room_idx on public.trip_room_guests (room_id);

-- Who may arrange a stay: the organizer, or whoever added it.
create or replace function public.can_arrange_stay(p_stay uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_stays s
    where s.id = p_stay
      and public.is_trip_member(s.trip_id)
      and (s.created_by = auth.uid() or public.is_trip_organizer(s.trip_id))
  )
$$;

-- A room always belongs to its stay's trip; fewer beds than people is refused.
create or replace function public.guard_trip_room()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in int;
begin
  select s.trip_id into new.trip_id from public.trip_stays s where s.id = new.stay_id;
  if new.trip_id is null then
    raise exception 'Stay not found.' using errcode = 'P0002';
  end if;
  if tg_op = 'UPDATE' then
    if new.stay_id <> old.stay_id then
      raise exception 'A room stays in its own place.' using errcode = '22023';
    end if;
    -- Same lock as pick_bed, so a bed can't be taken while the room shrinks.
    perform 1 from public.trip_stays where id = new.stay_id for update;
    select count(*) into v_in from public.trip_room_guests g where g.room_id = new.id;
    if v_in > new.beds then
      raise exception '% people are in %. Move someone out first.', v_in, old.name using errcode = '22023';
    end if;
  end if;
  new.name := btrim(new.name);
  return new;
end;
$$;
drop trigger if exists trip_rooms_guard on public.trip_rooms;
create trigger trip_rooms_guard before insert or update on public.trip_rooms
  for each row execute function public.guard_trip_room();

-- Rooms per stay are capped so a mistake can't fill the screen.
create or replace function public.guard_trip_room_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.trip_rooms where stay_id = new.stay_id) >= 30 then
    raise exception 'A stay can have up to 30 rooms.' using errcode = '54000';
  end if;
  return new;
end;
$$;
drop trigger if exists trip_rooms_count on public.trip_rooms;
create trigger trip_rooms_count before insert on public.trip_rooms
  for each row execute function public.guard_trip_room_count();

create or replace function public.guard_trip_stay()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.trip_stays where trip_id = new.trip_id) >= 20 then
      raise exception 'A trip can have up to 20 stays.' using errcode = '54000';
    end if;
  elsif new.trip_id <> old.trip_id then
    raise exception 'A stay stays in its own trip.' using errcode = '22023';
  end if;
  if new.bill_id is not null and not exists (select 1 from public.bills b where b.id = new.bill_id and b.trip_id = new.trip_id) then
    raise exception 'That bill isn''t on this trip.' using errcode = '22023';
  end if;
  new.name := btrim(new.name);
  return new;
end;
$$;
drop trigger if exists trip_stays_guard on public.trip_stays;
create trigger trip_stays_guard before insert or update on public.trip_stays
  for each row execute function public.guard_trip_stay();

-- Put someone (yourself when p_user is null) in a room. Moves them out of any
-- other room in the same stay. Full rooms are refused, even when two people
-- take the last bed at once.
create or replace function public.pick_bed(p_room uuid, p_user uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.trip_rooms%rowtype;
  v_stay public.trip_stays%rowtype;
  v_user uuid := coalesce(p_user, auth.uid());
  v_in int;
  v_arranger boolean;
begin
  select * into v_room from public.trip_rooms where id = p_room;
  if not found or not public.is_trip_member(v_room.trip_id) then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;
  -- One booking at a time per stay, so beds can't be double-counted.
  select * into v_stay from public.trip_stays where id = v_room.stay_id for update;
  if not public.trip_is_active(v_stay.trip_id) then
    raise exception 'This trip has ended.' using errcode = '22023';
  end if;
  v_arranger := public.can_arrange_stay(v_stay.id);
  if v_user <> auth.uid() and not v_arranger then
    raise exception 'Only the organizer, or whoever added this stay, can move other people.' using errcode = '42501';
  end if;
  if v_user = auth.uid() and not v_stay.self_pick and not v_arranger then
    raise exception 'The organizer is choosing rooms for this stay.' using errcode = '42501';
  end if;
  if not public.is_member_of(v_stay.trip_id, v_user) then
    raise exception 'They aren''t on this trip.' using errcode = '22023';
  end if;
  if exists (select 1 from public.trip_room_guests g where g.stay_id = v_stay.id and g.user_id = v_user and g.room_id = p_room) then
    return;
  end if;
  select count(*) into v_in from public.trip_room_guests g where g.room_id = p_room;
  if v_in >= v_room.beds then
    raise exception '% is full.', v_room.name using errcode = '23514';
  end if;
  delete from public.trip_room_guests where stay_id = v_stay.id and user_id = v_user;
  insert into public.trip_room_guests (stay_id, room_id, trip_id, user_id, assigned_by)
  values (v_stay.id, p_room, v_stay.trip_id, v_user, auth.uid());
  if v_user <> auth.uid() then
    perform public.notify(v_user, v_stay.trip_id, 'room_assigned', v_stay.name,
      public.display_name_of(auth.uid()) || ' put you in ' || v_room.name || '.',
      jsonb_build_object('trip_id', v_stay.trip_id, 'stay_id', v_stay.id));
  end if;
end;
$$;

-- Take someone (yourself when p_user is null) out of their room in a stay.
create or replace function public.leave_bed(p_stay uuid, p_user uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stay public.trip_stays%rowtype;
  v_user uuid := coalesce(p_user, auth.uid());
begin
  select * into v_stay from public.trip_stays where id = p_stay for update;
  if not found or not public.is_trip_member(v_stay.trip_id) then
    raise exception 'Stay not found.' using errcode = 'P0002';
  end if;
  if v_user <> auth.uid() and not public.can_arrange_stay(p_stay) then
    raise exception 'Only the organizer, or whoever added this stay, can move other people.' using errcode = '42501';
  end if;
  if v_user = auth.uid() and not v_stay.self_pick and not public.can_arrange_stay(p_stay) then
    raise exception 'The organizer is choosing rooms for this stay.' using errcode = '42501';
  end if;
  delete from public.trip_room_guests where stay_id = p_stay and user_id = v_user;
end;
$$;

alter table public.trip_stays enable row level security;
alter table public.trip_rooms enable row level security;
alter table public.trip_room_guests enable row level security;

drop policy if exists "stays: members can read" on public.trip_stays;
create policy "stays: members can read" on public.trip_stays for select to authenticated
  using (public.is_trip_member(trip_id));
drop policy if exists "stays: members add stays while the trip is on" on public.trip_stays;
create policy "stays: members add stays while the trip is on" on public.trip_stays for insert to authenticated
  with check (public.is_trip_member(trip_id) and public.trip_is_active(trip_id));
drop policy if exists "stays: who added it or the organizer edits" on public.trip_stays;
create policy "stays: who added it or the organizer edits" on public.trip_stays for update to authenticated
  using (public.is_trip_member(trip_id) and (created_by = auth.uid() or public.is_trip_organizer(trip_id)))
  with check (public.trip_is_active(trip_id) and (created_by = auth.uid() or public.is_trip_organizer(trip_id)));
drop policy if exists "stays: who added it or the organizer removes" on public.trip_stays;
create policy "stays: who added it or the organizer removes" on public.trip_stays for delete to authenticated
  using (public.is_trip_member(trip_id) and (created_by = auth.uid() or public.is_trip_organizer(trip_id)));

drop policy if exists "rooms: members can read" on public.trip_rooms;
create policy "rooms: members can read" on public.trip_rooms for select to authenticated
  using (public.is_trip_member(trip_id));
drop policy if exists "rooms: arrangers add rooms" on public.trip_rooms;
create policy "rooms: arrangers add rooms" on public.trip_rooms for insert to authenticated
  with check (public.can_arrange_stay(stay_id) and public.trip_is_active(trip_id));
drop policy if exists "rooms: arrangers edit rooms" on public.trip_rooms;
create policy "rooms: arrangers edit rooms" on public.trip_rooms for update to authenticated
  using (public.can_arrange_stay(stay_id))
  with check (public.can_arrange_stay(stay_id) and public.trip_is_active(trip_id));
drop policy if exists "rooms: arrangers remove rooms" on public.trip_rooms;
create policy "rooms: arrangers remove rooms" on public.trip_rooms for delete to authenticated
  using (public.can_arrange_stay(stay_id));

drop policy if exists "room guests: members can read" on public.trip_room_guests;
create policy "room guests: members can read" on public.trip_room_guests for select to authenticated
  using (public.is_trip_member(trip_id));

revoke all on public.trip_stays, public.trip_rooms, public.trip_room_guests from anon;
revoke insert, update on public.trip_stays from authenticated;
grant select, delete on public.trip_stays to authenticated;
grant insert (trip_id, name, address, lat, lng, check_in, check_out, self_pick) on public.trip_stays to authenticated;
grant update (name, address, lat, lng, check_in, check_out, self_pick, bill_id) on public.trip_stays to authenticated;
revoke insert, update on public.trip_rooms from authenticated;
grant select, delete on public.trip_rooms to authenticated;
grant insert (stay_id, name, beds, size_weight, position) on public.trip_rooms to authenticated;
grant update (name, beds, size_weight, position) on public.trip_rooms to authenticated;
revoke insert, update, delete on public.trip_room_guests from authenticated;
grant select on public.trip_room_guests to authenticated;

revoke execute on function public.guard_trip_room() from public, anon, authenticated;
revoke execute on function public.guard_trip_room_count() from public, anon, authenticated;
revoke execute on function public.guard_trip_stay() from public, anon, authenticated;
revoke execute on function public.can_arrange_stay(uuid) from public, anon;
revoke execute on function public.pick_bed(uuid, uuid) from public, anon;
revoke execute on function public.leave_bed(uuid, uuid) from public, anon;
grant execute on function public.can_arrange_stay(uuid) to authenticated;
grant execute on function public.pick_bed(uuid, uuid) to authenticated;
grant execute on function public.leave_bed(uuid, uuid) to authenticated;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['trip_stays', 'trip_rooms', 'trip_room_guests'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
