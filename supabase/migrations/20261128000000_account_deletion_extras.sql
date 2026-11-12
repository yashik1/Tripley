-- Deleting your account also deletes what was added since: your trip
-- templates, your invite code and any invite links to or from you. (Your
-- documents and private bookings already go: 20261122000000.)
create or replace function public.handle_profile_deleted_extras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.trip_templates where owner_id = new.id;
    delete from public.referral_codes where user_id = new.id;
    delete from public.referrals where referred_id = new.id or referrer_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_deleted_extras on public.profiles;
create trigger profiles_deleted_extras after update of deleted_at on public.profiles
  for each row execute function public.handle_profile_deleted_extras();
revoke execute on function public.handle_profile_deleted_extras() from public, anon, authenticated;
