-- Shared itinerary: a day-by-day plan for the trip.
--
--  * itinerary_items: one stop or activity (day, optional start/end time, place
--    name, address, map point, notes), in a manual order within each day.
--    Anyone in the trip adds stops; the person who added one or the organizer
--    edits, moves or removes it. Who added and who last edited are recorded.
--  * itinerary_rsvps: each member's Going / Maybe / Not going for a stop.
--  * itinerary_comments: notes from the group on a stop. The person who added
--    the stop is told about new comments.
--
-- Only current trip members can read any of it. Ended trips are read-only.

create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  day date not null,
  position int not null default 0,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  starts_at time,
  ends_at time,
  place_name text check (place_name is null or char_length(place_name) <= 120),
  address text check (address is null or char_length(address) <= 300),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid not null default auth.uid() references public.profiles (id),
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint itinerary_point_complete check ((lat is null) = (lng is null)),
  constraint itinerary_end_after_start check (ends_at is null or (starts_at is not null and ends_at > starts_at))
);
create index itinerary_items_trip_day_idx on public.itinerary_items (trip_id, day, position);

create table public.itinerary_rsvps (
  item_id uuid not null references public.itinerary_items (id) on delete cascade,
  trip_id uuid not null,
  user_id uuid not null,
  status text not null check (status in ('going', 'maybe', 'not_going')),
  updated_at timestamptz not null default now(),
  primary key (item_id, user_id),
  -- Leaving the trip removes your answers.
  foreign key (trip_id, user_id) references public.trip_members (trip_id, user_id) on delete cascade
);
create index itinerary_rsvps_trip_idx on public.itinerary_rsvps (trip_id);

