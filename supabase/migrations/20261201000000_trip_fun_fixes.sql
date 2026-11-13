-- Trip Fun fixes. Production applied 20261129000000_trip_fun_hub.sql as it was
-- first committed; later edits to that file never ran there (applied
-- migrations aren't re-run), so they're here instead, plus what was missing:
--
--  * trip_fun_feature_available: only answers for the person asking, and
--    signed-in users can call it (the row-level policies call it as them;
--    without this, adding an activity or an award vote fails with
--    "permission denied for function").
--  * Guard triggers: activity details can't be edited after they're added,
--    only the sender and recipient touch a mission, completion (who and
--    when) is set by the database, and award votes can only change their
--    nominee. Trigger functions can't be called directly by anyone.

create or replace function public.trip_fun_feature_available(p_feature text, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_feature_catalog f
    where p_user = auth.uid() and f.feature_key = p_feature and f.enabled
      and (f.minimum_plan = 'free' or exists (
        select 1 from public.accounts a where a.user_id = p_user
          and ((a.plan = 'pro' and (a.plan_expires_at is null or a.plan_expires_at > now()))
            or (a.bonus_pro_until is not null and a.bonus_pro_until > now()))
      ))
  );
$$;
revoke execute on function public.trip_fun_feature_available(text, uuid) from public, anon;
grant execute on function public.trip_fun_feature_available(text, uuid) to authenticated;

create or replace function public.guard_trip_fun_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_feature text;
begin
  v_feature := case new.kind when 'mission' then 'secret_missions' when 'scavenger' then 'scavenger_hunt' when 'soundtrack' then 'trip_soundtrack' else 'food_explorer' end;
  if not exists (select 1 from public.trip_members m where m.trip_id = new.trip_id and m.user_id = auth.uid()) then
    raise exception 'You are not a member of this trip.' using errcode = '42501';
  end if;
  if not public.trip_fun_feature_available(v_feature, auth.uid()) then
    raise exception 'This Trip Fun feature is not available on your plan.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.trip_id <> old.trip_id or new.kind <> old.kind or new.title <> old.title or new.details <> old.details
       or new.created_by <> old.created_by or new.assigned_to is distinct from old.assigned_to or new.created_at <> old.created_at then
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
  else
    if new.created_by <> auth.uid() then
      raise exception 'Invalid activity creator.' using errcode = '42501';
    end if;
    if new.assigned_to is not null and not exists (select 1 from public.trip_members m where m.trip_id = new.trip_id and m.user_id = new.assigned_to) then
      raise exception 'The assigned traveller must be on this trip.' using errcode = '22023';
    end if;
    -- A new activity starts not done, whatever the app sends.
    new.is_complete := false;
    new.completed_by := null;
    new.completed_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_trip_fun_entry on public.trip_fun_entries;
create trigger guard_trip_fun_entry before insert or update on public.trip_fun_entries
  for each row execute function public.guard_trip_fun_entry();

create or replace function public.guard_trip_fun_vote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.trip_id <> old.trip_id or new.award_key <> old.award_key or new.voter_id <> old.voter_id) then
    raise exception 'A vote can only change its nominee.' using errcode = '22023';
  end if;
  if new.voter_id <> auth.uid() or new.voter_id = new.nominee_id then
    raise exception 'Invalid award vote.' using errcode = '22023';
  end if;
  if not public.trip_fun_feature_available('trip_awards', auth.uid()) then
    raise exception 'Trip Awards is not available on your plan.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.trip_members m where m.trip_id = new.trip_id and m.user_id = auth.uid())
     or not exists (select 1 from public.trip_members m where m.trip_id = new.trip_id and m.user_id = new.nominee_id) then
    raise exception 'Both people must be on this trip.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_trip_fun_vote on public.trip_fun_votes;
create trigger guard_trip_fun_vote before insert or update on public.trip_fun_votes
  for each row execute function public.guard_trip_fun_vote();

revoke execute on function public.guard_trip_fun_entry() from public, anon, authenticated;
revoke execute on function public.guard_trip_fun_vote() from public, anon, authenticated;
