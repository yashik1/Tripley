-- Save a new order for one day's stops (used by the route suggestion).
--
-- p_items must be exactly that day's stops, each once. The organizer can
-- reorder any day; anyone else only when every stop that changes place is one
-- they added (the same rule as moving a single stop).

create or replace function public.reorder_itinerary_day(p_trip uuid, p_day date, p_items uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current uuid[];
  v_blocked text;
begin
  if not public.is_trip_member(p_trip) then
    raise exception 'Trip not found.' using errcode = 'P0002';
  end if;
  if not public.trip_is_active(p_trip) then
    raise exception 'This trip has ended.' using errcode = '22023';
  end if;

  -- Lock the day so two people reordering at once can't interleave.
  select coalesce(array_agg(i.id order by i.position, i.created_at, i.id), '{}') into v_current
  from (select id, position, created_at from public.itinerary_items where trip_id = p_trip and day = p_day for update) i;

  if coalesce(cardinality(p_items), 0) <> cardinality(v_current)
     or (select count(distinct x) from unnest(p_items) x) <> cardinality(v_current)
     or exists (select 1 from unnest(p_items) x where not (x = any (v_current))) then
    raise exception 'The plan for this day just changed. Have another look and try again.' using errcode = '22023';
  end if;

  if not public.is_trip_organizer(p_trip) then
    select i.title into v_blocked
    from unnest(p_items) with ordinality as n(id, k)
    join public.itinerary_items i on i.id = n.id
    where i.created_by <> auth.uid() and v_current[n.k] <> n.id
    limit 1;
    if v_blocked is not null then
      raise exception 'Only the organizer can move “%”, which someone else added.', v_blocked using errcode = '42501';
    end if;
  end if;

  update public.itinerary_items i
  set position = n.k - 1
  from unnest(p_items) with ordinality as n(id, k)
  where i.id = n.id and i.position is distinct from n.k - 1;
end;
$$;

revoke execute on function public.reorder_itinerary_day(uuid, date, uuid[]) from public, anon;
grant execute on function public.reorder_itinerary_day(uuid, date, uuid[]) to authenticated;