create table public.itinerary_comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.itinerary_items (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index itinerary_comments_item_idx on public.itinerary_comments (item_id, created_at);
create index itinerary_comments_trip_idx on public.itinerary_comments (trip_id);

-- ---------------------------------------------------------------------------
-- Server-side rules for stops: who made it, order, dates, edits
-- ---------------------------------------------------------------------------
create or replace function public.guard_itinerary_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips%rowtype;
  v_pos int;
begin
  -- Position shuffles made by this function itself.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_op = 'UPDATE' and (new.trip_id <> old.trip_id or new.created_by <> old.created_by) then
    raise exception 'A stop can''t move to another trip.' using errcode = '42501';
  end if;

  select * into v_trip from public.trips where id = new.trip_id;
  if (v_trip.starts_on is not null and new.day < v_trip.starts_on)
     or (v_trip.ends_on is not null and new.day > v_trip.ends_on) then
    raise exception 'Pick a day within the trip (% to %).',
      coalesce(to_char(v_trip.starts_on, 'Mon DD'), 'start'), coalesce(to_char(v_trip.ends_on, 'Mon DD'), 'end')
      using errcode = '22023';
  end if;
  new.title := btrim(new.title);
  new.place_name := nullif(btrim(new.place_name), '');
  new.address := nullif(btrim(new.address), '');
  new.notes := nullif(btrim(new.notes), '');

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    new.updated_by := null;
    new.created_at := now();
    new.updated_at := now();
  else
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
  end if;

  -- New stops (or stops moved to another day) go in time order: before the
  -- first stop that starts later, otherwise at the end of the day.
  if tg_op = 'INSERT' or new.day <> old.day then
    v_pos := null;
    if new.starts_at is not null then
      select min(i.position) into v_pos from public.itinerary_items i
        where i.trip_id = new.trip_id and i.day = new.day and i.starts_at > new.starts_at and i.id <> new.id;
    end if;
    if v_pos is null then
      select coalesce(max(i.position) + 1, 0) into v_pos from public.itinerary_items i
        where i.trip_id = new.trip_id and i.day = new.day and i.id <> new.id;
    else
      update public.itinerary_items i set position = i.position + 1
        where i.trip_id = new.trip_id and i.day = new.day and i.position >= v_pos and i.id <> new.id;
    end if;
    new.position := v_pos;
  end if;
  return new;
end;
$$;
create trigger itinerary_items_guard before insert or update on public.itinerary_items
  for each row execute function public.guard_itinerary_item();

-- Move a stop one place earlier (p_up) or later within its day.
create or replace function public.move_itinerary_item(p_item uuid, p_up boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.itinerary_items%rowtype;
  v_other uuid;
  v_other_pos int;
begin
  select * into v_item from public.itinerary_items where id = p_item for update;
  if not found or not public.is_trip_member(v_item.trip_id) then
    raise exception 'Stop not found.' using errcode = 'P0002';
  end if;
  if v_item.created_by <> auth.uid() and not public.is_trip_organizer(v_item.trip_id) then
    raise exception 'Only the person who added this stop or the organizer can move it.' using errcode = '42501';
  end if;
  if not public.trip_is_active(v_item.trip_id) then
    raise exception 'This trip has ended.' using errcode = '22023';
  end if;
  -- Tidy the day's numbering (0, 1, 2…) so neighbours are unambiguous.
  with ordered as (
    select i.id, row_number() over (order by i.position, i.created_at, i.id) - 1 as rn
    from public.itinerary_items i where i.trip_id = v_item.trip_id and i.day = v_item.day
  )
  update public.itinerary_items i set position = o.rn from ordered o where o.id = i.id and i.position <> o.rn;
  select position into v_item.position from public.itinerary_items where id = p_item;

  select i.id, i.position into v_other, v_other_pos from public.itinerary_items i
    where i.trip_id = v_item.trip_id and i.day = v_item.day
      and case when p_up then i.position < v_item.position else i.position > v_item.position end
    order by case when p_up then -i.position else i.position end
    limit 1;
  if v_other is null then
    return; -- already first (or last)
  end if;
  update public.itinerary_items set position = v_other_pos where id = p_item;
  update public.itinerary_items set position = v_item.position where id = v_other;
end;
$$;

-- Your answer for a stop: 'going', 'maybe', 'not_going', or null to clear it.
create or replace function public.set_itinerary_rsvp(p_item uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip uuid;
begin
  select trip_id into v_trip from public.itinerary_items where id = p_item;
  if v_trip is null or not public.is_trip_member(v_trip) then
    raise exception 'Stop not found.' using errcode = 'P0002';
  end if;
  if not public.trip_is_active(v_trip) then
    raise exception 'This trip has ended.' using errcode = '22023';
  end if;
  if p_status is null then
    delete from public.itinerary_rsvps where item_id = p_item and user_id = auth.uid();
  elsif p_status in ('going', 'maybe', 'not_going') then
    insert into public.itinerary_rsvps (item_id, trip_id, user_id, status)
    values (p_item, v_trip, auth.uid(), p_status)
    on conflict (item_id, user_id) do update set status = excluded.status, updated_at = now();
  else
    raise exception 'Choose going, maybe or not going.' using errcode = '22023';
  end if;
end;
$$;

-- A comment tells the person who added the stop (if they're still in the trip).
create or replace function public.handle_itinerary_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.itinerary_items%rowtype;
begin
  select * into v_item from public.itinerary_items where id = new.item_id;
  if not found or v_item.trip_id is distinct from new.trip_id then
    raise exception 'Stop not found.' using errcode = 'P0002';
  end if;
  if v_item.created_by <> new.user_id and public.is_member_of(v_item.trip_id, v_item.created_by) then
    perform public.notify(
      v_item.created_by, v_item.trip_id, 'itinerary_comment', (select name from public.trips where id = v_item.trip_id),
      public.display_name_of(new.user_id) || ' on "' || v_item.title || '": ' || left(new.body, 120),
      jsonb_build_object('trip_id', v_item.trip_id, 'item_id', v_item.id)
    );
  end if;
  return new;
end;
$$;
create trigger itinerary_comments_notify before insert on public.itinerary_comments
  for each row execute function public.handle_itinerary_comment();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.itinerary_items enable row level security;
alter table public.itinerary_rsvps enable row level security;
alter table public.itinerary_comments enable row level security;

create policy "itinerary: members can read"
  on public.itinerary_items for select to authenticated
  using (public.is_trip_member(trip_id));
create policy "itinerary: members add stops while the trip is on"
  on public.itinerary_items for insert to authenticated
  with check (public.is_trip_member(trip_id) and public.trip_is_active(trip_id));
create policy "itinerary: who added it or the organizer edits"
  on public.itinerary_items for update to authenticated
  using (public.is_trip_member(trip_id) and (created_by = auth.uid() or public.is_trip_organizer(trip_id)))
  with check (public.trip_is_active(trip_id) and (created_by = auth.uid() or public.is_trip_organizer(trip_id)));
create policy "itinerary: who added it or the organizer removes"
  on public.itinerary_items for delete to authenticated
  using (public.is_trip_member(trip_id) and (created_by = auth.uid() or public.is_trip_organizer(trip_id)));

create policy "itinerary rsvps: members can read"
  on public.itinerary_rsvps for select to authenticated
  using (public.is_trip_member(trip_id));

create policy "itinerary comments: members can read"
  on public.itinerary_comments for select to authenticated
  using (public.is_trip_member(trip_id));
create policy "itinerary comments: members comment as themselves"
  on public.itinerary_comments for insert to authenticated
  with check (user_id = auth.uid() and public.is_trip_member(trip_id) and public.trip_is_active(trip_id));
create policy "itinerary comments: author or organizer removes"
  on public.itinerary_comments for delete to authenticated
  using (user_id = auth.uid() or public.is_trip_organizer(trip_id));

revoke all on public.itinerary_items, public.itinerary_rsvps, public.itinerary_comments from anon;
revoke insert, update on public.itinerary_items from authenticated;
grant insert (trip_id, day, title, starts_at, ends_at, place_name, address, lat, lng, notes) on public.itinerary_items to authenticated;
grant update (day, title, starts_at, ends_at, place_name, address, lat, lng, notes) on public.itinerary_items to authenticated;
revoke insert, update, delete on public.itinerary_rsvps from authenticated;
revoke insert, update on public.itinerary_comments from authenticated;
grant insert (item_id, trip_id, body) on public.itinerary_comments to authenticated;

revoke execute on function public.guard_itinerary_item() from public, anon, authenticated;
revoke execute on function public.handle_itinerary_comment() from public, anon, authenticated;
revoke execute on function public.move_itinerary_item(uuid, boolean) from public, anon;
revoke execute on function public.set_itinerary_rsvp(uuid, text) from public, anon;
grant execute on function public.move_itinerary_item(uuid, boolean) to authenticated;
grant execute on function public.set_itinerary_rsvp(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.itinerary_items, public.itinerary_rsvps, public.itinerary_comments;
  end if;
end;
$$;
