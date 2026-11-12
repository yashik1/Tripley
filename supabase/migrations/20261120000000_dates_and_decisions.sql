-- Finding dates together, and turning decisions into plans.
--
--  * Date coordination: the organizer opens a window to choose from
--    ("sometime in March, for 4 days"). Everyone ticks the days they can go
--    (yes or maybe). The app shows the best stretches; the organizer sets the
--    trip dates from one (an ordinary trip update), whether or not everyone
--    can make it. The organizer can remind people who haven't answered.
--  * Decisions: a poll can be made from bucket-list ideas, and a poll's
--    option (usually the winner) goes into the plan once, in one step.

-- ---------------------------------------------------------------------------
-- Date coordination
-- ---------------------------------------------------------------------------
alter table public.trips
  add column if not exists date_window_start date,
  add column if not exists date_window_end date,
  add column if not exists date_length int;
alter table public.trips drop constraint if exists trips_date_window_valid;
alter table public.trips add constraint trips_date_window_valid check (
  (date_window_start is null) = (date_window_end is null)
  and (date_window_end is null or (date_window_end >= date_window_start and date_window_end <= date_window_start + 366))
  and (date_length is null or date_length between 1 and 60)
);

create table if not exists public.trip_availability (
  trip_id uuid not null,
  user_id uuid not null,
  day date not null,
  status text not null check (status in ('yes', 'maybe')),
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id, day),
  -- Leaving the trip removes your answers.
  foreign key (trip_id, user_id) references public.trip_members (trip_id, user_id) on delete cascade
);
create index if not exists trip_availability_trip_idx on public.trip_availability (trip_id, day);

alter table public.trip_availability enable row level security;
drop policy if exists "availability: members can read" on public.trip_availability;
create policy "availability: members can read" on public.trip_availability for select to authenticated
  using (public.is_trip_member(trip_id));
revoke all on public.trip_availability from anon;
revoke insert, update, delete on public.trip_availability from authenticated;
grant select on public.trip_availability to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_availability') then
    alter publication supabase_realtime add table public.trip_availability;
  end if;
end;
$$;

