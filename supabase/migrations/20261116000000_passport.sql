-- Travel passport: badges earned from what people actually did in Tripley.
--
--  * user_achievements(p_user): the badges a person has earned and when, all
--    worked out from their real records (trips, places, plans, posts,
--    suggestions). Nothing is stored or awarded by hand, so badges can't be
--    faked. You always see your own; others see them only if you switched
--    profiles.show_achievements on AND they travel with you.
--  * profiles.show_achievements: off by default.
--
-- Forward-only; adds a column and a function. No data changes.

alter table public.profiles add column if not exists show_achievements boolean not null default false;
grant update (show_achievements) on public.profiles to authenticated;

create or replace function public.user_achievements(p_user uuid)
returns table (key text, earned_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user is null or auth.uid() is null then
    return;
  end if;
  if p_user <> auth.uid() and not (
    coalesce((select p.show_achievements from public.profiles p where p.id = p_user), false)
    and public.can_see_profile(p_user)
  ) then
    return;
  end if;

  return query
  with
  -- First Trip: joined (or started) a first trip.
  first_trip as (
    select 'first_trip'::text as key, min(m.joined_at) as at from public.trip_members m where m.user_id = p_user
  ),
  -- Group Planner: organized a trip that 3 or more people joined.
  planner as (
    select 'group_planner'::text, min(x.joined_at) from (
      select m.joined_at, row_number() over (partition by m.trip_id order by m.joined_at) as n
      from public.trip_members m join public.trips t on t.id = m.trip_id
      where t.organizer_id = p_user
    ) x where x.n = 3
  ),
  -- Food Explorer: 5 food places pinned or food ideas suggested.
  food as (
    select 'food_explorer'::text, (array_agg(f.at order by f.at))[5] from (
      select p.created_at as at from public.trip_places p where p.created_by = p_user and p.kind = 'food'
      union all
      select s.created_at from public.trip_suggestions s where s.suggested_by = p_user and s.category = 'food'
    ) f having count(*) >= 5
  ),
  -- Adventure Seeker: 3 hikes, beaches or experiences suggested.
  adventure as (
    select 'adventure_seeker'::text, (array_agg(s.created_at order by s.created_at))[3]
    from public.trip_suggestions s where s.suggested_by = p_user and s.category in ('hike', 'beach', 'experience')
    having count(*) >= 3
  ),
  -- Memory Maker: shared 10 photos in trip feeds.
  memories as (
    select 'memory_maker'::text, (array_agg(p.created_at order by p.created_at))[10]
    from public.post_photos ph join public.trip_posts p on p.id = ph.post_id where p.author_id = p_user
    having count(*) >= 10
  ),
  -- Itinerary Pro: added 10 plans to itineraries.
  itinerary as (
    select 'itinerary_pro'::text, (array_agg(i.created_at order by i.created_at))[10]
    from public.itinerary_items i where i.created_by = p_user
    having count(*) >= 10
  ),
  -- Globetrotter: been on 3 trips that are over.
  globetrotter as (
    select 'globetrotter'::text, (array_agg(e.at order by e.at))[3] from (
      select coalesce(t.ended_at, (t.ends_on + 1)::timestamptz) as at
      from public.trip_members m join public.trips t on t.id = m.trip_id
      where m.user_id = p_user and (t.ended_at is not null or t.ends_on < (now() at time zone 'utc')::date - 1)
    ) e having count(*) >= 3
  ),
  -- Team Spirit: 20 reactions or comments on other people's posts.
  team as (
    select 'team_spirit'::text, (array_agg(c.at order by c.at))[20] from (
      select r.created_at as at from public.post_reactions r join public.trip_posts p on p.id = r.post_id
        where r.user_id = p_user and p.author_id is distinct from p_user
      union all
      select c.created_at from public.post_comments c join public.trip_posts p on p.id = c.post_id
        where c.user_id = p_user and p.author_id is distinct from p_user
    ) c having count(*) >= 20
  ),
  -- Decision Maker: started 3 polls that got votes.
  decider as (
    select 'decision_maker'::text, (array_agg(p.created_at order by p.created_at))[3]
    from public.trip_polls p where p.created_by = p_user and exists (select 1 from public.poll_votes v where v.poll_id = p.id)
    having count(*) >= 3
  )
  select a.key, a.at from (
    select * from first_trip union all select * from planner union all select * from food
    union all select * from adventure union all select * from memories union all select * from itinerary
    union all select * from globetrotter union all select * from team union all select * from decider
  ) a(key, at)
  where a.at is not null;
end;
$$;
revoke execute on function public.user_achievements(uuid) from public, anon;
grant execute on function public.user_achievements(uuid) to authenticated;
