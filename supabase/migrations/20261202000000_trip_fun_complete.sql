-- Trip Fun, complete: the seven features that were chosen.
--   Digital Travel Scrapbook, My Travel Passport, Adventure Scavenger Hunt,
--   Trip Awards, Trip Soundtrack, Food Explorer, Living Trip Timeline.
--
--  * Feature catalogue: adds the scrapbook and the passport, and turns off
--    the Adventure Wheel and Secret Missions (not among the chosen features).
--    Their data stays; set enabled = true on either row to bring it back.
--  * The scavenger hunt is the trip's challenges (trip_challenges), whose
--    proof is a feed post (a photo, a find or a story). Trip Fun no longer
--    takes checklist items of its own; earlier ones stay in the timeline.
--  * Food finds: dish, restaurant or experience, where, and a photo.
--    Songs: a link (https only; Tripley links out and never hosts music).
--  * trip_memories, the scrapbook: members add a caption, a description, the
--    day it happened and up to 6 photos from the trip's private folder.
--  * passport_stamps: places you've been (a city or destination, its
--    country, the date), optionally tied to a trip you're on. Only you see
--    your stamps.

-- ---------------------------------------------------------------------------
-- Feature catalogue
-- ---------------------------------------------------------------------------
insert into public.trip_feature_catalog (feature_key, title, enabled, minimum_plan) values
  ('travel_scrapbook', 'Digital Travel Scrapbook', true, 'free'),
  ('travel_passport', 'My Travel Passport', true, 'free')
on conflict (feature_key) do nothing;
update public.trip_feature_catalog set enabled = false where feature_key in ('adventure_wheel', 'secret_missions');

-- Raise the right message when a feature is off, or needs Pro, for the person asking.
create or replace function public.require_trip_fun_feature(p_feature text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.trip_feature_catalog f where f.feature_key = p_feature and f.enabled) then
    raise exception 'This Trip Fun feature is turned off.' using errcode = '42501';
  end if;
  if not public.trip_fun_feature_available(p_feature, auth.uid()) then
    raise exception 'This Trip Fun feature is part of Tripley Pro.' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.require_trip_fun_feature(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Food finds and songs
-- ---------------------------------------------------------------------------
alter table public.trip_fun_entries
  add column if not exists food_kind text check (food_kind is null or food_kind in ('dish', 'restaurant', 'experience')),
  add column if not exists place_name text check (place_name is null or char_length(btrim(place_name)) between 1 and 120),
  add column if not exists photo_path text check (photo_path is null or char_length(photo_path) <= 200),
  add column if not exists link_url text check (
    link_url is null or (char_length(link_url) <= 500 and link_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]]*)?$')
  );
alter table public.trip_fun_entries drop constraint if exists trip_fun_entries_fields_match_kind;
alter table public.trip_fun_entries add constraint trip_fun_entries_fields_match_kind check (
  (food_kind is null or kind = 'food')
  and (place_name is null or kind = 'food')
  and (photo_path is null or kind = 'food')
  and (link_url is null or kind = 'soundtrack')
);

