-- Trip activity feed.
--
--  * trip_posts: updates, photo posts, places someone found, organizer
--    announcements, and automatic "event" posts (someone joined, pinned a
--    place, added a plan or a bill). Created only through create_post(),
--    which checks membership, validates every field and photo, and limits
--    how fast one person can post.
--  * post_photos: up to 6 photos per post. Each must be a file the poster
--    uploaded into this trip's private folder (trip-photos bucket), so a post
--    can't point at another trip's photos. Shown through short-lived links.
--  * post_reactions: one of six emoji per person per post (toggle).
--  * post_comments: comments from trip members.
--  * profiles.notification_prefs: which feed notifications each person wants.
--
-- Only current trip members can read any of it. Forward-only; adds tables,
-- functions, triggers and a column. No existing data changes.

alter table public.profiles add column if not exists notification_prefs jsonb not null default '{}'::jsonb
  check (jsonb_typeof(notification_prefs) = 'object');
grant update (notification_prefs) on public.profiles to authenticated;

-- Does this person want this kind of notification? (Unset keys use the default.)
create or replace function public.wants_notification(p_user uuid, p_key text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (p.notification_prefs ->> p_key)::boolean from public.profiles p where p.id = p_user), p_default)
$$;

create table public.trip_posts (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('update', 'photos', 'place', 'announcement', 'event')),
  body text check (body is null or char_length(body) between 1 and 2000),
  place_name text check (place_name is null or char_length(place_name) between 1 and 120),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  -- For automatic posts: what happened ({"type": "place_pinned", "label": "...", ...}).
  event jsonb check (event is null or jsonb_typeof(event) = 'object'),
  created_at timestamptz not null default now(),
  constraint trip_posts_point_complete check ((lat is null) = (lng is null)),
  constraint trip_posts_event_only_for_events check ((kind = 'event') = (event is not null))
);
create index trip_posts_trip_idx on public.trip_posts (trip_id, created_at desc);
create index trip_posts_author_idx on public.trip_posts (author_id, created_at desc);

