-- Settle-up reminders. Balances are worked out here the same way the app does
-- (src/lib/balances.ts netPerMember): each bill share moves money from the
-- person who had it to whoever paid; payments (not disputed ones) move it back.
--
--  * Every day, people who still owe money on a trip that ended in the last
--    month get a reminder: from 2 days after the end, at most once a week and
--    three times per trip.
--  * Anyone who is owed money (or the organizer) can nudge everyone who owes,
--    at most once a day per trip.

create or replace function public.trip_net_balances(p_trip uuid)
returns table (user_id uuid, net_minor bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with moves as (
    select b.paid_by as user_id, s.amount_base_minor as amount
    from public.bill_shares s join public.bills b on b.id = s.bill_id
    where b.trip_id = p_trip and s.user_id <> b.paid_by
    union all
    select s.user_id, -s.amount_base_minor
    from public.bill_shares s join public.bills b on b.id = s.bill_id
    where b.trip_id = p_trip and s.user_id <> b.paid_by
    union all
    select st.from_user, st.amount_base_minor from public.settlements st
    where st.trip_id = p_trip and st.status <> 'disputed'
    union all
    select st.to_user, -st.amount_base_minor from public.settlements st
    where st.trip_id = p_trip and st.status <> 'disputed'
  )
  select m.user_id, sum(m.amount)::bigint
  from moves m
  group by m.user_id
$$;

-- The daily run (pg_cron). Returns how many reminders went out.
create or replace function public.send_settle_up_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip record;
  v_debtor record;
  v_count int := 0;
  v_today date := (now() at time zone 'utc')::date;
begin
  for v_trip in
    select t.id, t.name from public.trips t
    where t.ends_on is not null and t.ends_on between v_today - 30 and v_today - 2
  loop
    for v_debtor in
      select n.user_id from public.trip_net_balances(v_trip.id) n
      where n.net_minor < 0
        and public.is_member_of(v_trip.id, n.user_id)
        and not exists (
          select 1 from public.notifications x
          where x.user_id = n.user_id and x.trip_id = v_trip.id and x.kind = 'settlement_reminder'
            and x.created_at > now() - interval '7 days'
        )
        and (
          select count(*) from public.notifications x
          where x.user_id = n.user_id and x.trip_id = v_trip.id and x.kind = 'settlement_reminder'
        ) < 3
    loop
      perform public.notify(v_debtor.user_id, v_trip.id, 'settlement_reminder', v_trip.name,
        'You still owe money from this trip. Settle up in a tap: it shows who to pay and how.',
        jsonb_build_object('trip_id', v_trip.id));
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- Someone who is owed money (or the organizer) nudges everyone who owes.
create or replace function public.remind_to_settle(p_trip uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips%rowtype;
  v_me bigint;
  v_debtor record;
  v_count int := 0;
  v_who text;
begin
  select * into v_trip from public.trips where id = p_trip for update;
  if not found or not public.is_trip_member(p_trip) then
    raise exception 'Trip not found.' using errcode = 'P0002';
  end if;
  select n.net_minor into v_me from public.trip_net_balances(p_trip) n where n.user_id = auth.uid();
  if coalesce(v_me, 0) <= 0 and not public.is_trip_organizer(p_trip) then
    raise exception 'Only someone who is owed money can send reminders.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.notifications x
    where x.trip_id = p_trip and x.kind = 'settlement_reminder' and x.data ->> 'by' is not null
      and x.created_at > now() - interval '24 hours'
  ) then
    raise exception 'Someone reminded everyone today. Try again tomorrow.' using errcode = '54000';
  end if;
  v_who := public.display_name_of(auth.uid());
  for v_debtor in
    select n.user_id from public.trip_net_balances(p_trip) n
    where n.net_minor < 0 and n.user_id <> auth.uid() and public.is_member_of(p_trip, n.user_id)
  loop
    perform public.notify(v_debtor.user_id, p_trip, 'settlement_reminder', v_trip.name,
      v_who || ' is reminding everyone to settle up. Open the trip to see who to pay.',
      jsonb_build_object('trip_id', p_trip, 'by', auth.uid()));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.trip_net_balances(uuid) from public, anon, authenticated;
revoke execute on function public.send_settle_up_reminders() from public, anon, authenticated;
revoke execute on function public.remind_to_settle(uuid) from public, anon;
grant execute on function public.remind_to_settle(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'tripley-settle-up-reminders') then
      perform cron.unschedule('tripley-settle-up-reminders');
    end if;
    perform cron.schedule('tripley-settle-up-reminders', '41 9 * * *', 'select public.send_settle_up_reminders()');
  end if;
end;
$$;
