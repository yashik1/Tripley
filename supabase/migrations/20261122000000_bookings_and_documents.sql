-- Bookings and documents: the trip's flights, trains, stays and tickets in one
-- place, with their confirmation codes and files (PDF or photo), readable
-- offline. A booking can go into the plan once. Personal bookings and
-- documents (a passport copy) can be private: only whoever added them sees
-- them. Files live in the private "trip-docs" bucket, inside the trip's
-- folder, and are readable only while the document row allows it.
--
-- Also: AI reading (Pro) now accepts a PDF, or an AI plan draft, as what a
-- reservation is for (reserve_ai_scan's path check), so booking screenshots,
-- PDFs and plan drafts share the one monthly quota with receipts.

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('trip-docs', 'trip-docs', false)
on conflict (id) do update set public = false;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets
      set file_size_limit = 10 * 1024 * 1024,
          allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
      where id = 'trip-docs';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------
create table if not exists public.trip_bookings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  kind text not null default 'other' check (kind in ('flight', 'train', 'bus', 'ferry', 'car', 'stay', 'ticket', 'other')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  provider text check (provider is null or char_length(provider) <= 80),
  reference text check (reference is null or char_length(reference) <= 60),
  start_day date,
  start_time time,
  end_day date,
  end_time time,
  from_place text check (from_place is null or char_length(from_place) <= 120),
  to_place text check (to_place is null or char_length(to_place) <= 120),
  address text check (address is null or char_length(address) <= 300),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  notes text check (notes is null or char_length(notes) <= 1000),
  -- Who it's for; empty means everyone on the trip.
  traveller_ids uuid[] not null default '{}' check (cardinality(traveller_ids) <= 50),
  -- Only whoever added it sees it (and its documents).
  private boolean not null default false,
  itinerary_item_id uuid references public.itinerary_items (id) on delete set null,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_bookings_point_complete check ((lat is null) = (lng is null)),
  constraint trip_bookings_time_needs_day check ((start_time is null or start_day is not null) and (end_time is null or end_day is not null)),
  constraint trip_bookings_end_after_start check (
    end_day is null or start_day is null or end_day > start_day
    or (end_day = start_day and (end_time is null or start_time is null or end_time >= start_time))
  )
);
create index if not exists trip_bookings_trip_idx on public.trip_bookings (trip_id, start_day, start_time);

create or replace function public.guard_trip_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.trip_bookings where trip_id = new.trip_id) >= 200 then
      raise exception 'A trip can have up to 200 bookings.' using errcode = '54000';
    end if;
  else
    if new.trip_id <> old.trip_id or new.created_by <> old.created_by then
      raise exception 'A booking stays in its own trip.' using errcode = '22023';
    end if;
    new.updated_at := now();
  end if;
  -- Travellers are people on the trip (anyone else is dropped).
  new.traveller_ids := coalesce((
    select array_agg(distinct t)
    from unnest(new.traveller_ids) t
    where public.is_member_of(new.trip_id, t)
  ), '{}');
  if new.itinerary_item_id is not null
     and not exists (select 1 from public.itinerary_items i where i.id = new.itinerary_item_id and i.trip_id = new.trip_id) then
    raise exception 'That plan isn''t on this trip.' using errcode = '22023';
  end if;
  new.title := btrim(new.title);
  new.reference := nullif(btrim(coalesce(new.reference, '')), '');
  return new;
