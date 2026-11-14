-- A famous photo of the trip's destination, behind the trip's cover and the
-- top of its overview. Found on Wikipedia by the organizer's device, saved
-- here so everyone on the trip sees the same photo (members' devices never
-- ask Wikipedia). Only freely licensed Wikimedia Commons photos, always shown
-- with their credit.
--
-- The address checks mean nobody can save any other link (such as a tracking
-- image) for everyone on the trip to load.

alter table public.trips
  add column if not exists place_photo_url text
    check (place_photo_url is null or (char_length(place_photo_url) <= 1000 and place_photo_url ~ '^https://upload\.wikimedia\.org/[^[:space:]]+$')),
  add column if not exists place_photo_page text
    check (place_photo_page is null or (char_length(place_photo_page) <= 1000 and place_photo_page ~ '^https://commons\.wikimedia\.org/[^[:space:]]+$')),
  add column if not exists place_photo_credit text
    check (place_photo_credit is null or char_length(place_photo_credit) <= 300),
  add column if not exists place_photo_for text
    check (place_photo_for is null or char_length(place_photo_for) <= 200),
  add column if not exists place_photo_off boolean not null default false;

alter table public.trips drop constraint if exists trips_place_photo_complete;
alter table public.trips add constraint trips_place_photo_complete
  check ((place_photo_url is null) = (place_photo_page is null) and (place_photo_url is null) = (place_photo_credit is null));

-- Only the organizer can update a trip (policy "trips: organizer can update").
grant update (place_photo_url, place_photo_page, place_photo_credit, place_photo_for, place_photo_off) on public.trips to authenticated;
