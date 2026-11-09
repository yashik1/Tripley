/**
 * The interactive features (migrations 20261112… onwards): trip covers and the
 * dashboard summary, the activity feed, bucket list, polls, preparation lists
 * and the travel passport. Who can see and change what, as members, strangers
 * and signed-out visitors.
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let maya: string, sam: string, lee: string, stranger: string;
let trip: string;

beforeAll(async () => {
  db = await startDb('tripley_engagement');
  maya = await createUser(db, 'Maya');
  sam = await createUser(db, 'Sam');
  lee = await createUser(db, 'Lee');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, maya, [sam, lee], 'Lisbon');
});

afterAll(async () => {
  await db?.end();
});

describe('trip covers and the dashboard summary', () => {
  it('the organizer sets the destination and a cover photo from the trip’s folder', async () => {
    await as(db, maya, (q) => q(`update public.trips set destination = 'Lisbon, Portugal', cover_path = $2 where id = $1`, [trip, `${trip}/cover1.jpg`]));
    const r = await as(db, sam, (q) => q('select destination, cover_path from public.trips where id = $1', [trip]));
    expect(r.rows[0]).toEqual({ destination: 'Lisbon, Portugal', cover_path: `${trip}/cover1.jpg` });
  });

  it('a cover from another trip’s folder, or an odd file, is refused', async () => {
    const other = await createTrip(db, stranger, [], 'Elsewhere');
    for (const bad of [`${other}/x.jpg`, `${trip}/x.svg`, `${trip}/a/b.jpg`, '../x.jpg']) {
      await expect(as(db, maya, (q) => q('update public.trips set cover_path = $2 where id = $1', [trip, bad]))).rejects.toThrow(/trips_cover_in_trip_folder/);
    }
  });

  it('other members can’t change the cover', async () => {
    const r = await as(db, sam, (q) => q(`update public.trips set cover_path = null where id = $1`, [trip]));
    expect(r.rowCount).toBe(0);
  });

  it('the summary covers only your trips, with real counts', async () => {
    await as(db, sam, (q) => q(`insert into public.itinerary_items (trip_id, day, title) values ($1, current_date, 'Tram 28')`, [trip]));
    await as(db, maya, (q) => q(`insert into public.trip_places (trip_id, kind, name, lat, lng) values ($1, 'stay', 'Our flat', 38.71, -9.14)`, [trip]));
    const mine = await as(db, sam, (q) => q('select trip_id, stats from public.my_trip_overview()'));
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0].stats).toMatchObject({ members: 3, stops: 1, places: 1, stay_pinned: true, bills: 0, spent_base_minor: 0 });
    const theirs = await as(db, stranger, (q) => q('select trip_id from public.my_trip_overview()'));
    expect(theirs.rows.map((r) => r.trip_id)).not.toContain(trip);
    await expect(as(db, null, (q) => q('select * from public.my_trip_overview()'))).rejects.toThrow(/permission denied/);
  });
});
