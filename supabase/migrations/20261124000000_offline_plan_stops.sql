-- Plan stops added with no connection wait on the device and are sent when
-- the connection is back (src/lib/plan-outbox.ts). Each carries a client id
-- made on the device, so a retry after a lost response never adds it twice
-- (the app inserts with "on conflict do nothing"), as bills already do.
alter table public.itinerary_items add column if not exists client_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'itinerary_items_client_id_key') then
    alter table public.itinerary_items add constraint itinerary_items_client_id_key unique (client_id);
  end if;
end;
$$;
grant insert (client_id) on public.itinerary_items to authenticated;
