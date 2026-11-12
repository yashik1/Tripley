/**
 * Finding dates together, and decisions into plans
 * (migration 20261120000000_dates_and_decisions).
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let ana: string, ben: string, cleo: string, stranger: string;
let trip: string;

const day = (n: number) => {
  const d = new Date(Date.now() + n * 86_400_000);
  return d.toISOString().slice(0, 10);
};
const answers = async () =>
  (await db.query('select user_id, day::text, status from public.trip_availability where trip_id = $1 order by user_id, day', [trip])).rows;

beforeAll(async () => {
  db = await startDb('tripley_dates_decisions');
  ana = await createUser(db, 'Ana');
  ben = await createUser(db, 'Ben');
  cleo = await createUser(db, 'Cleo');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, ana, [ben, cleo], 'Lisbon');
});

afterAll(async () => {
  await db?.end();
});

describe('finding dates', () => {
  it('only the organizer opens the days to choose from; everyone else is told', async () => {
    await expect(as(db, ben, (q) => q('select public.set_date_window($1, $2, $3, 3)', [trip, day(10), day(40)]))).rejects.toThrow(/Only the organizer/);
    await as(db, ana, (q) => q('select public.set_date_window($1, $2, $3, 3)', [trip, day(10), day(40)]));
    const t = (await db.query('select date_window_start::text, date_window_end::text, date_length from public.trips where id = $1', [trip])).rows[0];
    expect(t).toEqual({ date_window_start: day(10), date_window_end: day(40), date_length: 3 });
    const told = await db.query(`select user_id from public.notifications where kind = 'dates_asked' order by user_id`);
    expect(told.rows.map((r) => r.user_id).sort()).toEqual([ben, cleo].sort());
    const ev = await db.query(`select count(*)::int as n from public.trip_posts where event ->> 'type' = 'dates_asked'`);
    expect(ev.rows[0].n).toBe(1);
  });

  it('checks the window: future, at most a year, and long enough for the trip', async () => {
    const set = (a: string, b: string, n: number) => as(db, ana, (q) => q('select public.set_date_window($1, $2, $3, $4)', [trip, a, b, n]));
    await expect(set(day(-10), day(5), 2)).rejects.toThrow(/from today on/);
    await expect(set(day(10), day(5), 2)).rejects.toThrow(/on or after the first/);
    await expect(set(day(1), day(400), 2)).rejects.toThrow(/up to a year/);
    await expect(set(day(10), day(11), 5)).rejects.toThrow(/has to fit/);
  });

  it('each person sets their own days, inside the window; answers replace the last ones', async () => {
    await as(db, ben, (q) => q('select public.set_my_availability($1, $2, $3)', [trip, [day(12), day(13), day(14)], [day(15)]]));
    await as(db, ben, (q) => q('select public.set_my_availability($1, $2, $3)', [trip, [day(13), day(14), day(15)], [day(15), day(16)]]));
    expect((await answers()).filter((r) => r.user_id === ben)).toEqual([
      { user_id: ben, day: day(13), status: 'yes' },
      { user_id: ben, day: day(14), status: 'yes' },
      { user_id: ben, day: day(15), status: 'yes' },
      { user_id: ben, day: day(16), status: 'maybe' },
    ]);
    await expect(as(db, ben, (q) => q('select public.set_my_availability($1, $2, $3)', [trip, [day(5)], []]))).rejects.toThrow(/Pick days between/);
  });

  it('answers are visible to the trip only, and only through the function', async () => {
    expect((await as(db, cleo, (q) => q('select user_id from public.trip_availability'))).rowCount).toBe(4);
    expect((await as(db, stranger, (q) => q('select user_id from public.trip_availability'))).rowCount).toBe(0);
    await expect(as(db, stranger, (q) => q('select public.set_my_availability($1, $2, $3)', [trip, [day(13)], []]))).rejects.toThrow(/not found/);
    await expect(
      as(db, ben, (q) => q(`insert into public.trip_availability (trip_id, user_id, day, status) values ($1, $2, $3, 'yes')`, [trip, cleo, day(13)])),
    ).rejects.toThrow(/permission denied/);
    await expect(as(db, ben, (q) => q('update public.trips set date_window_start = null, date_window_end = null where id = $1', [trip]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('the organizer reminds those who haven’t answered, at most every 12 hours', async () => {
    const n = await as(db, ana, (q) => q('select public.remind_availability($1) as n', [trip]));
    expect(n.rows[0].n).toBe(1); // Cleo; Ben answered
    const reminded = await db.query(`select user_id from public.notifications where kind = 'dates_reminder'`);
    expect(reminded.rows.map((r) => r.user_id)).toEqual([cleo]);
    await expect(as(db, ana, (q) => q('select public.remind_availability($1)', [trip]))).rejects.toThrow(/recently/);
    await expect(as(db, ben, (q) => q('select public.remind_availability($1)', [trip]))).rejects.toThrow(/Only the organizer/);
  });

  it('narrowing the window drops answers outside it; leaving the trip drops yours', async () => {
    await as(db, ana, (q) => q('select public.set_date_window($1, $2, $3, 2)', [trip, day(14), day(40)]));
    expect((await answers()).map((r) => r.day)).toEqual([day(14), day(15), day(16)]);
    const dan = await createUser(db, 'Dan');
    await db.query('insert into public.trip_members (trip_id, user_id) values ($1, $2)', [trip, dan]);
    await as(db, dan, (q) => q('select public.set_my_availability($1, $2, $3)', [trip, [day(20)], []]));
    expect((await answers()).some((r) => r.user_id === dan)).toBe(true);
    await as(db, dan, (q) => q('delete from public.trip_members where trip_id = $1 and user_id = $2', [trip, dan]));
    expect((await answers()).some((r) => r.user_id === dan)).toBe(false);
  });

  it('the organizer sets the trip dates the usual way, and can stop asking', async () => {
    await as(db, ana, (q) => q('update public.trips set starts_on = $2, ends_on = $3 where id = $1', [trip, day(14), day(15)]));
    await as(db, ana, (q) => q('select public.set_date_window($1, null, null, null)', [trip]));
    const t = (await db.query('select starts_on::text, date_window_start from public.trips where id = $1', [trip])).rows[0];
    expect(t).toEqual({ starts_on: day(14), date_window_start: null });
    await expect(as(db, cleo, (q) => q('select public.set_my_availability($1, $2, $3)', [trip, [day(14)], []]))).rejects.toThrow(/hasn't asked/);
  });
});

describe('decisions into plans', () => {
  let ideas: string[];
  let poll: string;

  beforeAll(async () => {
    ideas = [];
    for (const name of ['Tile museum', 'Fado night', 'Belém tower']) {
      ideas.push(
        (await as(db, ben, (q) => q(`insert into public.trip_suggestions (trip_id, name, category) values ($1, $2, 'sight') returning id`, [trip, name]))).rows[0].id,
      );
    }
  });

  it('a poll made from bucket-list ideas keeps the link to each idea', async () => {
    poll = (await as(db, cleo, (q) => q(`select public.create_poll_from_ideas($1, 'What first?', $2) as id`, [trip, ideas]))).rows[0].id;
    const opts = (await db.query('select label, suggestion_id from public.poll_options where poll_id = $1 order by position', [poll])).rows;
    expect(opts).toEqual([
      { label: 'Tile museum', suggestion_id: ideas[0] },
      { label: 'Fado night', suggestion_id: ideas[1] },
      { label: 'Belém tower', suggestion_id: ideas[2] },
    ]);
    await expect(as(db, cleo, (q) => q(`select public.create_poll_from_ideas($1, 'Q?', $2)`, [trip, [ideas[0]]]))).rejects.toThrow(/2 to 8/);
  });

  it('only this trip’s ideas', async () => {
    const other = await createTrip(db, stranger, [], 'Elsewhere');
    const foreign = (await as(db, stranger, (q) => q(`insert into public.trip_suggestions (trip_id, name, category) values ($1, 'Secret spot', 'food') returning id`, [other]))).rows[0].id;
    await expect(as(db, ana, (q) => q(`select public.create_poll_from_ideas($1, 'Q?', $2)`, [trip, [ideas[0], foreign]]))).rejects.toThrow(/aren't all/);
  });

  it('the winning idea goes into the plan once, even if two people press at once', async () => {
    const winner = (await db.query('select id from public.poll_options where poll_id = $1 and suggestion_id = $2', [poll, ideas[1]])).rows[0].id;
    const [a, b] = await Promise.all([
      as(db, ana, (q) => q('select public.add_poll_option_to_plan($1, $2) as id', [winner, day(14)])),
      as(db, ben, (q) => q('select public.add_poll_option_to_plan($1, $2) as id', [winner, day(14)])),
    ]);
    expect(a.rows[0].id).toBe(b.rows[0].id);
    expect((await db.query(`select count(*)::int as n from public.itinerary_items where trip_id = $1 and title = 'Fado night'`, [trip])).rows[0].n).toBe(1);
    // It's the idea's stop too, so "add to plan" from the bucket list finds it.
    const s = (await db.query('select itinerary_item_id from public.trip_suggestions where id = $1', [ideas[1]])).rows[0];
    expect(s.itinerary_item_id).toBe(a.rows[0].id);
  });

  it('a free-form option becomes a stop named after it', async () => {
    const free = (await as(db, ana, (q) => q(`select public.create_poll($1, 'Dinner?', array['Taberna','Ramen']) as id`, [trip]))).rows[0].id;
    const ramen = (await db.query(`select id from public.poll_options where poll_id = $1 and label = 'Ramen'`, [free])).rows[0].id;
    const stop = (await as(db, cleo, (q) => q('select public.add_poll_option_to_plan($1, $2) as id', [ramen, day(15)]))).rows[0].id;
    const item = (await db.query('select title, day::text, created_by from public.itinerary_items where id = $1', [stop])).rows[0];
    expect(item).toEqual({ title: 'Ramen', day: day(15), created_by: cleo });
    await expect(as(db, stranger, (q) => q('select public.add_poll_option_to_plan($1, $2)', [ramen, day(15)]))).rejects.toThrow(/not found/);
  });
});
