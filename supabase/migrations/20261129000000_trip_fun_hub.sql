-- Trip Fun hub: shared lightweight activities with database-enforced visibility and plan gates.
create table if not exists public.trip_feature_catalog (
  feature_key text primary key,
  title text not null,
  enabled boolean not null default true,
  minimum_plan text not null default 'free' check (minimum_plan in ('free','pro'))
);
insert into public.trip_feature_catalog(feature_key,title,enabled,minimum_plan) values
 ('adventure_wheel','Adventure Wheel',true,'free'),
 ('secret_missions','Secret Missions',true,'free'),
 ('scavenger_hunt','Adventure Scavenger Hunt',true,'free'),
 ('trip_awards','Trip Awards',true,'free'),
 ('trip_soundtrack','Trip Soundtrack',true,'free'),
 ('food_explorer','Food Explorer',true,'free'),
 ('living_timeline','Living Trip Timeline',true,'free')
on conflict (feature_key) do nothing;

create or replace function public.trip_fun_feature_available(p_feature text, p_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.trip_feature_catalog f
    where f.feature_key=p_feature and f.enabled
      and (f.minimum_plan='free' or exists (
        select 1 from public.accounts a where a.user_id=p_user
          and (a.plan='pro' or (a.bonus_pro_until is not null and a.bonus_pro_until > now()))
      ))
  );
$$;
revoke all on function public.trip_fun_feature_available(text,uuid) from public, anon, authenticated;

create table if not exists public.trip_fun_entries (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  kind text not null check (kind in ('mission','scavenger','soundtrack','food')),
  title text not null check (length(trim(title)) between 1 and 120),
  details text not null default '' check (length(details) <= 1000),
  created_by uuid not null references auth.users(id) on delete cascade,
  assigned_to uuid references auth.users(id) on delete set null,
  is_complete boolean not null default false,
  completed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint trip_fun_assignee_required check (kind <> 'mission' or assigned_to is not null)
);
create index if not exists trip_fun_entries_trip_kind_created on public.trip_fun_entries(trip_id,kind,created_at desc);

create table if not exists public.trip_fun_votes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  award_key text not null check (award_key in ('food_scout','photo_pro','human_gps','adventure_seeker','best_planner','comic_relief','early_bird','last_ready')),
  voter_id uuid not null references auth.users(id) on delete cascade,
  nominee_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(trip_id,award_key,voter_id),
  check (voter_id <> nominee_id)
);
create index if not exists trip_fun_votes_trip_award on public.trip_fun_votes(trip_id,award_key);

alter table public.trip_feature_catalog enable row level security;
alter table public.trip_fun_entries enable row level security;
alter table public.trip_fun_votes enable row level security;

drop policy if exists trip_fun_catalog_read on public.trip_feature_catalog;
create policy trip_fun_catalog_read on public.trip_feature_catalog for select to authenticated using (true);

drop policy if exists trip_fun_entries_read on public.trip_fun_entries;
create policy trip_fun_entries_read on public.trip_fun_entries for select to authenticated using (
  exists (select 1 from public.trip_members m where m.trip_id=trip_fun_entries.trip_id and m.user_id=auth.uid())
  and (kind <> 'mission' or created_by=auth.uid() or assigned_to=auth.uid())
);
drop policy if exists trip_fun_entries_insert on public.trip_fun_entries;
create policy trip_fun_entries_insert on public.trip_fun_entries for insert to authenticated with check (
  created_by=auth.uid()
  and exists (select 1 from public.trip_members m where m.trip_id=trip_fun_entries.trip_id and m.user_id=auth.uid())
  and (assigned_to is null or exists (select 1 from public.trip_members m where m.trip_id=trip_fun_entries.trip_id and m.user_id=trip_fun_entries.assigned_to))
  and public.trip_fun_feature_available(case kind when 'mission' then 'secret_missions' when 'scavenger' then 'scavenger_hunt' when 'soundtrack' then 'trip_soundtrack' else 'food_explorer' end,auth.uid())
);
drop policy if exists trip_fun_entries_update on public.trip_fun_entries;
create policy trip_fun_entries_update on public.trip_fun_entries for update to authenticated using (
  exists (select 1 from public.trip_members m where m.trip_id=trip_fun_entries.trip_id and m.user_id=auth.uid())
  and (kind <> 'mission' or created_by=auth.uid() or assigned_to=auth.uid())
) with check (
  exists (select 1 from public.trip_members m where m.trip_id=trip_fun_entries.trip_id and m.user_id=auth.uid())
  and (kind <> 'mission' or created_by=auth.uid() or assigned_to=auth.uid())
);
drop policy if exists trip_fun_entries_delete on public.trip_fun_entries;
create policy trip_fun_entries_delete on public.trip_fun_entries for delete to authenticated using (created_by=auth.uid());

drop policy if exists trip_fun_votes_read on public.trip_fun_votes;
create policy trip_fun_votes_read on public.trip_fun_votes for select to authenticated using (
  exists (select 1 from public.trip_members m where m.trip_id=trip_fun_votes.trip_id and m.user_id=auth.uid())
);
drop policy if exists trip_fun_votes_insert on public.trip_fun_votes;
create policy trip_fun_votes_insert on public.trip_fun_votes for insert to authenticated with check (
  voter_id=auth.uid() and voter_id<>nominee_id
  and exists (select 1 from public.trip_members m where m.trip_id=trip_fun_votes.trip_id and m.user_id=auth.uid())
  and exists (select 1 from public.trip_members m where m.trip_id=trip_fun_votes.trip_id and m.user_id=trip_fun_votes.nominee_id)
  and public.trip_fun_feature_available('trip_awards',auth.uid())
);
drop policy if exists trip_fun_votes_update on public.trip_fun_votes;
create policy trip_fun_votes_update on public.trip_fun_votes for update to authenticated using (voter_id=auth.uid()) with check (voter_id=auth.uid() and voter_id<>nominee_id);
drop policy if exists trip_fun_votes_delete on public.trip_fun_votes;
create policy trip_fun_votes_delete on public.trip_fun_votes for delete to authenticated using (voter_id=auth.uid());

grant select on public.trip_feature_catalog to authenticated;
grant select,insert,update,delete on public.trip_fun_entries to authenticated;
grant select,insert,update,delete on public.trip_fun_votes to authenticated;
