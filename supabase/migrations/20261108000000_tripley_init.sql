-- Tripley initial schema: trips, members, invitations, live locations, bills,
-- splits, settlements, notifications, push tokens, accounts (plan / AI quota).
--
-- Security model: Row Level Security on every table. Multi-row writes that
-- need validation (joining, inviting, saving a bill, confirming a payment) go
-- through SECURITY DEFINER functions that check the caller explicitly.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('organizer', 'member');
create type public.invite_status as enum ('pending', 'accepted', 'declined', 'cancelled');
create type public.settlement_status as enum ('paid', 'confirmed', 'disputed');
create type public.split_mode as enum ('itemized', 'equal');
create type public.plan_tier as enum ('free', 'pro');
create type public.sharing_mode as enum ('live', 'saver');

-- ---------------------------------------------------------------------------
-- Helpers (no table dependencies)
-- ---------------------------------------------------------------------------
create or replace function public.currency_exponent(code text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when code = any (array['BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF']) then 0
    when code = any (array['BHD','IQD','JOD','KWD','LYD','OMR','TND']) then 3
    else 2
  end
$$;

-- "1234.50 EUR" style text for notification bodies.
create or replace function public.format_minor(minor bigint, code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case public.currency_exponent(code)
    when 0 then to_char(minor, 'FM999,999,999,999,990')
    else to_char(minor::numeric / (10 ^ public.currency_exponent(code)),
                 'FM999,999,999,999,990.' || repeat('0', public.currency_exponent(code)))
  end || ' ' || code
$$;

create or replace function public.new_invite_code()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 12 hex chars (48 random bits) from a v4 UUID; unguessable enough for a link.
  select substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
$$;

create or replace function public.try_uuid(t text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return t::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  default_currency text not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  payment_handles jsonb not null default '{}'::jsonb check (jsonb_typeof(payment_handles) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Private per-user account data (plan and AI quota). Only the server writes it.
create table public.accounts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  plan public.plan_tier not null default 'free',
  plan_expires_at timestamptz,
  ai_scans_used int not null default 0,
  ai_scans_period text,
  updated_at timestamptz not null default now()
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  organizer_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  starts_on date,
  ends_on date,
  invite_code text not null unique default public.new_invite_code(),
  invite_enabled boolean not null default true,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table public.trip_members (
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null default 'member',
  location_sharing boolean not null default true,
  sharing_mode public.sharing_mode not null default 'live',
  last_nudged_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index trip_members_user_idx on public.trip_members (user_id);

create table public.trip_invitations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  invited_by uuid not null references public.profiles (id) on delete cascade,
  invitee_id uuid not null references public.profiles (id) on delete cascade,
  status public.invite_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index trip_invitations_one_pending
  on public.trip_invitations (trip_id, invitee_id) where status = 'pending';
create index trip_invitations_invitee_idx on public.trip_invitations (invitee_id, status);

-- Latest position only (no history). Deleted when sharing is paused and after a trip ends.
create table public.member_locations (
  trip_id uuid not null,
  user_id uuid not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m real check (accuracy_m is null or accuracy_m >= 0),
  heading real,
  speed_mps real,
  battery_level real check (battery_level is null or battery_level between 0 and 1),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id),
  foreign key (trip_id, user_id) references public.trip_members (trip_id, user_id) on delete cascade
);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  paid_by uuid not null references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  bill_date date not null default current_date,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(24, 12) not null default 1 check (fx_rate > 0),
  split_mode public.split_mode not null,
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  service_minor bigint not null default 0 check (service_minor >= 0),
  tip_minor bigint not null default 0 check (tip_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  total_base_minor bigint not null check (total_base_minor >= 0),
  receipt_path text,
  source text not null default 'manual' check (source in ('manual', 'ai')),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bills_trip_idx on public.bills (trip_id, bill_date desc, created_at desc);

create table public.bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  position int not null,
  name text not null default '' check (char_length(name) <= 200),
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  line_total_minor bigint not null check (line_total_minor >= 0)
);
create index bill_items_bill_idx on public.bill_items (bill_id, position);

create table public.bill_item_shares (
  item_id uuid not null references public.bill_items (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  weight int not null default 1 check (weight between 1 and 1000),
  primary key (item_id, user_id)
);

-- Each person's computed share of a bill (snapshot of the split engine result).
create table public.bill_shares (
  bill_id uuid not null references public.bills (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  amount_minor bigint not null check (amount_minor >= 0),
  amount_base_minor bigint not null check (amount_base_minor >= 0),
  primary key (bill_id, user_id)
);
create index bill_shares_user_idx on public.bill_shares (user_id);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  from_user uuid not null default auth.uid() references public.profiles (id),
  to_user uuid not null references public.profiles (id),
  amount_base_minor bigint not null check (amount_base_minor > 0),
  method text check (method is null or char_length(method) <= 40),
  note text check (note is null or char_length(note) <= 300),
  status public.settlement_status not null default 'paid',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_user <> to_user)
);
create index settlements_trip_idx on public.settlements (trip_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger trips_touch before update on public.trips
  for each row execute function public.touch_updated_at();
create trigger bills_touch before update on public.bills
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Membership helpers (SECURITY DEFINER so policies don't recurse)
-- ---------------------------------------------------------------------------
create or replace function public.is_member_of(p_trip uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_members m where m.trip_id = p_trip and m.user_id = p_user
  )
$$;

create or replace function public.is_trip_member(p_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_member_of(p_trip, auth.uid())
$$;

create or replace function public.is_trip_organizer(p_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip and m.user_id = auth.uid() and m.role = 'organizer'
  )
$$;

create or replace function public.trip_is_active(p_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- One day of grace after the end date for time zones.
  select exists (
    select 1 from public.trips t
    where t.id = p_trip
      and t.ended_at is null
      and (t.ends_on is null or t.ends_on >= (now() at time zone 'utc')::date - 1)
  )
$$;

create or replace function public.can_share_location(p_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.trip_is_active(p_trip) and exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip and m.user_id = auth.uid() and m.location_sharing
  )
$$;

-- Can the caller see this person's profile? (same trip, or a pending invite between them)
create or replace function public.can_see_profile(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user = auth.uid()
    or exists (
      select 1 from public.trip_members a
      join public.trip_members b on a.trip_id = b.trip_id
      where a.user_id = auth.uid() and b.user_id = p_user
    )
    or exists (
      select 1 from public.trip_invitations i
      where i.status = 'pending'
        and ((i.invited_by = auth.uid() and i.invitee_id = p_user)
          or (i.invitee_id = auth.uid() and i.invited_by = p_user))
    )
$$;

create or replace function public.can_read_bill(p_bill uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bills b
    where b.id = p_bill and public.is_member_of(b.trip_id, auth.uid())
  )
$$;

create or replace function public.display_name_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(p.display_name), ''), 'Someone') from public.profiles p where p.id = p_user
$$;

create or replace function public.notify(
  p_user uuid, p_trip uuid, p_kind text, p_title text, p_body text, p_data jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, trip_id, kind, title, body, data)
  values (p_user, p_trip, p_kind, p_title, p_body, coalesce(p_data, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- New auth user -> profile + account row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      ''
    ), 60),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  insert into public.accounts (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- New trip -> organizer is a member.
create or replace function public.handle_new_trip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.trip_members (trip_id, user_id, role)
  values (new.id, new.organizer_id, 'organizer')
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_trip_created
  after insert on public.trips
  for each row execute function public.handle_new_trip();

-- Base currency can't change once bills exist (their converted totals depend on it).
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
  if new.organizer_id <> old.organizer_id then
    raise exception 'The organizer can''t be changed.' using errcode = '42501';
  end if;
  if new.invite_code <> old.invite_code and current_setting('tripley.allow_code_change', true) is distinct from 'on' then
    raise exception 'Use regenerate_invite_code() to change the invite link.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trips_guard before update on public.trips
  for each row execute function public.guard_trip_update();

-- Pausing sharing hides your last position immediately.
create or replace function public.handle_sharing_paused()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.location_sharing and not new.location_sharing then
    delete from public.member_locations l where l.trip_id = new.trip_id and l.user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger on_sharing_paused
  after update of location_sharing on public.trip_members
  for each row execute function public.handle_sharing_paused();

-- Someone joined -> tell the organizer.
create or replace function public.handle_member_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips%rowtype;
begin
  if new.role = 'organizer' then
    return new;
  end if;
  select * into v_trip from public.trips where id = new.trip_id;
  if v_trip.organizer_id <> new.user_id then
    perform public.notify(
      v_trip.organizer_id, v_trip.id, 'member_joined', v_trip.name,
      public.display_name_of(new.user_id) || ' joined the trip',
      jsonb_build_object('trip_id', v_trip.id, 'user_id', new.user_id)
    );
  end if;
  return new;
end;
$$;

create trigger on_member_joined
  after insert on public.trip_members
  for each row execute function public.handle_member_joined();

-- Invitation created -> tell the invitee.
create or replace function public.handle_invitation_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip_name text;
begin
  select name into v_trip_name from public.trips where id = new.trip_id;
  perform public.notify(
    new.invitee_id, new.trip_id, 'invitation', 'Trip invite',
    public.display_name_of(new.invited_by) || ' invited you to ' || v_trip_name,
    jsonb_build_object('trip_id', new.trip_id, 'invitation_id', new.id)
  );
  return new;
end;
$$;

create trigger on_invitation_created
  after insert on public.trip_invitations
  for each row execute function public.handle_invitation_created();

-- Settlement created / answered -> tell the other person.
create or replace function public.handle_settlement_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips%rowtype;
  v_amount text;
begin
  select * into v_trip from public.trips where id = new.trip_id;
  v_amount := public.format_minor(new.amount_base_minor, v_trip.base_currency);
  if tg_op = 'INSERT' then
    perform public.notify(
      new.to_user, new.trip_id, 'settlement_paid', v_trip.name,
      public.display_name_of(new.from_user) || ' marked ' || v_amount || ' as paid to you. Tap to confirm.',
      jsonb_build_object('trip_id', new.trip_id, 'settlement_id', new.id)
    );
  elsif tg_op = 'UPDATE' and new.status <> old.status then
    perform public.notify(
      new.from_user, new.trip_id, 'settlement_' || new.status::text, v_trip.name,
      public.display_name_of(new.to_user)
        || case new.status
             when 'confirmed' then ' confirmed your payment of ' || v_amount
             else ' says they haven''t received ' || v_amount || ' yet'
           end,
      jsonb_build_object('trip_id', new.trip_id, 'settlement_id', new.id)
    );
  end if;
  return new;
end;
$$;

create trigger on_settlement_event
  after insert or update of status on public.settlements
  for each row execute function public.handle_settlement_event();

-- Settlements must be between two members of the trip.
create or replace function public.guard_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_member_of(new.trip_id, new.from_user) or not public.is_member_of(new.trip_id, new.to_user) then
    raise exception 'Both people must be in the trip.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger settlements_guard before insert on public.settlements
  for each row execute function public.guard_settlement();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_invitations enable row level security;
alter table public.member_locations enable row level security;
alter table public.bills enable row level security;
alter table public.bill_items enable row level security;
alter table public.bill_item_shares enable row level security;
alter table public.bill_shares enable row level security;
alter table public.settlements enable row level security;
alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;

-- profiles
create policy "profiles: visible to people you travel with"
  on public.profiles for select to authenticated
  using (public.can_see_profile(id));
create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- accounts (read own; written by server functions only)
create policy "accounts: read own"
  on public.accounts for select to authenticated
  using (user_id = auth.uid());

-- trips
-- organizer_id check: lets `insert ... returning` work before the organizer's
-- membership row (added by an AFTER trigger) exists.
create policy "trips: members can read"
  on public.trips for select to authenticated
  using (organizer_id = auth.uid() or public.is_trip_member(id));
create policy "trips: anyone signed in can create their own"
  on public.trips for insert to authenticated
  with check (organizer_id = auth.uid());
create policy "trips: organizer can update"
  on public.trips for update to authenticated
  using (public.is_trip_organizer(id)) with check (public.is_trip_organizer(id));
create policy "trips: organizer can delete"
  on public.trips for delete to authenticated
  using (public.is_trip_organizer(id));

-- trip_members
create policy "members: members can read"
  on public.trip_members for select to authenticated
  using (public.is_trip_member(trip_id));
create policy "members: update own sharing settings"
  on public.trip_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "members: leave, or organizer removes a member"
  on public.trip_members for delete to authenticated
  using (
    (user_id = auth.uid() and role = 'member')
    or (role = 'member' and public.is_trip_organizer(trip_id))
  );

-- trip_invitations (created/answered through functions)
create policy "invitations: invitee and trip members can read"
  on public.trip_invitations for select to authenticated
  using (invitee_id = auth.uid() or public.is_trip_member(trip_id));

-- member_locations
create policy "locations: members can read"
  on public.member_locations for select to authenticated
  using (public.is_trip_member(trip_id));
create policy "locations: write own while sharing"
  on public.member_locations for insert to authenticated
  with check (user_id = auth.uid() and public.can_share_location(trip_id));
create policy "locations: update own while sharing"
  on public.member_locations for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_share_location(trip_id));
create policy "locations: delete own"
  on public.member_locations for delete to authenticated
  using (user_id = auth.uid());

-- bills and their parts (written through save_bill())
create policy "bills: members can read"
  on public.bills for select to authenticated
  using (public.is_trip_member(trip_id));
create policy "bills: creator, payer or organizer can delete"
  on public.bills for delete to authenticated
  using (
    public.is_trip_member(trip_id)
    and (created_by = auth.uid() or paid_by = auth.uid() or public.is_trip_organizer(trip_id))
  );
create policy "bill_items: members can read"
  on public.bill_items for select to authenticated
  using (public.can_read_bill(bill_id));
create policy "bill_item_shares: members can read"
  on public.bill_item_shares for select to authenticated
  using (exists (select 1 from public.bill_items i where i.id = item_id and public.can_read_bill(i.bill_id)));
create policy "bill_shares: members can read"
  on public.bill_shares for select to authenticated
  using (public.can_read_bill(bill_id));

-- settlements
create policy "settlements: members can read"
  on public.settlements for select to authenticated
  using (public.is_trip_member(trip_id));
create policy "settlements: payer records a payment"
  on public.settlements for insert to authenticated
  with check (from_user = auth.uid() and status = 'paid' and public.is_trip_member(trip_id));
create policy "settlements: payer can undo before it is confirmed"
  on public.settlements for delete to authenticated
  using (from_user = auth.uid() and status = 'paid');

-- notifications
create policy "notifications: read own"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "notifications: mark own read"
  on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications: delete own"
  on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- push_tokens
create policy "push_tokens: manage own"
  on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Column-level privileges: restrict what clients may write directly.
-- (Supabase grants full table privileges to anon/authenticated by default.)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;

revoke insert, update, delete on public.profiles from authenticated;
grant update (display_name, avatar_url, default_currency, payment_handles) on public.profiles to authenticated;

revoke insert, update, delete on public.accounts from authenticated;

revoke update on public.trips from authenticated;
grant update (name, starts_on, ends_on, invite_enabled, ended_at) on public.trips to authenticated;

revoke insert, update on public.trip_members from authenticated;
grant update (location_sharing, sharing_mode) on public.trip_members to authenticated;

revoke insert, update, delete on public.trip_invitations from authenticated;

revoke insert, update, delete on public.bills from authenticated;
grant delete on public.bills to authenticated;
revoke insert, update, delete on public.bill_items from authenticated;
revoke insert, update, delete on public.bill_item_shares from authenticated;
revoke insert, update, delete on public.bill_shares from authenticated;

revoke update on public.settlements from authenticated;

revoke insert on public.notifications from authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Public preview for the invite-link landing page (works before sign-in).
create or replace function public.trip_preview(p_code text)
returns table (
  trip_id uuid,
  name text,
  organizer_name text,
  member_count int,
  member_names text[],
  starts_on date,
  ends_on date,
  is_member boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.name,
    public.display_name_of(t.organizer_id),
    (select count(*)::int from public.trip_members m where m.trip_id = t.id),
    array(
      select public.display_name_of(m.user_id) from public.trip_members m
      where m.trip_id = t.id order by m.joined_at limit 6
    ),
    t.starts_on,
    t.ends_on,
    coalesce(public.is_member_of(t.id, auth.uid()), false)
  from public.trips t
  where t.invite_code = lower(btrim(p_code))
    and t.invite_enabled
    and t.ended_at is null
$$;

create or replace function public.join_trip_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_trip uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in first.' using errcode = '28000';
  end if;
  select t.id into v_trip from public.trips t
  where t.invite_code = lower(btrim(p_code)) and t.invite_enabled and t.ended_at is null;
  if v_trip is null then
    raise exception 'This invite link is not valid any more. Ask the organizer for a new one.'
      using errcode = 'P0002';
  end if;
  insert into public.trip_members (trip_id, user_id, role)
  values (v_trip, v_uid, 'member')
  on conflict do nothing;
  update public.trip_invitations
    set status = 'accepted', responded_at = now()
    where trip_id = v_trip and invitee_id = v_uid and status = 'pending';
  return v_trip;
end;
$$;

create or replace function public.regenerate_invite_code(p_trip uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not public.is_trip_organizer(p_trip) then
    raise exception 'Only the organizer can change the invite link.' using errcode = '42501';
  end if;
  perform set_config('tripley.allow_code_change', 'on', true);
  update public.trips set invite_code = public.new_invite_code(), invite_enabled = true
    where id = p_trip returning invite_code into v_code;
  perform set_config('tripley.allow_code_change', 'off', true);
  return v_code;
end;
$$;

-- Shared by the invite_* functions below.
create or replace function public.create_invitation(p_trip uuid, p_invitee uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_trip_member(p_trip) then
    raise exception 'You are not in this trip.' using errcode = '42501';
  end if;
  if not public.trip_is_active(p_trip) then
    raise exception 'This trip has ended.' using errcode = '22023';
  end if;
  if p_invitee is null then
    return 'not_found';
  end if;
  if public.is_member_of(p_trip, p_invitee) then
    return 'already_member';
  end if;
  if exists (
    select 1 from public.trip_invitations
    where trip_id = p_trip and invitee_id = p_invitee and status = 'pending'
  ) then
    return 'already_invited';
  end if;
  if (select count(*) from public.trip_invitations
      where invited_by = v_uid and created_at > now() - interval '1 hour') >= 50 then
    raise exception 'Too many invitations. Try again later.' using errcode = '54000';
  end if;
  insert into public.trip_invitations (trip_id, invited_by, invitee_id)
  values (p_trip, v_uid, p_invitee);
  return 'invited';
end;
$$;

-- Invite someone by phone number. Never reveals the number or the person, only
-- whether an in-app invitation was sent ('invited' / 'not_found' / ...).
create or replace function public.invite_by_phone(p_trip uuid, p_phone text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_user uuid;
begin
  if length(v_digits) < 8 or length(v_digits) > 15 then
    raise exception 'Enter the full phone number with country code.' using errcode = '22023';
  end if;
  select u.id into v_user from auth.users u
  where regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') = v_digits
  limit 1;
  return public.create_invitation(p_trip, v_user);
end;
$$;

create or replace function public.invite_by_email(p_trip uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
  return public.create_invitation(p_trip, v_user);
end;
$$;

-- Invite someone you've travelled with before.
create or replace function public.invite_user(p_trip uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_see_profile(p_user) then
    return 'not_found';
  end if;
  return public.create_invitation(p_trip, p_user);
end;
$$;

-- People you've shared a trip with (for quick invites).
create or replace function public.my_trip_friends()
returns table (user_id uuid, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.id, p.display_name, p.avatar_url
  from public.trip_members mine
  join public.trip_members theirs on theirs.trip_id = mine.trip_id and theirs.user_id <> mine.user_id
  join public.profiles p on p.id = theirs.user_id
  where mine.user_id = auth.uid()
$$;

create or replace function public.my_invitations()
returns table (
  invitation_id uuid,
  trip_id uuid,
  trip_name text,
  invited_by_name text,
  starts_on date,
  ends_on date,
  member_count int,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, t.id, t.name, public.display_name_of(i.invited_by), t.starts_on, t.ends_on,
         (select count(*)::int from public.trip_members m where m.trip_id = t.id),
         i.created_at
  from public.trip_invitations i
  join public.trips t on t.id = i.trip_id
  where i.invitee_id = auth.uid() and i.status = 'pending' and t.ended_at is null
  order by i.created_at desc
$$;

create or replace function public.respond_to_invitation(p_invitation uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.trip_invitations%rowtype;
begin
  select * into v_inv from public.trip_invitations
  where id = p_invitation and invitee_id = auth.uid() and status = 'pending'
  for update;
  if not found then
    raise exception 'This invitation is no longer available.' using errcode = 'P0002';
  end if;
  update public.trip_invitations
    set status = case when p_accept then 'accepted' else 'declined' end::public.invite_status,
        responded_at = now()
    where id = v_inv.id;
  if p_accept then
    insert into public.trip_members (trip_id, user_id, role)
    values (v_inv.trip_id, v_inv.invitee_id, 'member')
    on conflict do nothing;
  end if;
  return v_inv.trip_id;
end;
$$;

create or replace function public.cancel_invitation(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.trip_invitations i
    set status = 'cancelled', responded_at = now()
    where i.id = p_invitation and i.status = 'pending'
      and (i.invited_by = auth.uid() or public.is_trip_organizer(i.trip_id));
  if not found then
    raise exception 'Invitation not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.respond_to_settlement(p_settlement uuid, p_status public.settlement_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('confirmed', 'disputed') then
    raise exception 'Choose confirmed or disputed.' using errcode = '22023';
  end if;
  update public.settlements s
    set status = p_status, responded_at = now()
    where s.id = p_settlement and s.to_user = auth.uid() and s.status <> p_status;
  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.mark_notifications_read()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null
$$;

-- Create or update a bill with its items, who-had-what and computed shares, in
-- one transaction. The client computes the split (src/lib/split.ts); this
-- function checks that everything adds up and everyone is in the trip.
--
-- p: {
--   id?, trip_id, paid_by, title, bill_date?, currency, fx_rate?, split_mode,
--   tax_minor?, service_minor?, tip_minor?, discount_minor?, total_minor, total_base_minor,
--   receipt_path?, source?, notes?,
--   items: [{ name, quantity?, line_total_minor, shares: [{ user_id, weight? }] }],
--   shares: [{ user_id, amount_minor, amount_base_minor }]
-- }
create or replace function public.save_bill(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_trip public.trips%rowtype;
  v_existing public.bills%rowtype;
  v_bill_id uuid := public.try_uuid(nullif(p ->> 'id', ''));
  v_is_new boolean := v_bill_id is null;
  v_paid_by uuid := public.try_uuid(p ->> 'paid_by');
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_currency text := upper(btrim(coalesce(p ->> 'currency', '')));
  v_rate numeric := coalesce(nullif(p ->> 'fx_rate', '')::numeric, 1);
  v_mode public.split_mode := (p ->> 'split_mode')::public.split_mode;
  v_tax bigint := coalesce((p ->> 'tax_minor')::bigint, 0);
  v_service bigint := coalesce((p ->> 'service_minor')::bigint, 0);
  v_tip bigint := coalesce((p ->> 'tip_minor')::bigint, 0);
  v_discount bigint := coalesce((p ->> 'discount_minor')::bigint, 0);
  v_total bigint := (p ->> 'total_minor')::bigint;
  v_total_base bigint := (p ->> 'total_base_minor')::bigint;
  v_items jsonb := coalesce(p -> 'items', '[]'::jsonb);
  v_shares jsonb := coalesce(p -> 'shares', '[]'::jsonb);
  v_source text := coalesce(nullif(p ->> 'source', ''), 'manual');
  v_subtotal bigint;
  v_sum bigint;
  v_sum_base bigint;
  v_expected_base numeric;
  v_item jsonb;
  v_item_id uuid;
  v_pos int := 0;
begin
  if v_uid is null then
    raise exception 'Please sign in first.' using errcode = '28000';
  end if;

  select * into v_trip from public.trips where id = public.try_uuid(p ->> 'trip_id');
  if not found or not public.is_member_of(v_trip.id, v_uid) then
    raise exception 'You are not in this trip.' using errcode = '42501';
  end if;
  if v_paid_by is null or not public.is_member_of(v_trip.id, v_paid_by) then
    raise exception 'The person who paid must be in the trip.' using errcode = '22023';
  end if;
  if v_title = '' then
    raise exception 'Give the bill a name.' using errcode = '22023';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Unknown currency.' using errcode = '22023';
  end if;
  if v_currency = v_trip.base_currency then
    v_rate := 1;
  end if;
  if v_rate <= 0 then
    raise exception 'The exchange rate must be positive.' using errcode = '22023';
  end if;
  if v_total is null or v_total < 0 or v_total_base is null or v_total_base < 0 then
    raise exception 'The bill total is missing.' using errcode = '22023';
  end if;
  if least(v_tax, v_service, v_tip, v_discount) < 0 then
    raise exception 'Tax, tip and discounts can''t be negative.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_typeof(v_shares) <> 'array' then
    raise exception 'Malformed bill.' using errcode = '22023';
  end if;

  if not v_is_new then
    select * into v_existing from public.bills where id = v_bill_id for update;
    if not found or v_existing.trip_id <> v_trip.id then
      raise exception 'Bill not found.' using errcode = 'P0002';
    end if;
    if v_uid <> v_existing.created_by and v_uid <> v_existing.paid_by
       and not public.is_trip_organizer(v_trip.id) then
      raise exception 'Only the person who added or paid this bill can edit it.' using errcode = '42501';
    end if;
  end if;

  -- Items
  if exists (
    select 1 from jsonb_array_elements(v_items) i
    where coalesce((i ->> 'line_total_minor')::bigint, -1) < 0
  ) then
    raise exception 'Every item needs a price.' using errcode = '22023';
  end if;
  select coalesce(sum((i ->> 'line_total_minor')::bigint), 0) into v_subtotal
  from jsonb_array_elements(v_items) i;

  if v_mode = 'itemized' then
    if jsonb_array_length(v_items) = 0 then
      raise exception 'Add at least one item.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_items) i
      where (i ->> 'line_total_minor')::bigint > 0
        and jsonb_array_length(coalesce(i -> 'shares', '[]'::jsonb)) = 0
    ) then
      raise exception 'Every item needs at least one person.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_items) i,
        jsonb_array_elements(coalesce(i -> 'shares', '[]'::jsonb)) s
      where not public.is_member_of(v_trip.id, public.try_uuid(s ->> 'user_id'))
         or coalesce((s ->> 'weight')::int, 1) not between 1 and 1000
    ) then
      raise exception 'Everyone in the split must be in the trip.' using errcode = '22023';
    end if;
    if v_total <> v_subtotal + v_tax + v_service + v_tip - v_discount then
      raise exception 'The total doesn''t match the items, tax and tip.' using errcode = '22023';
    end if;
  else
    -- Equal split: one total, no extras.
    v_subtotal := v_total;
    v_tax := 0; v_service := 0; v_tip := 0; v_discount := 0;
  end if;

  -- Shares
  if jsonb_array_length(v_shares) = 0 then
    raise exception 'Choose who is splitting this bill.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_shares) s
    where not public.is_member_of(v_trip.id, public.try_uuid(s ->> 'user_id'))
  ) then
    raise exception 'Everyone in the split must be in the trip.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(v_shares))
     <> (select count(distinct s ->> 'user_id') from jsonb_array_elements(v_shares) s) then
    raise exception 'Someone appears twice in the split.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_shares) s
    where coalesce((s ->> 'amount_minor')::bigint, -1) < 0
       or coalesce((s ->> 'amount_base_minor')::bigint, -1) < 0
  ) then
    raise exception 'Shares can''t be negative.' using errcode = '22023';
  end if;
  select sum((s ->> 'amount_minor')::bigint), sum((s ->> 'amount_base_minor')::bigint)
    into v_sum, v_sum_base
  from jsonb_array_elements(v_shares) s;
  if v_sum <> v_total then
    raise exception 'The shares don''t add up to the total.' using errcode = '22023';
  end if;
  if v_sum_base <> v_total_base then
    raise exception 'The converted shares don''t add up to the converted total.' using errcode = '22023';
  end if;
  v_expected_base := v_total * v_rate
    * (10::numeric ^ (public.currency_exponent(v_trip.base_currency) - public.currency_exponent(v_currency)));
  if abs(v_total_base - round(v_expected_base)) > 1 then
    raise exception 'The converted total doesn''t match the exchange rate.' using errcode = '22023';
  end if;

  -- Write
  if v_is_new then
    insert into public.bills (
      trip_id, paid_by, created_by, title, bill_date, currency, fx_rate, split_mode,
      subtotal_minor, tax_minor, service_minor, tip_minor, discount_minor,
      total_minor, total_base_minor, receipt_path, source, notes
    ) values (
      v_trip.id, v_paid_by, v_uid, v_title,
      coalesce(nullif(p ->> 'bill_date', '')::date, current_date),
      v_currency, v_rate, v_mode,
      v_subtotal, v_tax, v_service, v_tip, v_discount,
      v_total, v_total_base, nullif(p ->> 'receipt_path', ''), v_source, nullif(p ->> 'notes', '')
    ) returning id into v_bill_id;
  else
    update public.bills set
      paid_by = v_paid_by, title = v_title,
      bill_date = coalesce(nullif(p ->> 'bill_date', '')::date, bill_date),
      currency = v_currency, fx_rate = v_rate, split_mode = v_mode,
      subtotal_minor = v_subtotal, tax_minor = v_tax, service_minor = v_service,
      tip_minor = v_tip, discount_minor = v_discount,
      total_minor = v_total, total_base_minor = v_total_base,
      receipt_path = coalesce(nullif(p ->> 'receipt_path', ''), receipt_path),
      source = v_source, notes = nullif(p ->> 'notes', '')
    where id = v_bill_id;
    delete from public.bill_items where bill_id = v_bill_id;
    delete from public.bill_shares where bill_id = v_bill_id;
  end if;

  for v_item in select * from jsonb_array_elements(v_items) loop
    insert into public.bill_items (bill_id, position, name, quantity, line_total_minor)
    values (
      v_bill_id, v_pos, left(btrim(coalesce(v_item ->> 'name', '')), 200),
      coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1),
      (v_item ->> 'line_total_minor')::bigint
    ) returning id into v_item_id;
    if v_mode = 'itemized' then
      insert into public.bill_item_shares (item_id, user_id, weight)
      select v_item_id, (s ->> 'user_id')::uuid, sum(coalesce((s ->> 'weight')::int, 1))
      from jsonb_array_elements(coalesce(v_item -> 'shares', '[]'::jsonb)) s
      group by (s ->> 'user_id')::uuid;
    end if;
    v_pos := v_pos + 1;
  end loop;

  insert into public.bill_shares (bill_id, user_id, amount_minor, amount_base_minor)
  select v_bill_id, (s ->> 'user_id')::uuid, (s ->> 'amount_minor')::bigint, (s ->> 'amount_base_minor')::bigint
  from jsonb_array_elements(v_shares) s;

  -- Tell everyone who owes something on this bill.
  insert into public.notifications (user_id, trip_id, kind, title, body, data)
  select (s ->> 'user_id')::uuid, v_trip.id,
         case when v_is_new then 'bill_added' else 'bill_updated' end,
         v_trip.name,
         public.display_name_of(v_uid)
           || case when v_is_new then ' added "' else ' updated "' end || v_title
           || '" · your share ' || public.format_minor((s ->> 'amount_base_minor')::bigint, v_trip.base_currency),
         jsonb_build_object('trip_id', v_trip.id, 'bill_id', v_bill_id)
  from jsonb_array_elements(v_shares) s
  where (s ->> 'user_id')::uuid <> v_uid
    and (s ->> 'user_id')::uuid <> v_paid_by
    and (s ->> 'amount_base_minor')::bigint > 0;

  return v_bill_id;
end;
$$;

-- Function privileges: internal helpers are not callable through the API.
revoke execute on function public.notify(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.create_invitation(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.display_name_of(uuid) from public, anon;
revoke execute on function public.is_member_of(uuid, uuid) from public, anon;
grant execute on function public.trip_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private receipts (by trip folder) and public avatars (by user folder)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false), ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "receipts: trip members can read"
  on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_trip_member(public.try_uuid((storage.foldername(name))[1])));
create policy "receipts: trip members can upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_trip_member(public.try_uuid((storage.foldername(name))[1])));
create policy "receipts: uploader can delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and owner = auth.uid());

create policy "avatars: anyone can read"
  on storage.objects for select
  using (bucket_id = 'avatars');
create policy "avatars: upload own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: replace own"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and owner = auth.uid());
create policy "avatars: delete own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and owner = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime: live map dots, bills, payments, members and notifications
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.member_locations, public.bills, public.settlements, public.trip_members, public.notifications;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduled cleanup: forget locations 24h after a trip ends (needs pg_cron)
-- ---------------------------------------------------------------------------
create or replace function public.purge_ended_trip_locations()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  delete from public.member_locations l
  using public.trips t
  where t.id = l.trip_id
    and (
      (t.ended_at is not null and t.ended_at < now() - interval '24 hours')
      or (t.ends_on is not null and t.ends_on < (now() at time zone 'utc')::date - 2)
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.purge_ended_trip_locations() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('tripley-purge-locations', '17 * * * *', 'select public.purge_ended_trip_locations()');
  end if;
end;
$$;
