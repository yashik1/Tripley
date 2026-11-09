/**
 * Travel passport (migration 20261116000000_passport): badges come only from
 * real activity, with the date they were earned, and are private unless the
 * person shares them with people they travel with.
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let maya: string, sam: string, lee: string, stranger: string;
let trip: string;

const badges = (viewer: string, of: string) =>
  as(db, viewer, (q) => q('select key from public.user_achievements($1) order by key', [of])).then((r) => r.rows.map((x) => x.key as string));

beforeAll(async () => {
  db = await startDb('tripley_passport');
  maya = await createUser(db, 'Maya');
  sam = await createUser(db, 'Sam');
  lee = await createUser(db, 'Lee');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, maya, [sam], 'Lisbon');
});

afterAll(async () => {
  await db?.end();
});

describe('travel passport', () => {
  it('a first trip earns "First Trip", dated when you joined', async () => {
    const r = await as(db, sam, (q) => q('select key, earned_at from public.user_achievements($1)', [sam]));
    expect(r.rows.map((x) => x.key)).toEqual(['first_trip']);
    const joined = (await db.query('select joined_at from public.trip_members where trip_id = $1 and user_id = $2', [trip, sam])).rows[0].joined_at;
    expect(new Date(r.rows[0].earned_at).getTime()).toBe(new Date(joined).getTime());
  });

  it('badges need the real thing: "Group Planner" only once 3 people are in your trip', async () => {
    expect(await badges(maya, maya)).toEqual(['first_trip']);
    const code = (await db.query('select invite_code from public.trips where id = $1', [trip])).rows[0].invite_code;
    await as(db, lee, (q) => q('select public.join_trip_by_code($1)', [code]));
    expect(await badges(maya, maya)).toEqual(['first_trip', 'group_planner']);
  });

  it('"Food Explorer" after 5 food finds (places or ideas), not 4', async () => {
    for (let i = 0; i < 4; i++) {
      await as(db, sam, (q) => q(`insert into public.trip_suggestions (trip_id, category, name) values ($1, 'food', $2)`, [trip, `Spot ${i}`]));
    }
    expect(await badges(sam, sam)).not.toContain('food_explorer');
    await as(db, sam, (q) => q(`insert into public.trip_places (trip_id, kind, name, lat, lng) values ($1, 'food', 'Manteigaria', 38.71, -9.14)`, [trip]));
    expect(await badges(sam, sam)).toContain('food_explorer');
  });

  it('private by default; shared only with people you travel with, when you choose', async () => {
    expect(await badges(maya, sam)).toEqual([]);
    await as(db, sam, (q) => q('update public.profiles set show_achievements = true where id = $1', [sam]));
    expect(await badges(maya, sam)).toEqual(['first_trip', 'food_explorer']);
    expect(await badges(stranger, sam)).toEqual([]);
    await expect(as(db, null, (q) => q('select * from public.user_achievements($1)', [sam]))).rejects.toThrow(/permission denied/);
  });

  it('nobody can award themselves a badge', async () => {
    await expect(as(db, sam, (q) => q(`update public.profiles set display_name = display_name where id = $1`, [sam]))).resolves.toBeDefined();
    const tables = await db.query(`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name ilike '%achievement%'`);
    expect(tables.rows[0].n).toBe(0); // nothing stored: badges are computed from real records each time
  });
});