create table public.post_photos (
  post_id uuid not null references public.trip_posts (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  path text not null,
  position int not null default 0,
  primary key (post_id, path),
  constraint post_photos_in_trip_folder check (path ~ ('^' || trip_id::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$'))
);
create index post_photos_trip_idx on public.post_photos (trip_id);

create table public.post_reactions (
  post_id uuid not null references public.trip_posts (id) on delete cascade,
  trip_id uuid not null,
  user_id uuid not null,
  emoji text not null check (emoji in ('❤️', '😂', '😮', '👏', '🔥', '👍')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji),
  -- Leaving the trip removes your reactions.
  foreign key (trip_id, user_id) references public.trip_members (trip_id, user_id) on delete cascade
);
create index post_reactions_trip_idx on public.post_reactions (trip_id);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.trip_posts (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index post_comments_post_idx on public.post_comments (post_id, created_at);
create index post_comments_trip_idx on public.post_comments (trip_id);

-- ---------------------------------------------------------------------------
-- Posting
-- ---------------------------------------------------------------------------
create or replace function public.create_post(
  p_trip uuid,
  p_kind text,
  p_body text default null,
  p_photos text[] default '{}',
  p_place_name text default null,
  p_lat double precision default null,
  p_lng double precision default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_body text := nullif(btrim(p_body), '');
  v_photos text[] := coalesce(p_photos, '{}');
  v_path text;
  v_i int := 0;
  v_trip_name text;
  v_who text;
  v_member record;
begin
  if v_uid is null then
    raise exception 'Please sign in first.' using errcode = '28000';
  end if;
  if not public.is_trip_member(p_trip) then
    raise exception 'You are not in this trip.' using errcode = '42501';
  end if;
  if not public.trip_is_active(p_trip) then
    raise exception 'This trip has ended.' using errcode = '22023';
  end if;
  if p_kind not in ('update', 'photos', 'place', 'announcement') then
    raise exception 'Choose what kind of post this is.' using errcode = '22023';
  end if;
  if p_kind = 'announcement' and not public.is_trip_organizer(p_trip) then
    raise exception 'Only the organizer can post announcements.' using errcode = '42501';
  end if;
  if (p_kind in ('update', 'announcement') and v_body is null)
     or (p_kind = 'photos' and cardinality(v_photos) = 0)
     or (p_kind = 'place' and nullif(btrim(p_place_name), '') is null) then
    raise exception 'There''s nothing to post yet.' using errcode = '22023';
  end if;
  if cardinality(v_photos) > 6 then
    raise exception 'Up to 6 photos per post.' using errcode = '22023';
  end if;
  if (select count(*) from public.trip_posts where author_id = v_uid and kind <> 'event' and created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'You''re posting very fast. Try again in a few minutes.' using errcode = '54000';
  end if;
  -- Every photo must be one you uploaded into this trip's folder.
  foreach v_path in array v_photos loop
    if v_path !~ ('^' || p_trip::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'trip-photos' and o.name = v_path and o.owner = v_uid) then
      raise exception 'A photo couldn''t be found. Try adding it again.' using errcode = '22023';
    end if;
  end loop;

  insert into public.trip_posts (trip_id, author_id, kind, body, place_name, lat, lng)
  values (p_trip, v_uid, p_kind, v_body, nullif(btrim(p_place_name), ''), p_lat, p_lng)
  returning id into v_id;
  foreach v_path in array v_photos loop
    insert into public.post_photos (post_id, trip_id, path, position) values (v_id, p_trip, v_path, v_i)
    on conflict do nothing;
    v_i := v_i + 1;
  end loop;

  -- Tell the others (each person chooses which posts they hear about).
  select name into v_trip_name from public.trips where id = p_trip;
  v_who := public.display_name_of(v_uid);
  for v_member in select m.user_id from public.trip_members m where m.trip_id = p_trip and m.user_id <> v_uid loop
    if public.wants_notification(v_member.user_id, case when p_kind = 'announcement' then 'announcements' else 'posts' end, true) then
      perform public.notify(
        v_member.user_id, p_trip, 'post_' || p_kind, v_trip_name,
        case p_kind
          when 'announcement' then '📣 ' || v_who || ': ' || left(v_body, 100)
          when 'photos' then v_who || ' shared ' || cardinality(v_photos) || case when cardinality(v_photos) = 1 then ' photo' else ' photos' end
          when 'place' then v_who || ' found a place: ' || btrim(p_place_name)
          else v_who || ' posted: ' || left(v_body, 80)
        end,
        jsonb_build_object('trip_id', p_trip, 'post_id', v_id)
      );
    end if;
  end loop;
  return v_id;
end;
$$;

-- React (or un-react) with an emoji.
create or replace function public.toggle_reaction(p_post uuid, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.trip_posts%rowtype;
  v_added boolean;
begin
  select * into v_post from public.trip_posts where id = p_post;
  if not found or not public.is_trip_member(v_post.trip_id) then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
  if p_emoji not in ('❤️', '😂', '😮', '👏', '🔥', '👍') then
    raise exception 'Pick one of the reactions.' using errcode = '22023';
  end if;
  delete from public.post_reactions where post_id = p_post and user_id = auth.uid() and emoji = p_emoji;
  if found then
    return false;
  end if;
  insert into public.post_reactions (post_id, trip_id, user_id, emoji) values (p_post, v_post.trip_id, auth.uid(), p_emoji);
  v_added := true;
  if v_post.author_id is not null and v_post.author_id <> auth.uid() and v_post.kind <> 'event'
     and public.wants_notification(v_post.author_id, 'reactions', false) then
    perform public.notify(
      v_post.author_id, v_post.trip_id, 'post_reaction', (select name from public.trips where id = v_post.trip_id),
      public.display_name_of(auth.uid()) || ' reacted ' || p_emoji || ' to your post',
      jsonb_build_object('trip_id', v_post.trip_id, 'post_id', p_post)
    );
  end if;
  return v_added;
end;
$$;

-- Comments: same trip as the post, a gentle rate limit, and the author is told.
create or replace function public.handle_post_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.trip_posts%rowtype;
begin
  select * into v_post from public.trip_posts where id = new.post_id;
  if not found or v_post.trip_id is distinct from new.trip_id then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.post_comments where user_id = new.user_id and created_at > now() - interval '1 minute') >= 15 then
    raise exception 'You''re commenting very fast. Try again in a minute.' using errcode = '54000';
  end if;
  new.body := btrim(new.body);
  if v_post.author_id is not null and v_post.author_id <> new.user_id and public.is_member_of(v_post.trip_id, v_post.author_id)
     and public.wants_notification(v_post.author_id, 'comments', true) then
    perform public.notify(
      v_post.author_id, v_post.trip_id, 'post_comment', (select name from public.trips where id = v_post.trip_id),
      public.display_name_of(new.user_id) || ' commented: ' || left(new.body, 100),
      jsonb_build_object('trip_id', v_post.trip_id, 'post_id', v_post.id)
    );
  end if;
  return new;
end;
$$;
create trigger post_comments_check before insert on public.post_comments
  for each row execute function public.handle_post_comment();

-- ---------------------------------------------------------------------------
-- Automatic posts: what the group did, so the feed tells the trip's story
-- ---------------------------------------------------------------------------
create or replace function public.post_event(p_trip uuid, p_actor uuid, p_event jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.trip_posts (trip_id, author_id, kind, event) values (p_trip, p_actor, 'event', p_event)
$$;

create or replace function public.handle_feed_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'trip_members' then
    perform public.post_event(new.trip_id, new.user_id, jsonb_build_object(
      'type', case when new.role::text = 'organizer' then 'trip_started' else 'member_joined' end));
  elsif tg_table_name = 'trip_places' then
    if new.kind <> 'memory' then
      perform public.post_event(new.trip_id, new.created_by, jsonb_build_object(
        'type', 'place_pinned', 'label', new.name, 'place_kind', new.kind, 'place_id', new.id));
    end if;
  elsif tg_table_name = 'itinerary_items' then
    perform public.post_event(new.trip_id, new.created_by, jsonb_build_object(
      'type', 'stop_added', 'label', new.title, 'day', new.day, 'item_id', new.id));
  elsif tg_table_name = 'bills' then
    perform public.post_event(new.trip_id, new.created_by, jsonb_build_object(
      'type', 'bill_added', 'label', new.title, 'bill_id', new.id));
  end if;
  return new;
end;
$$;
create trigger feed_member_joined after insert on public.trip_members
  for each row execute function public.handle_feed_event();
create trigger feed_place_pinned after insert on public.trip_places
  for each row execute function public.handle_feed_event();
create trigger feed_stop_added after insert on public.itinerary_items
  for each row execute function public.handle_feed_event();
create trigger feed_bill_added after insert on public.bills
  for each row execute function public.handle_feed_event();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.trip_posts enable row level security;
alter table public.post_photos enable row level security;
alter table public.post_reactions enable row level security;
alter table public.post_comments enable row level security;

create policy "posts: members can read" on public.trip_posts for select to authenticated using (public.is_trip_member(trip_id));
create policy "posts: author or organizer removes" on public.trip_posts for delete to authenticated
  using (public.is_trip_member(trip_id) and ((author_id = auth.uid() and kind <> 'event') or public.is_trip_organizer(trip_id)));
create policy "post photos: members can read" on public.post_photos for select to authenticated using (public.is_trip_member(trip_id));
create policy "reactions: members can read" on public.post_reactions for select to authenticated using (public.is_trip_member(trip_id));
create policy "post comments: members can read" on public.post_comments for select to authenticated using (public.is_trip_member(trip_id));
create policy "post comments: members comment as themselves" on public.post_comments for insert to authenticated
  with check (user_id = auth.uid() and public.is_trip_member(trip_id) and public.trip_is_active(trip_id));
create policy "post comments: author or organizer removes" on public.post_comments for delete to authenticated
  using (user_id = auth.uid() or public.is_trip_organizer(trip_id));

revoke all on public.trip_posts, public.post_photos, public.post_reactions, public.post_comments from anon;
revoke insert, update on public.trip_posts from authenticated;
revoke insert, update, delete on public.post_photos, public.post_reactions from authenticated;
revoke insert, update on public.post_comments from authenticated;
grant insert (post_id, trip_id, body) on public.post_comments to authenticated;

revoke execute on function public.wants_notification(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.post_event(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.handle_feed_event() from public, anon, authenticated;
revoke execute on function public.handle_post_comment() from public, anon, authenticated;
revoke execute on function public.create_post(uuid, text, text, text[], text, double precision, double precision) from public, anon;
revoke execute on function public.toggle_reaction(uuid, text) from public, anon;
grant execute on function public.create_post(uuid, text, text, text[], text, double precision, double precision) to authenticated;
grant execute on function public.toggle_reaction(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.trip_posts, public.post_reactions, public.post_comments;
  end if;
end;
$$;
