-- Ranked polls: everyone puts the options in order (first choice first) and
-- the result is a Borda count, worked out in the app from the stored ranks
-- (src/lib/group-decisions.ts). Existing polls are unchanged.
--
--  * trip_polls.ranked: set when the poll is made (create_ranked_poll and
--    create_ranked_poll_from_ideas wrap the existing functions, so it's one
--    step); a ranked poll is never also "pick several".
--  * poll_votes.rank: 1 for a first choice, 2 for second... (null in other polls).
--  * rank_poll() replaces your ranking; a vote without a rank on a ranked
--    poll (or with one on another poll) is refused, so vote_poll() can't be
--    used on ranked polls.

alter table public.trip_polls add column if not exists ranked boolean not null default false;
alter table public.trip_polls drop constraint if exists trip_polls_ranked_single;
alter table public.trip_polls add constraint trip_polls_ranked_single check (not (ranked and multiple));
alter table public.poll_votes add column if not exists rank smallint check (rank is null or rank between 1 and 8);

create or replace function public.guard_poll_vote_rank()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ranked boolean;
begin
  select p.ranked into v_ranked from public.trip_polls p where p.id = new.poll_id;
  if v_ranked and new.rank is null then
    raise exception 'Put the options in order for this poll.' using errcode = '22023';
  end if;
  if not v_ranked and new.rank is not null then
    raise exception 'This poll isn''t ranked.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists poll_votes_rank_guard on public.poll_votes;
create trigger poll_votes_rank_guard before insert or update on public.poll_votes
  for each row execute function public.guard_poll_vote_rank();

create or replace function public.create_ranked_poll(
  p_trip uuid,
  p_question text,
  p_options text[],
  p_closes_at timestamptz default null,
  p_allow_change boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_poll uuid;
begin
  v_poll := public.create_poll(p_trip, p_question, p_options, p_closes_at, p_allow_change, false);
  update public.trip_polls set ranked = true where id = v_poll;
  return v_poll;
end;
$$;

create or replace function public.create_ranked_poll_from_ideas(
  p_trip uuid,
  p_question text,
  p_suggestions uuid[],
  p_closes_at timestamptz default null,
  p_allow_change boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_poll uuid;
begin
  v_poll := public.create_poll_from_ideas(p_trip, p_question, p_suggestions, p_closes_at, p_allow_change, false);
  update public.trip_polls set ranked = true where id = v_poll;
  return v_poll;
end;
$$;

-- Your order, first choice first (some or all of the options). An empty list
-- takes your ranking back (when the poll allows changing).
create or replace function public.rank_poll(p_poll uuid, p_options uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.trip_polls%rowtype;
  v_had boolean;
  v_n int := coalesce(cardinality(p_options), 0);
begin
  select * into v_p from public.trip_polls where id = p_poll;
  if not found or not public.is_trip_member(v_p.trip_id) then
    raise exception 'Poll not found.' using errcode = 'P0002';
  end if;
  if not v_p.ranked then
    raise exception 'This poll isn''t ranked.' using errcode = '22023';
  end if;
  if not public.poll_is_open(v_p) then
    raise exception 'This poll is closed.' using errcode = '22023';
  end if;
  if v_n > 8 or (select count(distinct x) from unnest(p_options) x) <> v_n then
    raise exception 'Rank each option once.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_options) x where not exists (select 1 from public.poll_options o where o.id = x and o.poll_id = p_poll)) then
    raise exception 'That isn''t one of the options.' using errcode = '22023';
  end if;
  v_had := exists (select 1 from public.poll_votes where poll_id = p_poll and user_id = auth.uid());
  if v_had and not v_p.allow_change then
    raise exception 'This poll doesn''t allow changing your vote.' using errcode = '22023';
  end if;
  delete from public.poll_votes where poll_id = p_poll and user_id = auth.uid();
  insert into public.poll_votes (poll_id, option_id, trip_id, user_id, rank)
  select p_poll, x.id, v_p.trip_id, auth.uid(), x.k
  from unnest(p_options) with ordinality as x(id, k);
end;
$$;

revoke execute on function public.guard_poll_vote_rank() from public, anon, authenticated;
revoke execute on function public.create_ranked_poll(uuid, text, text[], timestamptz, boolean) from public, anon;
revoke execute on function public.create_ranked_poll_from_ideas(uuid, text, uuid[], timestamptz, boolean) from public, anon;
revoke execute on function public.rank_poll(uuid, uuid[]) from public, anon;
grant execute on function public.create_ranked_poll(uuid, text, text[], timestamptz, boolean) to authenticated;
grant execute on function public.create_ranked_poll_from_ideas(uuid, text, uuid[], timestamptz, boolean) to authenticated;
grant execute on function public.rank_poll(uuid, uuid[]) to authenticated;
