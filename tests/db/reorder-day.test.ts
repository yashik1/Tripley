/**
 * Saving a new order for a day's stops (migration 20261119000000_reorder_day),
 * as the route suggestion does.
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, connect, createTrip, createUser, startDb } from './helpers';

let db: Client;
let ana: string, ben: string, cleo: string, stranger: string;
let trip: string;
const DAY = '2026-12-02';
const ids: Record<string, string> = {};

const add = (who: string, title: string, day = DAY) =>
  as(db, who, (q) => q('insert into public.itinerary_items (trip_id, day, title) values ($1, $2, $3) returning id', [trip, day, title])).then(
    (r) => r.rows[0].id as string,
  );
const order = async (day = DAY) =>
  (await db.query('select title from public.itinerary_items where trip_id = $1 and day = $2 order by position', [trip, day])).rows.map((r) => r.title);
const reorder = (who: string, titles: string[], day = DAY) =>
  as(db, who, (q) => q('select public.reorder_itinerary_day($1, $2, $3)', [trip, day, titles.map((t) => ids[t])]));

beforeAll(async () => {
  db = await startDb('tripley_reorder_day');
  ana = await createUser(db, 'Ana');
  ben = await createUser(db, 'Ben');
  cleo = await createUser(db, 'Cleo');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, ana, [ben, cleo], 'Lisbon');
  await db.query(`update public.trips set starts_on = '2026-12-01', ends_on = '2026-12-05' where id = $1`, [trip]);
  for (const [who, title] of [
    [ben, 'Castle'],
    [ben, 'Tram 28'],
    [ana, 'Tile museum'],
    [ben, 'Viewpoint'],
  ] as const) {
    ids[title] = await add(who, title);
  }
  ids['Beach'] = await add(cleo, 'Beach', '2026-12-03');
});

afterAll(async () => {
  await db?.end();
});

describe('reordering a day', () => {
  it('the organizer saves any order', async () => {
    expect(await order()).toEqual(['Castle', 'Tram 28', 'Tile museum', 'Viewpoint']);
    await reorder(ana, ['Tile museum', 'Viewpoint', 'Castle', 'Tram 28']);
    expect(await order()).toEqual(['Tile museum', 'Viewpoint', 'Castle', 'Tram 28']);
  });

  it('a member can move only stops they added', async () => {
    // Ben added Castle, Tram 28 and Viewpoint; swapping two of his is fine.
    await reorder(ben, ['Tile museum', 'Castle', 'Viewpoint', 'Tram 28']);
    expect(await order()).toEqual(['Tile museum', 'Castle', 'Viewpoint', 'Tram 28']);
    // Moving Ana's Tile museum isn't.
    await expect(reorder(ben, ['Castle', 'Tile museum', 'Viewpoint', 'Tram 28'])).rejects.toThrow(/Only the organizer can move “Tile museum”/);
    await expect(reorder(cleo, ['Tile museum', 'Viewpoint', 'Castle', 'Tram 28'])).rejects.toThrow(/Only the organizer can move/);
    expect(await order()).toEqual(['Tile museum', 'Castle', 'Viewpoint', 'Tram 28']);
  });

  it('must be exactly that day’s stops, each once', async () => {
    await expect(reorder(ana, ['Tile museum', 'Castle', 'Viewpoint'])).rejects.toThrow(/just changed/);
    await expect(reorder(ana, ['Tile museum', 'Castle', 'Viewpoint', 'Viewpoint'])).rejects.toThrow(/just changed/);
    await expect(reorder(ana, ['Tile museum', 'Castle', 'Viewpoint', 'Beach'])).rejects.toThrow(/just changed/);
  });

  it('only people on the trip, only while it’s on', async () => {
    await expect(reorder(stranger, ['Tile museum', 'Castle', 'Viewpoint', 'Tram 28'])).rejects.toThrow(/not found/);
    await expect(as(db, null, (q) => q('select public.reorder_itinerary_day($1, $2, $3)', [trip, DAY, []]))).rejects.toThrow(/permission denied/);
    await db.query('update public.trips set ended_at = now() where id = $1', [trip]);
    await expect(reorder(ana, ['Castle', 'Tile museum', 'Viewpoint', 'Tram 28'])).rejects.toThrow(/ended/);
    await db.query('update public.trips set ended_at = null where id = $1', [trip]);
  });

  it('two people reordering at once: one waits, both finish, and the day stays a clean list', async () => {
    const other = await connect();
    try {
      await other.query('begin');
      await other.query('set local role authenticated');
      await other.query("select set_config('request.jwt.claim.sub', $1, true)", [ana]);
      await other.query('select public.reorder_itinerary_day($1, $2, $3)', [trip, DAY, ['Viewpoint', 'Tram 28', 'Castle', 'Tile museum'].map((t) => ids[t])]);
      const second = reorder(ana, ['Castle', 'Viewpoint', 'Tram 28', 'Tile museum']);
      await new Promise((r) => setTimeout(r, 200));
      await other.query('commit');
      await second;
    } finally {
      await other.end();
    }
    expect(await order()).toEqual(['Castle', 'Viewpoint', 'Tram 28', 'Tile museum']);
    const positions = (await db.query('select position from public.itinerary_items where trip_id = $1 and day = $2 order by position', [trip, DAY])).rows.map((r) => r.position);
    expect(positions).toEqual([0, 1, 2, 3]);
  });
});