-- The organizer opens (or changes, or with nulls closes) the window to choose dates from.
create or replace function public.set_date_window(p_trip uuid, p_start date, p_end date, p_length int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips%rowtype;
  v_member record;
  v_who text;
begin
  select * into v_trip from public.trips where id = p_trip for update;
  if not found or not public.is_trip_member(p_trip) then
    raise exception 'Trip not found.' using errcode = 'P0002';
  end if;
  if not public.is_trip_organizer(p_trip) then
    raise exception 'Only the organizer can choose the dates to pick from.' using errcode = '42501';
  end if;
  if not public.trip_is_active(p_trip) then
    raise exception 'This trip has ended.' using errcode = '22023';
  end if;
  if p_start is null then
    update public.trips set date_window_start = null, date_window_end = null, date_length = null where id = p_trip;
    return;
  end if;
  if p_end is null or p_end < p_start then
    raise exception 'The last day has to be on or after the first.' using errcode = '22023';
  end if;
  if p_start < (now() at time zone 'utc')::date - 1 then
    raise exception 'Pick days from today on.' using errcode = '22023';
  end if;
  if p_end > p_start + 366 then
    raise exception 'Pick from up to a year at a time.' using errcode = '22023';
  end if;
  if p_length is null or p_length < 1 or p_length > 60 or p_length > p_end - p_start + 1 then
    raise exception 'The trip length has to fit in the days to pick from.' using errcode = '22023';
  end if;
  update public.trips set date_window_start = p_start, date_window_end = p_end, date_length = p_length where id = p_trip;
  -- Answers outside a narrower window no longer count.
  delete from public.trip_availability where trip_id = p_trip and (day < p_start or day > p_end);

  if v_trip.date_window_start is null then
    perform public.post_event(p_trip, auth.uid(), jsonb_build_object('type', 'dates_asked', 'label', p_length || ' days'));
    v_who := public.display_name_of(auth.uid());
    for v_member in select m.user_id from public.trip_members m where m.trip_id = p_trip and m.user_id <> auth.uid() loop
      perform public.notify(v_member.user_id, p_trip, 'dates_asked', v_trip.name,
        v_who || ' asks which days you can go. Tick yours.', jsonb_build_object('trip_id', p_trip));
    end loop;
  end if;
end;
$$;

-- Your days: replaces all your answers for the trip. Days must be in the window.
create or replace function public.set_my_availability(p_trip uuid, p_yes date[], p_maybe date[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips%rowtype;
begin
  select * into v_trip from public.trips where id = p_trip;
  if not found or not public.is_trip_member(p_trip) then
    raise exception 'Trip not found.' using errcode = 'P0002';
  end if;
  if not public.trip_is_active(p_trip) then
    raise exception 'This trip has ended.' using errcode = '22023';
  end if;
  if v_trip.date_window_start is null then
    raise exception 'The organizer hasn''t asked about dates.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_yes), 0) + coalesce(cardinality(p_maybe), 0) > 400 then
    raise exception 'That''s too many days.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_yes, '{}') || coalesce(p_maybe, '{}')) d
    where d < v_trip.date_window_start or d > v_trip.date_window_end
  ) then
    raise exception 'Pick days between % and %.', to_char(v_trip.date_window_start, 'Mon DD'), to_char(v_trip.date_window_end, 'Mon DD')
      using errcode = '22023';
  end if;
  delete from public.trip_availability where trip_id = p_trip and user_id = auth.uid();
  insert into public.trip_availability (trip_id, user_id, day, status)
  select p_trip, auth.uid(), d, 'yes' from (select distinct unnest(coalesce(p_yes, '{}')) d) y;
  insert into public.trip_availability (trip_id, user_id, day, status)
  select p_trip, auth.uid(), d, 'maybe' from (select distinct unnest(coalesce(p_maybe, '{}')) d) m
  where not (d = any (coalesce(p_yes, '{}')));
end;
$$;

-- The organizer nudges everyone who hasn't ticked any days. At most every 12 hours.
create or replace function public.remind_availability(p_trip uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips%rowtype;
  v_count int := 0;
  v_member record;
begin
  select * into v_trip from public.trips where id = p_trip for update;
  if not found or not public.is_trip_member(p_trip) then
    raise exception 'Trip not found.' using errcode = 'P0002';
  end if;
  if not public.is_trip_organizer(p_trip) then
    raise exception 'Only the organizer can send reminders.' using errcode = '42501';
  end if;
  if v_trip.date_window_start is null then
    raise exception 'Ask about dates first.' using errcode = '22023';
  end if;
  if exists (select 1 from public.notifications where trip_id = p_trip and kind = 'dates_reminder' and created_at > now() - interval '12 hours') then
    raise exception 'You reminded everyone recently. Try again later.' using errcode = '54000';
  end if;
  for v_member in
    select m.user_id from public.trip_members m
    where m.trip_id = p_trip and m.user_id <> auth.uid()
      and not exists (select 1 from public.trip_availability a where a.trip_id = p_trip and a.user_id = m.user_id)
  loop
    perform public.notify(v_member.user_id, p_trip, 'dates_reminder', v_trip.name,
      'Which days can you go? Tick yours so the group can pick dates.', jsonb_build_object('trip_id', p_trip));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Decisions into plans
-- ---------------------------------------------------------------------------
alter table public.poll_options
  add column if not exists suggestion_id uuid references public.trip_suggestions (id) on delete set null,
  add column if not exists itinerary_item_id uuid references public.itinerary_items (id) on delete set null;

-- A poll whose options are bucket-list ideas.
create or replace function public.create_poll_from_ideas(
  p_trip uuid,
  p_question text,
  p_suggestions uuid[],
  p_closes_at timestamptz default null,
  p_allow_change boolean default true,
  p_multiple boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_names text[];
  v_poll uuid;
begin
  if coalesce(cardinality(p_suggestions), 0) not between 2 and 8 then
    raise exception 'Pick 2 to 8 ideas.' using errcode = '22023';
  end if;
  select array_agg(btrim(s.name) order by k) into v_names
  from unnest(p_suggestions) with ordinality as x(id, k)
  join public.trip_suggestions s on s.id = x.id and s.trip_id = p_trip;
  if coalesce(cardinality(v_names), 0) <> cardinality(p_suggestions) then
    raise exception 'Those ideas aren''t all on this trip''s bucket list.' using errcode = '22023';
  end if;
  v_poll := public.create_poll(p_trip, p_question, v_names, p_closes_at, p_allow_change, p_multiple);
  update public.poll_options o
  set suggestion_id = s.id
  from public.trip_suggestions s
  where o.poll_id = v_poll and s.id = any (p_suggestions) and lower(o.label) = lower(left(btrim(s.name), 120));
  return v_poll;
end;
$$;

-- Put a poll option into the plan, once (a second press, or a second person,
-- gets the same stop). An option made from an idea becomes that idea's stop.
create or replace function public.add_poll_option_to_plan(p_option uuid, p_day date default null, p_starts_at time default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.poll_options%rowtype;
  v_trip public.trips%rowtype;
  v_item uuid;
begin
  select * into v_o from public.poll_options where id = p_option for update;
  if not found or not public.is_trip_member(v_o.trip_id) then
    raise exception 'Option not found.' using errcode = 'P0002';
  end if;
  if v_o.itinerary_item_id is not null and exists (select 1 from public.itinerary_items where id = v_o.itinerary_item_id) then
    return v_o.itinerary_item_id;
  end if;
  if not public.trip_is_active(v_o.trip_id) then
    raise exception 'This trip has ended.' using errcode = '22023';
  end if;
  if v_o.suggestion_id is not null then
    v_item := public.add_suggestion_to_plan(v_o.suggestion_id, p_day, p_starts_at);
  else
    select * into v_trip from public.trips where id = v_o.trip_id;
    insert into public.itinerary_items (trip_id, day, title, starts_at, created_by)
    values (
      v_o.trip_id,
      coalesce(p_day, greatest(v_trip.starts_on, (now() at time zone 'utc')::date), (now() at time zone 'utc')::date),
      v_o.label, p_starts_at, auth.uid()
    )
    returning id into v_item;
  end if;
  update public.poll_options set itinerary_item_id = v_item where id = p_option;
  return v_item;
end;
$$;

revoke execute on function public.set_date_window(uuid, date, date, int) from public, anon;
revoke execute on function public.set_my_availability(uuid, date[], date[]) from public, anon;
revoke execute on function public.remind_availability(uuid) from public, anon;
revoke execute on function public.create_poll_from_ideas(uuid, text, uuid[], timestamptz, boolean, boolean) from public, anon;
revoke execute on function public.add_poll_option_to_plan(uuid, date, time) from public, anon;
grant execute on function public.set_date_window(uuid, date, date, int) to authenticated;
grant execute on function public.set_my_availability(uuid, date[], date[]) to authenticated;
grant execute on function public.remind_availability(uuid) to authenticated;
grant execute on function public.create_poll_from_ideas(uuid, text, uuid[], timestamptz, boolean, boolean) to authenticated;
grant execute on function public.add_poll_option_to_plan(uuid, date, time) to authenticated;
