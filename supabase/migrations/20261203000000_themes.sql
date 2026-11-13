-- Themes.
--  * Your appearance: System, Light or Dark, and a colour palette for the
--    whole app. Saved on your profile so every device you use matches.
--  * Trip themes: the organizer can give a trip a theme (beach, ski, city
--    break, road trip, camping, celebration). It sets the trip's colours and
--    cover art and tailors packing, scavenger-hunt and bucket-list ideas.
--    A template keeps its trip's theme.

alter table public.profiles
  add column if not exists appearance text not null default 'system'
    check (appearance in ('system', 'light', 'dark')),
  add column if not exists palette text not null default 'teal'
    check (palette in ('teal', 'ocean', 'sunset', 'forest', 'lavender', 'midnight', 'berry'));
grant update (appearance, palette) on public.profiles to authenticated;

alter table public.trips
  add column if not exists theme text
    check (theme is null or theme in ('beach', 'ski', 'city', 'road_trip', 'camping', 'celebration'));
-- Only the organizer can update a trip (policy "trips: organizer can update").
grant update (theme) on public.trips to authenticated;

-- Save a trip you're on as a template (yours only).
create or replace function public.save_trip_as_template(p_trip uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips%rowtype;
  v_first date;
  v_last date;
  v_days int;
  v_data jsonb;
  v_id uuid;
begin
  select * into v_trip from public.trips where id = p_trip;
  if not found or not public.is_trip_member(p_trip) then
    raise exception 'Trip not found.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.trip_templates where owner_id = auth.uid()) >= 50 then
    raise exception 'You can keep up to 50 templates. Remove one first.' using errcode = '54000';
  end if;
  select coalesce(v_trip.starts_on, min(day)), coalesce(v_trip.ends_on, max(day)) into v_first, v_last
  from public.itinerary_items where trip_id = p_trip;
  v_first := coalesce(v_first, (now() at time zone 'utc')::date);
  v_days := least(60, greatest(1, coalesce(v_last, v_first) - v_first + 1));
  v_data := jsonb_build_object(
    'theme', v_trip.theme,
    'stops', coalesce((
      select jsonb_agg(jsonb_build_object(
        'offset', i.day - v_first, 'title', i.title, 'starts_at', i.starts_at, 'ends_at', i.ends_at,
        'place_name', i.place_name, 'address', i.address, 'lat', i.lat, 'lng', i.lng) order by i.day, i.starts_at nulls last, i.position)
      from public.itinerary_items i
      where i.trip_id = p_trip and i.day between v_first and v_first + 59
    ), '[]'::jsonb),
    'ideas', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'category', s.category, 'description', s.description, 'address', s.address, 'lat', s.lat, 'lng', s.lng) order by s.created_at)
      from public.trip_suggestions s where s.trip_id = p_trip
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(t.title order by t.created_at) from public.trip_tasks t where t.trip_id = p_trip and t.kind = 'group'
    ), '[]'::jsonb),
    'packing', coalesce((
      select jsonb_agg(t.title order by t.created_at) from public.trip_tasks t where t.trip_id = p_trip and t.kind = 'packing' and t.created_by = auth.uid()
    ), '[]'::jsonb)
  );
  insert into public.trip_templates (owner_id, name, destination, base_currency, days, data)
  values (auth.uid(), left(btrim(coalesce(nullif(btrim(p_name), ''), v_trip.name)), 80), v_trip.destination, v_trip.base_currency, v_days, v_data)
  returning id into v_id;
  return v_id;
end;
$$;

-- Start a new trip (you organize it) from one of your templates.
create or replace function public.start_trip_from_template(p_template uuid, p_name text, p_starts_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.trip_templates%rowtype;
  v_trip uuid;
  v_end date;
  v_stop jsonb;
  v_idea jsonb;
  v_title text;
begin
  select * into v_t from public.trip_templates where id = p_template and owner_id = auth.uid();
  if not found then
    raise exception 'Template not found.' using errcode = 'P0002';
  end if;
  if p_starts_on is null or p_starts_on < (now() at time zone 'utc')::date - 1 then
    raise exception 'Pick a start day from today on.' using errcode = '22023';
  end if;
  v_end := p_starts_on + v_t.days - 1;
  insert into public.trips (name, base_currency, starts_on, ends_on, destination, organizer_id, theme)
  values (left(btrim(coalesce(nullif(btrim(p_name), ''), v_t.name)), 80), v_t.base_currency, p_starts_on, v_end, v_t.destination, auth.uid(),
    case when v_t.data ->> 'theme' in ('beach', 'ski', 'city', 'road_trip', 'camping', 'celebration') then v_t.data ->> 'theme' end)
  returning id into v_trip;

  for v_stop in select * from jsonb_array_elements(v_t.data -> 'stops') loop
    if (v_stop ->> 'offset')::int between 0 and v_t.days - 1 then
      insert into public.itinerary_items (trip_id, day, title, starts_at, ends_at, place_name, address, lat, lng)
      values (v_trip, p_starts_on + (v_stop ->> 'offset')::int, left(v_stop ->> 'title', 120), (v_stop ->> 'starts_at')::time, (v_stop ->> 'ends_at')::time,
        left(v_stop ->> 'place_name', 120), left(v_stop ->> 'address', 300), (v_stop ->> 'lat')::double precision, (v_stop ->> 'lng')::double precision);
    end if;
  end loop;
  for v_idea in select * from jsonb_array_elements(v_t.data -> 'ideas') loop
    insert into public.trip_suggestions (trip_id, category, name, description, address, lat, lng)
    values (v_trip, v_idea ->> 'category', left(v_idea ->> 'name', 120), left(v_idea ->> 'description', 1000), left(v_idea ->> 'address', 300),
      (v_idea ->> 'lat')::double precision, (v_idea ->> 'lng')::double precision);
  end loop;
  for v_title in select jsonb_array_elements_text(v_t.data -> 'tasks') loop
    insert into public.trip_tasks (trip_id, kind, title) values (v_trip, 'group', left(v_title, 120));
  end loop;
  for v_title in select jsonb_array_elements_text(v_t.data -> 'packing') loop
    insert into public.trip_tasks (trip_id, kind, title) values (v_trip, 'packing', left(v_title, 120));
  end loop;
  return v_trip;
end;
$$;
