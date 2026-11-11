-- Real places and better polls.
--
--  * trips.destination_lat / destination_lng: the map point of the destination
--    picked from address search, so searches for places on the trip can look
--    near it first.
--  * Polls can allow more than one choice (trip_polls.multiple). A vote is now
--    one row per chosen option.
--  * Whoever started a poll, or the trip organizer, can edit it while it's open
--    (update_poll): the question, the options, the closing time and the rules.

-- ---------------------------------------------------------------------------
-- Destination map point
-- ---------------------------------------------------------------------------
alter table public.trips
  add column if not exists destination_lat double precision check (destination_lat is null or destination_lat between -90 and 90),
  add column if not exists destination_lng double precision check (destination_lng is null or destination_lng between -180 and 180);
alter table public.trips drop constraint if exists trips_destination_point_complete;
alter table public.trips add constraint trips_destination_point_complete check ((destination_lat is null) = (destination_lng is null));
grant update (destination_lat, destination_lng) on public.trips to authenticated;

-- ---------------------------------------------------------------------------
-- Polls: more than one choice, and editing
-- ---------------------------------------------------------------------------
alter table public.trip_polls
  add column if not exists multiple boolean not null default false,
  add column if not exists updated_at timestamptz;

-- One row per chosen option (was one row per person). The key is a plain id,
-- not (poll, person, option): a key made of both links would make the API see
-- poll_votes as a join table between polls and options, so a query for a
-- poll's options (as older app versions send) would become ambiguous.
alter table public.poll_votes drop constraint if exists poll_votes_pkey;
alter table public.poll_votes add column if not exists id bigint generated always as identity;
alter table public.poll_votes add primary key (id);
alter table public.poll_votes drop constraint if exists poll_votes_one_per_option;
alter table public.poll_votes add constraint poll_votes_one_per_option unique (poll_id, user_id, option_id);

