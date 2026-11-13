-- Add Trip Fun tables to Supabase Realtime when the standard publication is present.
do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='trip_fun_entries'
    ) then execute 'alter publication supabase_realtime add table public.trip_fun_entries'; end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='trip_fun_votes'
    ) then execute 'alter publication supabase_realtime add table public.trip_fun_votes'; end if;
  end if;
end $$;
