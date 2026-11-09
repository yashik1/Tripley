-- Bucket list and group polls.
--
--  * trip_suggestions: places and things to do anyone in the trip suggests
--    (category, name, description, address, map point, optional photo,
--    estimated cost, preferred day). suggestion_votes: one vote per person.
--    add_suggestion_to_plan() turns a suggestion into an itinerary stop
--    exactly once (the suggestion remembers its stop), even if two people
--    press it at the same time.
--  * trip_polls / poll_options / poll_votes: a question with 2-8 options,
--    one vote per person (changeable if the poll allows it, or withdrawn),
--    an optional closing time, and closing by its creator or the organizer.
--
-- Only current trip members can read any of it; ended trips are read-only.
-- Forward-only; adds tables, functions and triggers. No existing data changes.

-- ---------------------------------------------------------------------------
-- Bucket list
-- ---------------------------------------------------------------------------
create table public.trip_suggestions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  suggested_by uuid not null default auth.uid() references public.profiles (id),
  category text not null check (category in ('food', 'sight', 'beach', 'hike', 'experience', 'shopping', 'nightlife', 'other')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 1000),
  address text check (address is null or char_length(address) <= 300),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  photo_path text,
  cost_minor bigint check (cost_minor is null or cost_minor between 0 and 1000000000000),
  cost_currency text check (cost_currency is null or cost_currency ~ '^[A-Z]{3}$'),
  preferred_day date,
  -- The stop it became, so it's only ever added to the plan once.
  itinerary_item_id uuid unique references public.itinerary_items (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint suggestions_point_complete check ((lat is null) = (lng is null)),
  constraint suggestions_cost_complete check ((cost_minor is null) = (cost_currency is null)),
  constraint suggestions_photo_in_trip_folder check (photo_path is null or photo_path ~ ('^' || trip_id::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$'))
);
create index trip_suggestions_trip_idx on public.trip_suggestions (trip_id, created_at desc);

create table public.suggestion_votes (
  suggestion_id uuid not null references public.trip_suggestions (id) on delete cascade,
  trip_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (suggestion_id, user_id),
  foreign key (trip_id, user_id) references public.trip_members (trip_id, user_id) on delete cascade
);
create index suggestion_votes_trip_idx on public.suggestion_votes (trip_id);

create or replace function public.guard_suggestion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.suggested_by := coalesce(auth.uid(), new.suggested_by);
    new.itinerary_item_id := null;
    new.created_at := now();
    if (select count(*) from public.trip_suggestions where suggested_by = new.suggested_by and created_at > now() - interval '10 minutes') >= 30 then
      raise exception 'You''re adding ideas very fast. Try again in a few minutes.' using errcode = '54000';
    end if;
  elsif new.trip_id <> old.trip_id or new.suggested_by <> old.suggested_by then
    raise exception 'A suggestion can''t move to another trip.' using errcode = '42501';
  end if;
  new.name := btrim(new.name);
  new.description := nullif(btrim(new.description), '');
  new.address := nullif(btrim(new.address), '');
  -- A photo must be one this person uploaded into the trip's folder.
  if new.photo_path is not null and (tg_op = 'INSERT' or new.photo_path is distinct from old.photo_path)
     and not exists (select 1 from storage.objects o where o.bucket_id = 'trip-photos' and o.name = new.photo_path and o.owner = auth.uid()) then
    raise exception 'The photo couldn''t be found. Try adding it again.' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger trip_suggestions_guard before insert or update on public.trip_suggestions
  for each row execute function public.guard_suggestion();

create or replace function public.toggle_suggestion_vote(p_suggestion uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip uuid;
begin
  select trip_id into v_trip from public.trip_suggestions where id = p_suggestion;
  if v_trip is null or not public.is_trip_member(v_trip) then
    raise exception 'Suggestion not found.' using errcode = 'P0002';
  end if;
  if not public.trip_is_active(v_trip) then
    raise exception 'This trip has ended.' using errcode = '22023';
  end if;
  delete from public.suggestion_votes where suggestion_id = p_suggestion and user_id = auth.uid();
  if found then
    return false;
  end if;
  insert into public.suggestion_votes (suggestion_id, trip_id, user_id) values (p_suggestion, v_trip, auth.uid());
  return true;
end;
$$;

-- Turn a suggestion into a stop in the plan, once. Returns the stop's id.
create or replace function public.add_suggestion_to_plan(p_suggestion uuid, p_day date default null, p_starts_at time default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.trip_suggestions%rowtype;
  v_trip public.trips%rowtype;
  v_item uuid;
begin
  -- The lock makes a second press (or a second person) wait, then find the stop.
  select * into v_s from public.trip_suggestions where id = p_suggestion for update;
  if not found or not public.is_trip_member(v_s.trip_id) then
    raise exception 'Suggestion not found.' using errcode = 'P0002';
  end if;
  if v_s.itinerary_item_id is not null and exists (select 1 from public.itinerary_items where id = v_s.itinerary_item_id) then
    return v_s.itinerary_item_id;
  end if;
  if not public.trip_is_active(v_s.trip_id) then
    raise exception 'This trip has ended.' using errcode = '22023';
  end if;
  select * into v_trip from public.trips where id = v_s.trip_id;
  insert into public.itinerary_items (trip_id, day, title, starts_at, place_name, address, lat, lng, notes, created_by)
  values (
    v_s.trip_id,
    coalesce(p_day, v_s.preferred_day, greatest(v_trip.starts_on, (now() at time zone 'utc')::date), (now() at time zone 'utc')::date),
    v_s.name, p_starts_at, v_s.name, v_s.address, v_s.lat, v_s.lng, v_s.description, auth.uid()
  )
  returning id into v_item;
  update public.trip_suggestions set itinerary_item_id = v_item where id = p_suggestion;
  return v_item;
end;
$$;

-- ---------------------------------------------------------------------------
-- Polls
-- ---------------------------------------------------------------------------
create table public.trip_polls (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  question text not null check (char_length(btrim(question)) between 1 and 200),
  allow_change boolean not null default true,
  closes_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index trip_polls_trip_idx on public.trip_polls (trip_id, created_at desc);

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.trip_polls (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  position int not null default 0
);
create index poll_options_poll_idx on public.poll_options (poll_id, position);

create table public.poll_votes (
  poll_id uuid not null references public.trip_polls (id) on delete cascade,
  option_id uuid not null references public.poll_options (id) on delete cascade,
  trip_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id),
  foreign key (trip_id, user_id) references public.trip_members (trip_id, user_id) on delete cascade
);
create index poll_votes_trip_idx on public.poll_votes (trip_id);

create or replace function public.poll_is_open(p public.trip_polls)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p.closed_at is null and (p.closes_at is null or p.closes_at > now())
$$;

create or replace function public.create_poll(
  p_trip uuid,
  p_question text,
  p_options text[],
  p_closes_at timestamptz default null,
  p_allow_change boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_opts text[];
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
  select array_agg(distinct x) into v_opts from (select btrim(o) as x from unnest(coalesce(p_options, '{}')) o) s where x <> '';
  if coalesce(cardinality(v_opts), 0) < 2 or cardinality(p_options) > 8 then
    raise exception 'Give 2 to 8 different options.' using errcode = '22023';
  end if;
  if p_closes_at is not null and p_closes_at <= now() then
    raise exception 'The closing time has to be in the future.' using errcode = '22023';
  end if;
  if (select count(*) from public.trip_polls where created_by = auth.uid() and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'You''re starting polls very fast. Try again in a few minutes.' using errcode = '54000';
  end if;
  insert into public.trip_polls (trip_id, created_by, question, allow_change, closes_at)
  values (p_trip, auth.uid(), btrim(p_question), coalesce(p_allow_change, true), p_closes_at)
  returning id into v_id;
  -- Keep the order the options were given in.
  foreach v_label in array p_options loop
    v_label := btrim(v_label);
    continue when v_label = '' or exists (select 1 from public.poll_options where poll_id = v_id and label = v_label);
    insert into public.poll_options (poll_id, trip_id, label, position) values (v_id, p_trip, left(v_label, 120), v_i);
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

-- Vote for an option, change your vote (if allowed), or withdraw it (null).
create or replace function public.vote_poll(p_poll uuid, p_option uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.trip_polls%rowtype;
  v_existing uuid;
begin
  select * into v_p from public.trip_polls where id = p_poll;
  if not found or not public.is_trip_member(v_p.trip_id) then
    raise exception 'Poll not found.' using errcode = 'P0002';
  end if;
  if not public.poll_is_open(v_p) then
    raise exception 'This poll is closed.' using errcode = '22023';
  end if;
  select option_id into v_existing from public.poll_votes where poll_id = p_poll and user_id = auth.uid();
  if v_existing is not null and not v_p.allow_change and v_existing is distinct from p_option then
    raise exception 'This poll doesn''t allow changing your vote.' using errcode = '22023';
  end if;
  if p_option is null then
    delete from public.poll_votes where poll_id = p_poll and user_id = auth.uid();
    return;
  end if;
  if not exists (select 1 from public.poll_options where id = p_option and poll_id = p_poll) then
    raise exception 'That isn''t one of the options.' using errcode = '22023';
  end if;
  insert into public.poll_votes (poll_id, option_id, trip_id, user_id) values (p_poll, p_option, v_p.trip_id, auth.uid())
  on conflict (poll_id, user_id) do update set option_id = excluded.option_id, created_at = now();
end;
$$;

create or replace function public.close_poll(p_poll uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.trip_polls%rowtype;
  v_winner text;
  v_member record;
begin
  select * into v_p from public.trip_polls where id = p_poll for update;
  if not found or not public.is_trip_member(v_p.trip_id) then
    raise exception 'Poll not found.' using errcode = 'P0002';
  end if;
  if v_p.created_by <> auth.uid() and not public.is_trip_organizer(v_p.trip_id) then
    raise exception 'Only whoever started the poll or the organizer can close it.' using errcode = '42501';
  end if;
  if v_p.closed_at is not null then
    return;
  end if;
  update public.trip_polls set closed_at = now() where id = p_poll;
  select o.label into v_winner from public.poll_options o
    left join public.poll_votes v on v.option_id = o.id
    where o.poll_id = p_poll group by o.id, o.label, o.position
    having count(v.user_id) > 0
    order by count(v.user_id) desc, o.position limit 1;
  for v_member in select m.user_id from public.trip_members m where m.trip_id = v_p.trip_id and m.user_id <> auth.uid() loop
    if public.wants_notification(v_member.user_id, 'posts', true) then
      perform public.notify(v_member.user_id, v_p.trip_id, 'poll_closed', (select name from public.trips where id = v_p.trip_id),
        '"' || left(v_p.question, 80) || '" is closed' || coalesce(': ' || v_winner || ' won', ' with no votes'),
        jsonb_build_object('trip_id', v_p.trip_id, 'poll_id', p_poll));
    end if;
  end loop;
end;
$$;

-- New suggestions show up in the feed.
create or replace function public.handle_suggestion_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.post_event(new.trip_id, new.suggested_by, jsonb_build_object(
    'type', 'suggestion_added', 'label', new.name, 'category', new.category, 'suggestion_id', new.id));
  return new;
end;
$$;
create trigger feed_suggestion_added after insert on public.trip_suggestions
  for each row execute function public.handle_suggestion_event();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.trip_suggestions enable row level security;
alter table public.suggestion_votes enable row level security;
alter table public.trip_polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

create policy "suggestions: members can read" on public.trip_suggestions for select to authenticated using (public.is_trip_member(trip_id));
create policy "suggestions: members suggest while the trip is on" on public.trip_suggestions for insert to authenticated
  with check (public.is_trip_member(trip_id) and public.trip_is_active(trip_id));
create policy "suggestions: who suggested it or the organizer edits" on public.trip_suggestions for update to authenticated
  using (public.is_trip_member(trip_id) and (suggested_by = auth.uid() or public.is_trip_organizer(trip_id)))
  with check (public.trip_is_active(trip_id));
create policy "suggestions: who suggested it or the organizer removes" on public.trip_suggestions for delete to authenticated
  using (public.is_trip_member(trip_id) and (suggested_by = auth.uid() or public.is_trip_organizer(trip_id)));
create policy "suggestion votes: members can read" on public.suggestion_votes for select to authenticated using (public.is_trip_member(trip_id));
create policy "polls: members can read" on public.trip_polls for select to authenticated using (public.is_trip_member(trip_id));
create policy "poll options: members can read" on public.poll_options for select to authenticated using (public.is_trip_member(trip_id));
create policy "poll votes: members can read" on public.poll_votes for select to authenticated using (public.is_trip_member(trip_id));
create policy "polls: whoever started it or the organizer removes" on public.trip_polls for delete to authenticated
  using (public.is_trip_member(trip_id) and (created_by = auth.uid() or public.is_trip_organizer(trip_id)));

revoke all on public.trip_suggestions, public.suggestion_votes, public.trip_polls, public.poll_options, public.poll_votes from anon;
revoke insert, update on public.trip_suggestions from authenticated;
grant insert (trip_id, category, name, description, address, lat, lng, photo_path, cost_minor, cost_currency, preferred_day)
  on public.trip_suggestions to authenticated;
grant update (category, name, description, address, lat, lng, photo_path, cost_minor, cost_currency, preferred_day)
  on public.trip_suggestions to authenticated;
revoke insert, update, delete on public.suggestion_votes, public.poll_options, public.poll_votes from authenticated;
revoke insert, update on public.trip_polls from authenticated;

revoke execute on function public.guard_suggestion() from public, anon, authenticated;
revoke execute on function public.handle_suggestion_event() from public, anon, authenticated;
revoke execute on function public.poll_is_open(public.trip_polls) from public, anon, authenticated;
revoke execute on function public.toggle_suggestion_vote(uuid) from public, anon;
revoke execute on function public.add_suggestion_to_plan(uuid, date, time) from public, anon;
revoke execute on function public.create_poll(uuid, text, text[], timestamptz, boolean) from public, anon;
revoke execute on function public.vote_poll(uuid, uuid) from public, anon;
revoke execute on function public.close_poll(uuid) from public, anon;
grant execute on function public.toggle_suggestion_vote(uuid) to authenticated;
grant execute on function public.add_suggestion_to_plan(uuid, date, time) to authenticated;
grant execute on function public.create_poll(uuid, text, text[], timestamptz, boolean) to authenticated;
grant execute on function public.vote_poll(uuid, uuid) to authenticated;
grant execute on function public.close_poll(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.trip_suggestions, public.suggestion_votes, public.trip_polls, public.poll_options, public.poll_votes;
  end if;
end;
$$;
