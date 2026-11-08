-- Remind people whose location has gone stale on an active trip, e.g. after
-- force-quitting the app on iPhone. Runs every 15 minutes via pg_cron. The
-- notification row it inserts is delivered as a push by the send-push function
-- (Database Webhook on public.notifications INSERT).
--
-- Thresholds are generous because a phone sitting still legitimately sends no
-- updates: 60 minutes in Live mode, 4 hours in Battery saver, and at most one
-- reminder every 6 hours per trip.

create or replace function public.nudge_stale_sharers(
  p_live_minutes int default 60,
  p_saver_minutes int default 240,
  p_every_hours int default 6
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with stale as (
    select m.trip_id, m.user_id, t.name as trip_name, l.updated_at
    from public.trip_members m
    join public.trips t on t.id = m.trip_id
    join public.member_locations l on l.trip_id = m.trip_id and l.user_id = m.user_id
    where m.location_sharing
      and public.trip_is_active(m.trip_id)
      and l.updated_at < now() - make_interval(
            mins => case m.sharing_mode when 'saver' then p_saver_minutes else p_live_minutes end)
      and (m.last_nudged_at is null or m.last_nudged_at < now() - make_interval(hours => p_every_hours))
  ),
  marked as (
    update public.trip_members m
      set last_nudged_at = now()
      from stale s
      where m.trip_id = s.trip_id and m.user_id = s.user_id
      returning m.trip_id, m.user_id
  )
  insert into public.notifications (user_id, trip_id, kind, title, body, data)
  select s.user_id, s.trip_id, 'location_stale', s.trip_name,
         'Your friends last saw you '
           || case
                when now() - s.updated_at < interval '2 hours'
                  then (extract(epoch from now() - s.updated_at) / 60)::int || ' min ago'
                else (extract(epoch from now() - s.updated_at) / 3600)::int || ' h ago'
              end
           || '. Open Tripley to keep sharing your location.',
         jsonb_build_object('trip_id', s.trip_id)
  from stale s
  join marked k on k.trip_id = s.trip_id and k.user_id = s.user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.nudge_stale_sharers(int, int, int) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('tripley-stale-location-nudge', '*/15 * * * *', 'select public.nudge_stale_sharers()');
  end if;
end;
$$;
