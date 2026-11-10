-- Account deletion, started by the person themselves from their profile.
--
-- What it does (see delete_my_account() below):
--  * Trips where they are the only member are deleted with everything in them.
--  * Shared trips stay. They leave each one (which already removes their
--    location, reactions, votes and RSVPs); if they were the organizer, the
--    longest-standing other member becomes the organizer.
--  * Their posts, comments, photos, packing lists and photo memories are
--    deleted. Bills, payments, plans, ideas and polls stay in the group's
--    records so everyone's balances and plans still add up; they show as
--    "Former member".
--  * Their profile is emptied and kept only as that anonymous placeholder, and
--    their sign-in record (email, phone, password, sessions) is deleted.
--
-- Stored photos are removed by the app through the Storage API first, because
-- deleting a row from storage.objects in SQL would leave the file on disk.
-- delete_my_account() refuses to run while any of those files remain.

-- The function below deletes from auth.users and reads storage.objects, as the
-- role running this migration. Stop the deploy here rather than ship a button
-- that fails, or one that quietly leaves the sign-in record behind.
do $$
declare
  v_past_row_security boolean;
begin
  if not has_table_privilege(current_user, 'auth.users', 'DELETE') then
    raise exception 'Role % cannot delete from auth.users, so account deletion would not work.', current_user;
  end if;
  select r.rolsuper or r.rolbypassrls into v_past_row_security from pg_catalog.pg_roles r where r.rolname = current_user;
  if not coalesce(v_past_row_security, false) and exists (
    select 1 from pg_catalog.pg_class c
    where c.oid in ('auth.users'::regclass, 'storage.objects'::regclass)
      and c.relrowsecurity and pg_catalog.pg_get_userbyid(c.relowner) <> current_user
  ) then
    raise exception 'Role % is subject to row security on auth.users or storage.objects, so account deletion would not work.', current_user;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- A deleted account keeps an anonymous profile row (bills and payments point
-- at it), so profiles can no longer be tied to auth.users by a cascading
-- foreign key. A trigger does what the cascade did for every other account.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists deleted_at timestamptz;

-- Whatever the foreign key to auth.users is called.
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname from pg_catalog.pg_constraint c
    where c.conrelid = 'public.profiles'::regclass and c.confrelid = 'auth.users'::regclass and c.contype = 'f'
  loop
    execute format('alter table public.profiles drop constraint %I', v_name);
  end loop;
end;
$$;

create or replace function public.handle_user_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.profiles where id = old.id and deleted_at is null;
  return old;
end;
$$;
drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_user_deleted();

-- A deleted account's access token keeps working until it expires (up to an
-- hour). These two guards make sure it can't be used to come back.
create or replace function public.guard_deleted_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is not null then
    raise exception 'This account was deleted.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_frozen_when_deleted on public.profiles;
create trigger profiles_frozen_when_deleted before update on public.profiles
  for each row execute function public.guard_deleted_profile();

create or replace function public.guard_deleted_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.user_id and p.deleted_at is not null) then
    raise exception 'This account was deleted.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trip_members_not_deleted on public.trip_members;
create trigger trip_members_not_deleted before insert on public.trip_members
  for each row execute function public.guard_deleted_member();

-- The organizer still can't be changed by anyone directly; only account
-- deletion hands a trip over.
create or replace function public.guard_trip_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.base_currency <> old.base_currency
     and exists (select 1 from public.bills b where b.trip_id = old.id) then
    raise exception 'The trip currency can''t be changed after bills have been added.'
      using errcode = '22023';
  end if;
  if new.organizer_id <> old.organizer_id and current_setting('tripley.allow_organizer_change', true) is distinct from 'on' then
    raise exception 'The organizer can''t be changed.' using errcode = '42501';
  end if;
  if new.invite_code <> old.invite_code and current_setting('tripley.allow_code_change', true) is distinct from 'on' then
    raise exception 'Use regenerate_invite_code() to change the invite link.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Files this person uploaded that go with the account. Kept: cover photos and