end;
$$;
drop trigger if exists trip_bookings_guard on public.trip_bookings;
create trigger trip_bookings_guard before insert or update on public.trip_bookings
  for each row execute function public.guard_trip_booking();

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
create table if not exists public.trip_documents (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  booking_id uuid references public.trip_bookings (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  path text not null unique,
  mime text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes int not null check (size_bytes between 1 and 10485760),
  private boolean not null default false,
  uploaded_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists trip_documents_trip_idx on public.trip_documents (trip_id, created_at desc);
create index if not exists trip_documents_booking_idx on public.trip_documents (booking_id);

-- A document is a file you uploaded into this trip's folder. Its type and size
-- come from the stored file, not from what the app says.
create or replace function public.guard_trip_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obj record;
  v_booking public.trip_bookings%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.path !~ ('^' || new.trip_id::text || '/[A-Za-z0-9_-]{1,64}\.(pdf|jpg|jpeg|png|webp)$') then
      raise exception 'Upload the file into this trip first.' using errcode = '22023';
    end if;
    select o.metadata into v_obj from storage.objects o
    where o.bucket_id = 'trip-docs' and o.name = new.path and o.owner = auth.uid();
    if not found then
      raise exception 'Upload the file into this trip first.' using errcode = '22023';
    end if;
    new.mime := coalesce(v_obj.metadata ->> 'mimetype', new.mime);
    new.size_bytes := coalesce((v_obj.metadata ->> 'size')::int, new.size_bytes);
    if (select count(*) from public.trip_documents where trip_id = new.trip_id) >= 300 then
      raise exception 'A trip can keep up to 300 documents.' using errcode = '54000';
    end if;
  else
    if new.trip_id <> old.trip_id or new.path <> old.path or new.uploaded_by <> old.uploaded_by
       or new.mime <> old.mime or new.size_bytes <> old.size_bytes then
      raise exception 'Only the name, booking and privacy of a document can change.' using errcode = '22023';
    end if;
  end if;
  if new.booking_id is not null then
    select * into v_booking from public.trip_bookings where id = new.booking_id;
    if not found or v_booking.trip_id <> new.trip_id then
      raise exception 'That booking isn''t on this trip.' using errcode = '22023';
    end if;
    -- A private booking's documents are private too.
    if v_booking.private then
      if v_booking.created_by <> new.uploaded_by then
        raise exception 'That booking isn''t on this trip.' using errcode = '22023';
      end if;
      new.private := true;
    end if;
  end if;
  new.name := btrim(new.name);
  return new;
end;
$$;
drop trigger if exists trip_documents_guard on public.trip_documents;
create trigger trip_documents_guard before insert or update on public.trip_documents
  for each row execute function public.guard_trip_document();

-- Making a booking private makes its documents private.
create or replace function public.handle_booking_private()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.private and not old.private then
    -- Documents others attached to it are unlinked rather than hidden from them.
    update public.trip_documents set booking_id = null where booking_id = new.id and uploaded_by <> new.created_by;
    update public.trip_documents set private = true where booking_id = new.id and not private;
  end if;
  return new;
end;
$$;
drop trigger if exists trip_bookings_private on public.trip_bookings;
create trigger trip_bookings_private after update of private on public.trip_bookings
  for each row execute function public.handle_booking_private();

-- Leaving a trip takes your private bookings and documents with you. (Your
-- private files stay readable only by you; the app deletes them first.)
create or replace function public.handle_member_left_docs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.trip_documents where trip_id = old.trip_id and uploaded_by = old.user_id and private;
  delete from public.trip_bookings where trip_id = old.trip_id and created_by = old.user_id and private;
  return old;
end;
$$;
drop trigger if exists trip_members_left_docs on public.trip_members;
create trigger trip_members_left_docs after delete on public.trip_members
  for each row execute function public.handle_member_left_docs();

-- Deleting your account deletes your documents and private bookings (the app
-- removes the files first, from account_files()). Shared bookings stay with
-- the trip, like plans, under "Former member".
create or replace function public.handle_profile_deleted_docs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.trip_documents where uploaded_by = new.id;
    delete from public.trip_bookings where created_by = new.id and private;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_deleted_docs on public.profiles;
create trigger profiles_deleted_docs after update of deleted_at on public.profiles
  for each row execute function public.handle_profile_deleted_docs();

-- Your files to delete with your account: as before, plus every document you uploaded.
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
    and o.bucket_id in ('avatars', 'receipts', 'trip-photos', 'trip-docs')
    and not exists (select 1 from kept k where k.bucket = o.bucket_id and k.path = o.name)
$$;

-- Put a booking into the plan, once (a second press gets the same stop).
create or replace function public.add_booking_to_plan(p_booking uuid, p_day date default null, p_starts_at time default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.trip_bookings%rowtype;
  v_trip public.trips%rowtype;
  v_item uuid;
  v_day date;
begin
  select * into v_b from public.trip_bookings where id = p_booking for update;
  if not found or not public.is_trip_member(v_b.trip_id) or (v_b.private and v_b.created_by <> auth.uid()) then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  if v_b.itinerary_item_id is not null and exists (select 1 from public.itinerary_items where id = v_b.itinerary_item_id) then
    return v_b.itinerary_item_id;
  end if;
  if v_b.private then
    raise exception 'Private bookings stay out of the shared plan.' using errcode = '42501';
  end if;
  if not public.trip_is_active(v_b.trip_id) then
    raise exception 'This trip has ended.' using errcode = '22023';
  end if;
  select * into v_trip from public.trips where id = v_b.trip_id;
  v_day := coalesce(p_day, v_b.start_day, greatest(v_trip.starts_on, (now() at time zone 'utc')::date), (now() at time zone 'utc')::date);
  insert into public.itinerary_items (trip_id, day, title, starts_at, ends_at, place_name, address, lat, lng, created_by)
  values (
    v_b.trip_id,
    v_day,
    v_b.title,
    coalesce(p_starts_at, v_b.start_time),
    case when v_b.end_day = v_day and v_b.end_time > coalesce(p_starts_at, v_b.start_time) then v_b.end_time end,
    left(coalesce(v_b.from_place, v_b.provider, v_b.to_place), 120),
    v_b.address,
    v_b.lat,
    v_b.lng,
    auth.uid()
  )
  returning id into v_item;
  update public.trip_bookings set itinerary_item_id = v_item where id = p_booking;
  return v_item;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.trip_bookings enable row level security;
alter table public.trip_documents enable row level security;

drop policy if exists "bookings: members read shared ones and their own" on public.trip_bookings;
create policy "bookings: members read shared ones and their own" on public.trip_bookings for select to authenticated
  using (public.is_trip_member(trip_id) and (not private or created_by = auth.uid()));
drop policy if exists "bookings: members add while the trip is on" on public.trip_bookings;
create policy "bookings: members add while the trip is on" on public.trip_bookings for insert to authenticated
  with check (public.is_trip_member(trip_id) and public.trip_is_active(trip_id));
drop policy if exists "bookings: who added it or the organizer edits shared ones" on public.trip_bookings;
create policy "bookings: who added it or the organizer edits shared ones" on public.trip_bookings for update to authenticated
  using (public.is_trip_member(trip_id) and (created_by = auth.uid() or (not private and public.is_trip_organizer(trip_id))))
  with check (created_by = auth.uid() or (not private and public.is_trip_organizer(trip_id)));
drop policy if exists "bookings: who added it or the organizer removes shared ones" on public.trip_bookings;
create policy "bookings: who added it or the organizer removes shared ones" on public.trip_bookings for delete to authenticated
  using (public.is_trip_member(trip_id) and (created_by = auth.uid() or (not private and public.is_trip_organizer(trip_id))));

drop policy if exists "documents: members read shared ones and their own" on public.trip_documents;
create policy "documents: members read shared ones and their own" on public.trip_documents for select to authenticated
  using (public.is_trip_member(trip_id) and (not private or uploaded_by = auth.uid()));
drop policy if exists "documents: members add their own" on public.trip_documents;
create policy "documents: members add their own" on public.trip_documents for insert to authenticated
  with check (public.is_trip_member(trip_id) and public.trip_is_active(trip_id));
drop policy if exists "documents: uploader edits" on public.trip_documents;
create policy "documents: uploader edits" on public.trip_documents for update to authenticated
  using (uploaded_by = auth.uid() and public.is_trip_member(trip_id))
  with check (uploaded_by = auth.uid());
drop policy if exists "documents: uploader or the organizer removes shared ones" on public.trip_documents;
create policy "documents: uploader or the organizer removes shared ones" on public.trip_documents for delete to authenticated
  using (public.is_trip_member(trip_id) and (uploaded_by = auth.uid() or (not private and public.is_trip_organizer(trip_id))));

revoke all on public.trip_bookings, public.trip_documents from anon;
revoke insert, update on public.trip_bookings from authenticated;
grant select, delete on public.trip_bookings to authenticated;
grant insert (trip_id, kind, title, provider, reference, start_day, start_time, end_day, end_time, from_place, to_place, address, lat, lng, notes, traveller_ids, private)
  on public.trip_bookings to authenticated;
grant update (kind, title, provider, reference, start_day, start_time, end_day, end_time, from_place, to_place, address, lat, lng, notes, traveller_ids, private)
  on public.trip_bookings to authenticated;
revoke insert, update on public.trip_documents from authenticated;
grant select, delete on public.trip_documents to authenticated;
grant insert (trip_id, booking_id, name, path, mime, size_bytes, private) on public.trip_documents to authenticated;
grant update (name, booking_id, private) on public.trip_documents to authenticated;

-- Files: upload into a trip you're on; read when the document row lets you
-- (or it's your own upload); delete your own, or a shared one as organizer.
drop policy if exists "trip-docs: trip members can upload" on storage.objects;
create policy "trip-docs: trip members can upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'trip-docs'
    and name ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9_-]{1,64}\.(pdf|jpg|jpeg|png|webp)$'
    and public.is_trip_member(public.try_uuid((storage.foldername(name))[1]))
    and public.can_upload_now()
  );
drop policy if exists "trip-docs: readable with the document" on storage.objects;
create policy "trip-docs: readable with the document"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'trip-docs'
    and (
      owner = auth.uid()
      or exists (
        select 1 from public.trip_documents d
        where d.path = storage.objects.name
          and public.is_trip_member(d.trip_id)
          and (not d.private or d.uploaded_by = auth.uid())
      )
    )
  );
drop policy if exists "trip-docs: uploader or organizer deletes" on storage.objects;
create policy "trip-docs: uploader or organizer deletes"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'trip-docs'
    and (
      owner = auth.uid()
      or exists (
        select 1 from public.trip_documents d
        where d.path = storage.objects.name and not d.private and public.is_trip_organizer(d.trip_id)
      )
    )
  );

