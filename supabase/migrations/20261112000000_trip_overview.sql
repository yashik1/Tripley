-- Trip covers and the dashboard summary.
--
--  * trips.destination: where the trip goes ("Lisbon, Portugal"), optional.
--  * trips.cover_path: the trip's cover photo, a file in the private
--    trip-photos bucket inside the trip's own folder. Set by the organizer.
--  * my_trip_overview(): one row per trip you're in, with the counts the
--    dashboard uses for planning progress. Runs with your own permissions
--    (row-level security applies), so it only ever sees your trips.
--
-- Forward-only; adds two nullable columns and a function. No data changes.

alter table public.trips
  add column if not exists destination text check (destination is null or char_length(btrim(destination)) between 1 and 80),
  add column if not exists cover_path text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trips_cover_in_trip_folder') then
    alter table public.trips add constraint trips_cover_in_trip_folder
      check (cover_path is null or cover_path ~ ('^' || id::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$'));
  end if;
end;
$$;

-- The organizer can already update the trip (row policy); allow these columns.
grant update (destination, cover_path) on public.trips to authenticated;

create or replace function public.my_trip_overview()
returns table (trip_id uuid, stats jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, jsonb_build_object(
    'members', (select count(*) from public.trip_members m where m.trip_id = t.id),
    'stops', (select count(*) from public.itinerary_items i where i.trip_id = t.id),
    'places', (select count(*) from public.trip_places p where p.trip_id = t.id),
    'stay_pinned', exists (select 1 from public.trip_places p where p.trip_id = t.id and p.kind = 'stay'),
    'bills', (select count(*) from public.bills b where b.trip_id = t.id),
    'spent_base_minor', coalesce((select sum(b.total_base_minor) from public.bills b where b.trip_id = t.id), 0)
  )
  from public.trips t
  where public.is_trip_member(t.id)
$$;
revoke execute on function public.my_trip_overview() from public, anon;
grant execute on function public.my_trip_overview() to authenticated;