drop function if exists public.create_poll(uuid, text, text[], timestamptz, boolean);
create or replace function public.create_poll(
  p_trip uuid,
  p_question text,
  p_options text[],
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
  v_id uuid;
  v_label text;
  v_i int := 0;
  v_member record;
  v_who text;
  v_trip_name text;
begin
  if not public.is_trip_member(p_trip) then
    raise exception 'You are not in this trip.' using errcode = '42501';
  end if;
  if not public.trip_is_active(p_trip) then
    raise exception 'This trip has ended.' using errcode = '22023';
  end if;
  if nullif(btrim(p_question), '') is null then
    raise exception 'Ask a question.' using errcode = '22023';
  end if;
  if cardinality(p_options) > 8
     or (select count(distinct lower(btrim(o))) from unnest(coalesce(p_options, '{}')) o where btrim(o) <> '') < 2 then
    raise exception 'Give 2 to 8 different options.' using errcode = '22023';
  end if;
  if p_closes_at is not null and p_closes_at <= now() then
    raise exception 'The closing time has to be in the future.' using errcode = '22023';
  end if;
  if (select count(*) from public.trip_polls where created_by = auth.uid() and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'You''re starting polls very fast. Try again in a few minutes.' using errcode = '54000';
  end if;
  insert into public.trip_polls (trip_id, created_by, question, allow_change, closes_at, multiple)
  values (p_trip, auth.uid(), btrim(p_question), coalesce(p_allow_change, true), p_closes_at, coalesce(p_multiple, false))
  returning id into v_id;
  -- Keep the order the options were given in.
  foreach v_label in array p_options loop
    v_label := left(btrim(v_label), 120);
    continue when v_label = '' or exists (select 1 from public.poll_options where poll_id = v_id and lower(label) = lower(v_label));
    insert into public.poll_options (poll_id, trip_id, label, position) values (v_id, p_trip, v_label, v_i);
    v_i := v_i + 1;
  end loop;

  perform public.post_event(p_trip, auth.uid(), jsonb_build_object('type', 'poll_created', 'label', btrim(p_question), 'poll_id', v_id));
  v_who := public.display_name_of(auth.uid());
  select name into v_trip_name from public.trips where id = p_trip;
  for v_member in select m.user_id from public.trip_members m where m.trip_id = p_trip and m.user_id <> auth.uid() loop
    if public.wants_notification(v_member.user_id, 'posts', true) then
      perform public.notify(v_member.user_id, p_trip, 'poll_created', v_trip_name,
        v_who || ' asks: ' || left(btrim(p_question), 120), jsonb_build_object('trip_id', p_trip, 'poll_id', v_id));
    end if;
  end loop;
  return v_id;
end;
$$;

-- Vote. One-choice polls: pick an option (replacing your vote if changes are
-- allowed), or null to withdraw. More-than-one polls: each call ticks or
-- unticks one option; null clears all your picks. When changes aren't
-- allowed, picks can be added but not taken back.
create or replace function public.vote_poll(p_poll uuid, p_option uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.trip_polls%rowtype;
  v_mine uuid[];
begin
  select * into v_p from public.trip_polls where id = p_poll;
  if not found or not public.is_trip_member(v_p.trip_id) then
    raise exception 'Poll not found.' using errcode = 'P0002';
  end if;
  if not public.poll_is_open(v_p) then
    raise exception 'This poll is closed.' using errcode = '22023';
  end if;
  select coalesce(array_agg(option_id), '{}') into v_mine from public.poll_votes where poll_id = p_poll and user_id = auth.uid();

  if p_option is null then
    if cardinality(v_mine) > 0 and not v_p.allow_change then
      raise exception 'This poll doesn''t allow changing your vote.' using errcode = '22023';
    end if;
    delete from public.poll_votes where poll_id = p_poll and user_id = auth.uid();
    return;
  end if;
  if not exists (select 1 from public.poll_options where id = p_option and poll_id = p_poll) then
    raise exception 'That isn''t one of the options.' using errcode = '22023';
  end if;

  if v_p.multiple then
    if p_option = any (v_mine) then
      if not v_p.allow_change then
        raise exception 'This poll doesn''t allow changing your vote.' using errcode = '22023';
      end if;
      delete from public.poll_votes where poll_id = p_poll and user_id = auth.uid() and option_id = p_option;
    else
      insert into public.poll_votes (poll_id, option_id, trip_id, user_id) values (p_poll, p_option, v_p.trip_id, auth.uid());
    end if;
    return;
  end if;

  if p_option = any (v_mine) then
    return;
  end if;
  if cardinality(v_mine) > 0 and not v_p.allow_change then
    raise exception 'This poll doesn''t allow changing your vote.' using errcode = '22023';
  end if;
  delete from public.poll_votes where poll_id = p_poll and user_id = auth.uid();
  insert into public.poll_votes (poll_id, option_id, trip_id, user_id) values (p_poll, p_option, v_p.trip_id, auth.uid());
end;
$$;

-- Edit an open poll: whoever started it, or the organizer.
--   p_options: [{"id": "<existing option id>" | null, "label": "..."}], in order.
--   Options left out are removed, with their votes. Renamed options keep theirs.
--   Switching to one choice keeps each person's first pick.
create or replace function public.update_poll(
  p_poll uuid,
  p_question text,
  p_options jsonb,
  p_closes_at timestamptz,
  p_allow_change boolean,
  p_multiple boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.trip_polls%rowtype;
  v_opt jsonb;
  v_id uuid;
  v_label text;
  v_keep uuid[] := '{}';
  v_i int := 0;
begin
  select * into v_p from public.trip_polls where id = p_poll for update;
  if not found or not public.is_trip_member(v_p.trip_id) then
    raise exception 'Poll not found.' using errcode = 'P0002';
  end if;
  if v_p.created_by <> auth.uid() and not public.is_trip_organizer(v_p.trip_id) then
    raise exception 'Only whoever started the poll or the organizer can edit it.' using errcode = '42501';
  end if;
  if not public.poll_is_open(v_p) then
    raise exception 'This poll is closed.' using errcode = '22023';
  end if;
  if not public.trip_is_active(v_p.trip_id) then
    raise exception 'This trip has ended.' using errcode = '22023';
  end if;
  if nullif(btrim(p_question), '') is null then
    raise exception 'Ask a question.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options) > 8
     or (select count(distinct lower(btrim(o ->> 'label'))) from jsonb_array_elements(p_options) o where btrim(coalesce(o ->> 'label', '')) <> '') < 2 then
    raise exception 'Give 2 to 8 different options.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_options) o where btrim(coalesce(o ->> 'label', '')) <> '')
     <> (select count(distinct lower(btrim(o ->> 'label'))) from jsonb_array_elements(p_options) o where btrim(coalesce(o ->> 'label', '')) <> '') then
    raise exception 'Two options are the same.' using errcode = '22023';
  end if;
  if p_closes_at is not null and p_closes_at <= now() then
    raise exception 'The closing time has to be in the future.' using errcode = '22023';
  end if;

  -- Existing options must belong to this poll.
  for v_opt in select * from jsonb_array_elements(p_options) loop
    if nullif(v_opt ->> 'id', '') is not null then
      v_id := public.try_uuid(v_opt ->> 'id');
      if v_id is null or not exists (select 1 from public.poll_options where id = v_id and poll_id = p_poll) then
        raise exception 'That option isn''t part of this poll.' using errcode = '22023';
      end if;
      v_keep := v_keep || v_id;
    end if;
  end loop;

  delete from public.poll_options where poll_id = p_poll and not (id = any (v_keep));
  -- Move kept options out of the way first, so a new order never collides.
  update public.poll_options set position = position + 100 where poll_id = p_poll;
  for v_opt in select * from jsonb_array_elements(p_options) loop
    v_label := left(btrim(coalesce(v_opt ->> 'label', '')), 120);
    continue when v_label = '';
    v_id := public.try_uuid(nullif(v_opt ->> 'id', ''));
    if v_id is null then
      insert into public.poll_options (poll_id, trip_id, label, position) values (p_poll, v_p.trip_id, v_label, v_i);
    else
      update public.poll_options set label = v_label, position = v_i where id = v_id;
    end if;
    v_i := v_i + 1;
  end loop;

  if v_p.multiple and not coalesce(p_multiple, false) then
    delete from public.poll_votes v
    using public.poll_votes w
    where v.poll_id = p_poll and w.poll_id = p_poll and v.user_id = w.user_id
      and (w.created_at, w.option_id) < (v.created_at, v.option_id);
  end if;

  update public.trip_polls
  set question = btrim(p_question),
      closes_at = p_closes_at,
      allow_change = coalesce(p_allow_change, true),
      multiple = coalesce(p_multiple, false),
      updated_at = now()
  where id = p_poll;
end;
$$;

revoke execute on function public.create_poll(uuid, text, text[], timestamptz, boolean, boolean) from public, anon;
revoke execute on function public.vote_poll(uuid, uuid) from public, anon;
revoke execute on function public.update_poll(uuid, text, jsonb, timestamptz, boolean, boolean) from public, anon;
grant execute on function public.create_poll(uuid, text, text[], timestamptz, boolean, boolean) to authenticated;
grant execute on function public.vote_poll(uuid, uuid) to authenticated;
grant execute on function public.update_poll(uuid, text, jsonb, timestamptz, boolean, boolean) to authenticated;