-- receipts that belong to trips other people are still on.
-- ---------------------------------------------------------------------------
create or replace function public.account_files(p_user uuid)
returns table (bucket text, path text)
language sql
stable
security definer
set search_path = ''
as $$
  with doomed as (
    select m.trip_id
    from public.trip_members m
    where m.user_id = p_user
      and not exists (select 1 from public.trip_members o where o.trip_id = m.trip_id and o.user_id <> p_user)
  ),
  kept as (
    select 'trip-photos'::text as bucket, t.cover_path as path
    from public.trips t
    where t.cover_path is not null and t.id not in (select d.trip_id from doomed d)
    union all
    select 'receipts'::text, b.receipt_path
    from public.bills b
    where b.receipt_path is not null and b.trip_id not in (select d.trip_id from doomed d)
  )
  select o.bucket_id::text, o.name::text
  from storage.objects o
  where o.owner = p_user
    and o.bucket_id in ('avatars', 'receipts', 'trip-photos')
    and not exists (select 1 from kept k where k.bucket = o.bucket_id and k.path = o.name)
$$;

-- What deleting your account will do, shown before you confirm.
create or replace function public.account_deletion_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'trips_deleted', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name, t.id)
      from public.trip_members m
      join public.trips t on t.id = m.trip_id
      where m.user_id = v_uid
        and not exists (select 1 from public.trip_members o where o.trip_id = m.trip_id and o.user_id <> v_uid)
    ), '[]'::jsonb),
    'trips_left', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'new_organizer', case when m.role = 'organizer' then (
          select nullif(btrim(p.display_name), '')
          from public.trip_members o
          join public.profiles p on p.id = o.user_id
          where o.trip_id = m.trip_id and o.user_id <> v_uid
          order by o.joined_at, o.user_id
          limit 1
        ) end
      ) order by t.name, t.id)
      from public.trip_members m
      join public.trips t on t.id = m.trip_id
      where m.user_id = v_uid
        and exists (select 1 from public.trip_members o where o.trip_id = m.trip_id and o.user_id <> v_uid)
    ), '[]'::jsonb),
    -- Open cash kitties in shared trips where this person holds the group's cash.
    'kitties_held', (
      select count(*)
      from public.trip_kitties k
      where k.holder_id = v_uid and k.closed_at is null
        and exists (select 1 from public.trip_members o where o.trip_id = k.trip_id and o.user_id <> v_uid)
    ),
    'pro', coalesce((
      select a.plan = 'pro' and (a.plan_expires_at is null or a.plan_expires_at > now())
      from public.accounts a where a.user_id = v_uid
    ), false),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', f.bucket, 'path', f.path) order by f.bucket, f.path)
      from public.account_files(v_uid) f
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Delete the signed-in person's account. There is no parameter: nobody can
-- delete anyone else's.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_trips uuid[];
  v_heir uuid;
  v_gone int;
  r record;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  -- One deletion at a time for this account.
  select * into v_profile from public.profiles where id = v_uid for update;
  if not found or v_profile.deleted_at is not null then
    raise exception 'This account was deleted.' using errcode = '42501';
  end if;
  if exists (select 1 from public.account_files(v_uid)) then
    raise exception 'Some of your photos couldn''t be removed yet. Please try again.' using errcode = '55000';
  end if;

  select coalesce(array_agg(m.trip_id), '{}') into v_trips from public.trip_members m where m.user_id = v_uid;

  perform set_config('tripley.allow_organizer_change', 'on', true);
  -- Lock the trips in a fixed order so two people deleting at once can't deadlock.
  for r in
    select t.id, t.name, m.role
    from public.trips t
    join public.trip_members m on m.trip_id = t.id and m.user_id = v_uid
    order by t.id
    for update of t
  loop
    select o.user_id into v_heir
    from public.trip_members o
    where o.trip_id = r.id and o.user_id <> v_uid
    order by o.joined_at, o.user_id
    limit 1;

    if v_heir is null then
      -- Nobody else is on it.
      delete from public.trips where id = r.id;
    else
      delete from public.trip_members where trip_id = r.id and user_id = v_uid;
      if r.role = 'organizer' then
        update public.trip_members set role = 'organizer' where trip_id = r.id and user_id = v_heir;
        update public.trips set organizer_id = v_heir where id = r.id;
        perform public.notify(
          v_heir, r.id, 'organizer_changed', r.name,
          'You''re now the organizer of this trip.',
          jsonb_build_object('trip_id', r.id)
        );
      end if;
    end if;
  end loop;
  perform set_config('tripley.allow_organizer_change', 'off', true);

  -- What they wrote and shared, on any trip, including ones they left earlier.
  delete from public.trip_posts where author_id = v_uid;
  delete from public.post_comments where user_id = v_uid;
  delete from public.post_reactions where user_id = v_uid;
  delete from public.itinerary_comments where user_id = v_uid;
  delete from public.itinerary_rsvps where user_id = v_uid;
  delete from public.suggestion_votes where user_id = v_uid;
  delete from public.poll_votes where user_id = v_uid;
  delete from public.challenge_entries where user_id = v_uid;
  delete from public.trip_tasks where created_by = v_uid and kind = 'packing';
  update public.trip_tasks set assignee_id = null where assignee_id = v_uid;
  delete from public.trip_places where created_by = v_uid and kind = 'memory';
  update public.trip_places set photo_path = null where created_by = v_uid and photo_path is not null;
  update public.trip_suggestions set photo_path = null where suggested_by = v_uid and photo_path is not null;
  -- Photos they added to someone else's pin or idea are gone from storage now.
  update public.trip_places p set photo_path = null
  where p.trip_id = any (v_trips) and p.photo_path is not null
    and not exists (select 1 from storage.objects o where o.bucket_id = 'trip-photos' and o.name = p.photo_path);
  update public.trip_suggestions s set photo_path = null
  where s.trip_id = any (v_trips) and s.photo_path is not null
    and not exists (select 1 from storage.objects o where o.bucket_id = 'trip-photos' and o.name = s.photo_path);

  -- What only ever belonged to them.
  delete from public.trip_invitations where invited_by = v_uid or invitee_id = v_uid;
  delete from public.push_tokens where user_id = v_uid;
  delete from public.notifications where user_id = v_uid;
  delete from public.place_presence where user_id = v_uid;
  delete from public.ai_scan_requests where user_id = v_uid;
  update public.subscription_events set user_id = null where user_id = v_uid;
  delete from public.accounts where user_id = v_uid;

  -- The anonymous placeholder that bills, payments and plans still point at.
  update public.profiles
  set display_name = 'Former member',
      avatar_url = null,
      default_currency = 'USD',
      payment_handles = '{}'::jsonb,
      notification_prefs = '{}'::jsonb,
      show_achievements = false,
      deleted_at = now()
  where id = v_uid;

  -- Email, phone, password, linked Google or Apple identity and sessions.
  -- If that can't be removed, nothing above is kept either.
  delete from auth.users where id = v_uid;
  get diagnostics v_gone = row_count;
  if v_gone <> 1 then
    raise exception 'Your account couldn''t be deleted. Please try again.' using errcode = '55000';
  end if;
end;
$$;

revoke execute on function public.handle_user_deleted() from public, anon, authenticated;
revoke execute on function public.guard_deleted_profile() from public, anon, authenticated;
revoke execute on function public.guard_deleted_member() from public, anon, authenticated;
revoke execute on function public.account_files(uuid) from public, anon, authenticated;
revoke execute on function public.account_deletion_preview() from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.account_deletion_preview() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