create or replace function public.guard_trip_fun_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.trip_members m where m.trip_id = new.trip_id and m.user_id = auth.uid()) then
    raise exception 'You are not a member of this trip.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.trip_id <> old.trip_id or new.kind <> old.kind or new.title <> old.title or new.details <> old.details
       or new.created_by <> old.created_by or new.assigned_to is distinct from old.assigned_to or new.created_at <> old.created_at
       or new.food_kind is distinct from old.food_kind or new.place_name is distinct from old.place_name
       or new.photo_path is distinct from old.photo_path or new.link_url is distinct from old.link_url then
      raise exception 'Trip Fun activity details can''t be edited.' using errcode = '22023';
    end if;
    if old.kind = 'mission' and auth.uid() not in (old.created_by, old.assigned_to) then
      raise exception 'Only the sender and recipient can update this mission.' using errcode = '42501';
    end if;
    if new.is_complete is distinct from old.is_complete then
      if new.is_complete then
        new.completed_by := auth.uid();
        new.completed_at := now();
      else
        new.completed_by := null;
        new.completed_at := null;
      end if;
    elsif new.completed_by is distinct from old.completed_by or new.completed_at is distinct from old.completed_at then
      raise exception 'Who completed it, and when, is set by the database.' using errcode = '22023';
    end if;
    return new;
  end if;

  -- Adding one.
  if new.kind = 'scavenger' then
    raise exception 'Scavenger challenges are in the Adventure Scavenger Hunt.' using errcode = '22023';
  end if;
  perform public.require_trip_fun_feature(case new.kind when 'mission' then 'secret_missions' when 'soundtrack' then 'trip_soundtrack' else 'food_explorer' end);
  if new.created_by <> auth.uid() then
    raise exception 'Invalid activity creator.' using errcode = '42501';
  end if;
  if new.assigned_to is not null and not exists (select 1 from public.trip_members m where m.trip_id = new.trip_id and m.user_id = new.assigned_to) then
    raise exception 'The assigned traveller must be on this trip.' using errcode = '22023';
  end if;
  if (select count(*) from public.trip_fun_entries e where e.trip_id = new.trip_id) >= 1000 then
    raise exception 'That''s plenty for one trip.' using errcode = '54000';
  end if;
  if new.kind = 'food' then
    new.food_kind := coalesce(new.food_kind, 'dish');
    new.place_name := nullif(btrim(new.place_name), '');
    -- A photo must be one you uploaded into this trip's folder.
    if new.photo_path is not null and (
      new.photo_path !~ ('^' || new.trip_id::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$')
      or not exists (select 1 from storage.objects o where o.bucket_id = 'trip-photos' and o.name = new.photo_path and o.owner = auth.uid())
    ) then
      raise exception 'The photo couldn''t be found. Try adding it again.' using errcode = '22023';
    end if;
  end if;
  new.title := btrim(new.title);
  new.details := btrim(new.details);
  -- A new activity starts not done, whatever the app sends.
  new.is_complete := false;
  new.completed_by := null;
  new.completed_at := null;
  return new;
end;
$$;
revoke execute on function public.guard_trip_fun_entry() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The scavenger hunt is the trip's challenges
-- ---------------------------------------------------------------------------
create or replace function public.create_challenge(p_trip uuid, p_title text, p_description text default null, p_emoji text default '🏅')
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
  perform public.require_trip_fun_feature('scavenger_hunt');
  if not public.trip_is_active(p_trip) then
    raise exception 'This trip has ended.' using errcode = '22023';
  end if;
  if (select count(*) from public.trip_challenges where trip_id = p_trip) >= 30 then
    raise exception 'That''s plenty of challenges for one trip.' using errcode = '54000';
  end if;
  insert into public.trip_challenges (trip_id, created_by, title, description, emoji)
  values (p_trip, auth.uid(), btrim(p_title), nullif(btrim(p_description), ''), coalesce(nullif(btrim(p_emoji), ''), '🏅'))
  returning id into v_id;
  perform public.post_event(p_trip, auth.uid(), jsonb_build_object('type', 'challenge_started', 'label', btrim(p_title), 'challenge_id', v_id));
  return v_id;
end;
$$;

create or replace function public.enter_challenge(p_challenge uuid, p_post uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.trip_challenges%rowtype;
  v_p public.trip_posts%rowtype;
begin
  select * into v_c from public.trip_challenges where id = p_challenge;
  select * into v_p from public.trip_posts where id = p_post;
  if v_c.id is null or not public.is_trip_member(v_c.trip_id) then
    raise exception 'Challenge not found.' using errcode = 'P0002';
  end if;
  perform public.require_trip_fun_feature('scavenger_hunt');
  if v_p.id is null or v_p.trip_id <> v_c.trip_id or v_p.author_id is distinct from auth.uid() or v_p.kind = 'event' then
    raise exception 'You can only enter your own posts from this trip.' using errcode = '42501';
  end if;
  insert into public.challenge_entries (challenge_id, post_id, trip_id, user_id) values (p_challenge, p_post, v_c.trip_id, auth.uid())
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- The scrapbook
-- ---------------------------------------------------------------------------
create table if not exists public.trip_memories (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  caption text not null check (char_length(btrim(caption)) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  happened_on date not null,
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trip_memories_trip_day_idx on public.trip_memories (trip_id, happened_on, created_at);

create or replace function public.guard_trip_memory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  if auth.uid() is null or not public.is_trip_member(new.trip_id) then
    raise exception 'You are not in this trip.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    perform public.require_trip_fun_feature('travel_scrapbook');
    new.created_by := auth.uid();
    new.created_at := now();
    if (select count(*) from public.trip_memories m where m.trip_id = new.trip_id) >= 500 then
      raise exception 'A scrapbook can hold up to 500 memories.' using errcode = '54000';
    end if;
  else
    if new.trip_id <> old.trip_id or new.created_by <> old.created_by or new.created_at <> old.created_at then
      raise exception 'Only the caption, description, day and photos of a memory can change.' using errcode = '22023';
    end if;
    if old.created_by <> auth.uid() then
      raise exception 'Only whoever added a memory can change it.' using errcode = '42501';
    end if;
  end if;
  if new.happened_on < date '1900-01-01' or new.happened_on > (now() at time zone 'utc')::date + 1 then
    raise exception 'Pick a day that has already happened.' using errcode = '22023';
  end if;
  if (select count(distinct p) from unnest(new.photo_paths) p) <> cardinality(new.photo_paths) then
    raise exception 'The same photo is in there twice.' using errcode = '22023';
  end if;
  -- Every photo must be in this trip's folder; new ones must be yours.
  foreach v_path in array new.photo_paths loop
    if v_path !~ ('^' || new.trip_id::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$')
       or (
         (tg_op = 'INSERT' or not (v_path = any (old.photo_paths)))
         and not exists (select 1 from storage.objects o where o.bucket_id = 'trip-photos' and o.name = v_path and o.owner = auth.uid())
       ) then
      raise exception 'A photo couldn''t be found. Try adding it again.' using errcode = '22023';
    end if;
  end loop;
  new.caption := btrim(new.caption);
  new.description := nullif(btrim(new.description), '');
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.guard_trip_memory() from public, anon, authenticated;
drop trigger if exists guard_trip_memory on public.trip_memories;
create trigger guard_trip_memory before insert or update on public.trip_memories
  for each row execute function public.guard_trip_memory();

alter table public.trip_memories enable row level security;
drop policy if exists "memories: members can read" on public.trip_memories;
create policy "memories: members can read" on public.trip_memories for select to authenticated using (public.is_trip_member(trip_id));
drop policy if exists "memories: members add their own" on public.trip_memories;
create policy "memories: members add their own" on public.trip_memories for insert to authenticated
  with check (created_by = auth.uid() and public.is_trip_member(trip_id));
drop policy if exists "memories: you edit yours" on public.trip_memories;
create policy "memories: you edit yours" on public.trip_memories for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists "memories: you or the organizer remove" on public.trip_memories;
create policy "memories: you or the organizer remove" on public.trip_memories for delete to authenticated
  using (created_by = auth.uid() or public.is_trip_organizer(trip_id));
revoke all on public.trip_memories from anon;
grant select, insert, update, delete on public.trip_memories to authenticated;

-- ---------------------------------------------------------------------------
-- The passport
-- ---------------------------------------------------------------------------
create table if not exists public.passport_stamps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete set null,
  place text not null check (char_length(btrim(place)) between 1 and 80),
  country text check (country is null or char_length(btrim(country)) between 1 and 80),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  visited_on date not null,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  constraint passport_stamps_point_complete check ((lat is null) = (lng is null))
);
create unique index if not exists passport_stamps_once
  on public.passport_stamps (user_id, lower(btrim(place)), coalesce(lower(btrim(country)), ''), visited_on);
create index if not exists passport_stamps_user_idx on public.passport_stamps (user_id, visited_on desc);

create or replace function public.guard_passport_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.' using errcode = '28000';
  end if;
  if tg_op = 'INSERT' then
    perform public.require_trip_fun_feature('travel_passport');
    new.user_id := auth.uid();
    new.created_at := now();
    if (select count(*) from public.passport_stamps s where s.user_id = auth.uid()) >= 2000 then
      raise exception 'Your passport is full (2,000 stamps).' using errcode = '54000';
    end if;
  elsif new.user_id <> old.user_id or new.created_at <> old.created_at then
    raise exception 'That can''t change.' using errcode = '22023';
  end if;
  if new.trip_id is not null and (tg_op = 'INSERT' or new.trip_id is distinct from old.trip_id) and not public.is_trip_member(new.trip_id) then
    raise exception 'You can only link trips you''re on.' using errcode = '42501';
  end if;
  if new.visited_on < date '1900-01-01' or new.visited_on > (now() at time zone 'utc')::date + 1 then
    raise exception 'Pick a day that has already happened.' using errcode = '22023';
  end if;
  new.place := btrim(new.place);
  new.country := nullif(btrim(new.country), '');
  new.country_code := upper(nullif(btrim(new.country_code), ''));
  new.note := nullif(btrim(new.note), '');
  return new;
end;
$$;
revoke execute on function public.guard_passport_stamp() from public, anon, authenticated;
drop trigger if exists guard_passport_stamp on public.passport_stamps;
create trigger guard_passport_stamp before insert or update on public.passport_stamps
  for each row execute function public.guard_passport_stamp();

alter table public.passport_stamps enable row level security;
drop policy if exists "stamps: only yours" on public.passport_stamps;
create policy "stamps: only yours" on public.passport_stamps for select to authenticated using (user_id = auth.uid());
drop policy if exists "stamps: you add yours" on public.passport_stamps;
create policy "stamps: you add yours" on public.passport_stamps for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "stamps: you edit yours" on public.passport_stamps;
create policy "stamps: you edit yours" on public.passport_stamps for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "stamps: you remove yours" on public.passport_stamps;
create policy "stamps: you remove yours" on public.passport_stamps for delete to authenticated using (user_id = auth.uid());
revoke all on public.passport_stamps from anon;
grant select, insert, update, delete on public.passport_stamps to authenticated;

-- ---------------------------------------------------------------------------
-- Deleting your account deletes your memories and stamps
-- ---------------------------------------------------------------------------
-- (A deleted account keeps an anonymous profile row so shared bills still add
-- up, so these don't go by cascade. Their photos go with your other uploads;
-- food finds, songs and votes go with the sign-in record.)
create or replace function public.handle_profile_deleted_fun()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.trip_memories where created_by = new.id;
    delete from public.passport_stamps where user_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_deleted_fun on public.profiles;
create trigger profiles_deleted_fun after update of deleted_at on public.profiles
  for each row execute function public.handle_profile_deleted_fun();
revoke execute on function public.handle_profile_deleted_fun() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Live updates for the scrapbook
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_memories') then
    execute 'alter publication supabase_realtime add table public.trip_memories';
  end if;
end $$;