revoke execute on function public.guard_trip_booking() from public, anon, authenticated;
revoke execute on function public.guard_trip_document() from public, anon, authenticated;
revoke execute on function public.handle_booking_private() from public, anon, authenticated;
revoke execute on function public.handle_member_left_docs() from public, anon, authenticated;
revoke execute on function public.handle_profile_deleted_docs() from public, anon, authenticated;
revoke execute on function public.add_booking_to_plan(uuid, date, time) from public, anon;
grant execute on function public.add_booking_to_plan(uuid, date, time) to authenticated;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['trip_bookings', 'trip_documents'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- AI reading: the same quota for a PDF booking or an AI plan draft. Only the
-- path check changes from 20261110000000_security_hardening.sql.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_ai_scan(
  p_user uuid,
  p_request uuid,
  p_trip uuid,
  p_path text,
  p_limit int,
  p_per_minute int default 6
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc public.accounts%rowtype;
  v_req public.ai_scan_requests%rowtype;
  v_period text := public.ai_scan_period();
  v_used int;
  v_recent int;
  v_refunds int;
begin
  if p_user is null or p_request is null or p_trip is null or coalesce(p_limit, -1) < 0 then
    return jsonb_build_object('status', 'bad_request');
  end if;
  if p_path is null or p_path !~ ('^' || p_trip::text || '/([A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp|pdf)|ai-plan-[0-9a-f-]{36})$') then
    return jsonb_build_object('status', 'bad_request');
  end if;

  select * into v_acc from public.accounts where user_id = p_user for update;
  if not found or v_acc.plan <> 'pro' or (v_acc.plan_expires_at is not null and v_acc.plan_expires_at <= now()) then
    return jsonb_build_object('status', 'pro_required');
  end if;
  if not public.is_member_of(p_trip, p_user) then
    return jsonb_build_object('status', 'not_member');
  end if;

  v_used := case when v_acc.ai_scans_period = v_period then v_acc.ai_scans_used else 0 end;

  -- Reservations whose function died without finishing are refunded.
  with stale as (
    update public.ai_scan_requests r set status = 'released', finished_at = now()
    where r.user_id = p_user and r.status = 'reserved' and r.created_at < now() - interval '10 minutes'
    returning r.period
  )
  select count(*) filter (where period = v_period) into v_refunds from stale;
  v_used := greatest(0, v_used - v_refunds);
  -- Read receipts are only kept for a day; old request rows for 90 days.
  update public.ai_scan_requests set result = null
    where user_id = p_user and result is not null and finished_at < now() - interval '1 day';
  delete from public.ai_scan_requests where user_id = p_user and created_at < now() - interval '90 days';

  select * into v_req from public.ai_scan_requests where id = p_request;
  if found then
    if v_req.user_id <> p_user or v_req.trip_id <> p_trip or v_req.path <> p_path then
      return jsonb_build_object('status', 'bad_request');
    end if;
    if v_req.status = 'done' and v_req.result is not null then
      -- A retry of a scan that already worked: same answer, no extra charge.
      update public.accounts set ai_scans_used = v_used, ai_scans_period = v_period where user_id = p_user;
      return jsonb_build_object('status', 'done', 'result', v_req.result, 'scans_left', greatest(0, p_limit - v_used));
    end if;
    if v_req.status = 'reserved' then
      update public.accounts set ai_scans_used = v_used, ai_scans_period = v_period where user_id = p_user;
      return jsonb_build_object('status', 'in_progress');
    end if;
  end if;

  if v_used >= p_limit then
    update public.accounts set ai_scans_used = v_used, ai_scans_period = v_period where user_id = p_user;
    return jsonb_build_object('status', 'quota_exceeded', 'limit', p_limit);
  end if;
  select count(*) into v_recent from public.ai_scan_requests
    where user_id = p_user and created_at > now() - interval '1 minute';
  if v_recent >= greatest(coalesce(p_per_minute, 6), 1) then
    update public.accounts set ai_scans_used = v_used, ai_scans_period = v_period where user_id = p_user;
    return jsonb_build_object('status', 'rate_limited');
  end if;

  update public.accounts
    set ai_scans_used = v_used + 1, ai_scans_period = v_period, updated_at = now()
    where user_id = p_user;
  insert into public.ai_scan_requests (id, user_id, trip_id, path, period, status, created_at)
  values (p_request, p_user, p_trip, p_path, v_period, 'reserved', now())
  on conflict (id) do update
    set status = 'reserved', period = excluded.period, result = null, created_at = now(), finished_at = null;
  return jsonb_build_object('status', 'reserved', 'scans_left', p_limit - v_used - 1);
end;
$$;
