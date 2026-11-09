-- Getting ready: packing lists, group tasks and light-hearted challenges.
--
--  * trip_tasks: kind 'packing' is a personal packing list (only its owner
--    sees it); kind 'group' is a shared to-do ("book the ferry") that any
--    member can add, assign to a member and tick off.
--  * trip_challenges: optional group challenges ("Find the best local
--    food"); challenge_entries link a member's own feed post to a challenge.
--    Nothing here needs locations or personal details.
--  * my_trip_overview() also counts your packing and the group's tasks, for
--    planning progress.
--
-- Members only; ended trips are read-only. Forward-only; no data changes.

create table public.trip_tasks (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  kind text not null check (kind in ('packing', 'group')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  -- Packing: whose list it is. Group: who added it.
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  assignee_id uuid references public.profiles (id) on delete set null,
  done boolean not null default false,
  done_by uuid references public.profiles (id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  constraint trip_tasks_packing_unassigned check (kind = 'group' or assignee_id is null)
);
create index trip_tasks_trip_idx on public.trip_tasks (trip_id, kind, created_at);

create or replace function public.guard_trip_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    if (select count(*) from public.trip_tasks where created_by = new.created_by and created_at > now() - interval '10 minutes') >= 100 then
      raise exception 'That''s a lot of items at once. Try again in a few minutes.' using errcode = '54000';
    end if;
  elsif new.trip_id <> old.trip_id or new.kind <> old.kind or new.created_by <> old.created_by then
    raise exception 'A task can''t move.' using errcode = '42501';
  end if;
  new.title := btrim(new.title);
  if new.assignee_id is not null and not public.is_member_of(new.trip_id, new.assignee_id) then
    raise exception 'They need to be in the trip.' using errcode = '22023';
  end if;
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_by := auth.uid();
    new.done_at := now();
  elsif not new.done then
    new.done_by := null;
    new.done_at := null;
  end if;
  return new;
end;
$$;
create trigger trip_tasks_guard before insert or update on public.trip_tasks
  for each row execute function public.guard_trip_task();

create table public.trip_challenges (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid not null default auth.uid() references public.profiles (id),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  emoji text not null default '🏅' check (char_length(emoji) <= 8),
  created_at timestamptz not null default now()
);
create index trip_challenges_trip_idx on public.trip_challenges (trip_id, created_at desc);

create table public.challenge_entries (
  challenge_id uuid not null references public.trip_challenges (id) on delete cascade,
  post_id uuid not null references public.trip_posts (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (challenge_id, post_id)
);
create index challenge_entries_trip_idx on public.challenge_entries (trip_id);

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

-- Enter one of your own posts in a challenge of the same trip.
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
  if v_p.id is null or v_p.trip_id <> v_c.trip_id or v_p.author_id is distinct from auth.uid() or v_p.kind = 'event' then
    raise exception 'You can only enter your own posts from this trip.' using errcode = '42501';
  end if;
  insert into public.challenge_entries (challenge_id, post_id, trip_id, user_id) values (p_challenge, p_post, v_c.trip_id, auth.uid())
  on conflict do nothing;
end;
$$;

-- Planning progress gets packing and group tasks.
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
    'spent_base_minor', coalesce((select sum(b.total_base_minor) from public.bills b where b.trip_id = t.id), 0),
    'packing_total', (select count(*) from public.trip_tasks k where k.trip_id = t.id and k.kind = 'packing' and k.created_by = auth.uid()),
    'packing_done', (select count(*) from public.trip_tasks k where k.trip_id = t.id and k.kind = 'packing' and k.created_by = auth.uid() and k.done),
    'tasks_total', (select count(*) from public.trip_tasks k where k.trip_id = t.id and k.kind = 'group'),
    'tasks_done', (select count(*) from public.trip_tasks k where k.trip_id = t.id and k.kind = 'group' and k.done)
  )
  from public.trips t
  where public.is_trip_member(t.id)
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.trip_tasks enable row level security;
alter table public.trip_challenges enable row level security;
alter table public.challenge_entries enable row level security;

-- Your packing list is yours alone; group tasks are for everyone in the trip.
create policy "tasks: members see group tasks and their own packing" on public.trip_tasks for select to authenticated
  using (public.is_trip_member(trip_id) and (kind = 'group' or created_by = auth.uid()));
create policy "tasks: members add while the trip is on" on public.trip_tasks for insert to authenticated
  with check (public.is_trip_member(trip_id) and public.trip_is_active(trip_id));
create policy "tasks: tick off group tasks or your own packing" on public.trip_tasks for update to authenticated
  using (public.is_trip_member(trip_id) and (kind = 'group' or created_by = auth.uid()))
  with check (public.trip_is_active(trip_id));
create policy "tasks: remove your own, or any as organizer" on public.trip_tasks for delete to authenticated
  using (public.is_trip_member(trip_id) and (created_by = auth.uid() or (kind = 'group' and public.is_trip_organizer(trip_id))));

create policy "challenges: members can read" on public.trip_challenges for select to authenticated using (public.is_trip_member(trip_id));
create policy "challenges: whoever started it or the organizer removes" on public.trip_challenges for delete to authenticated
  using (public.is_trip_member(trip_id) and (created_by = auth.uid() or public.is_trip_organizer(trip_id)));
create policy "challenge entries: members can read" on public.challenge_entries for select to authenticated using (public.is_trip_member(trip_id));
create policy "challenge entries: withdraw your own" on public.challenge_entries for delete to authenticated using (user_id = auth.uid());

revoke all on public.trip_tasks, public.trip_challenges, public.challenge_entries from anon;
revoke insert, update on public.trip_tasks from authenticated;
grant insert (trip_id, kind, title, assignee_id, done) on public.trip_tasks to authenticated;
grant update (title, assignee_id, done) on public.trip_tasks to authenticated;
revoke insert, update on public.trip_challenges, public.challenge_entries from authenticated;

revoke execute on function public.guard_trip_task() from public, anon, authenticated;
revoke execute on function public.create_challenge(uuid, text, text, text) from public, anon;
revoke execute on function public.enter_challenge(uuid, uuid) from public, anon;
grant execute on function public.create_challenge(uuid, text, text, text) to authenticated;
grant execute on function public.enter_challenge(uuid, uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.trip_tasks, public.trip_challenges, public.challenge_entries;
  end if;
end;
$$;
