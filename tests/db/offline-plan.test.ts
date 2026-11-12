/**
 * Plan stops saved offline (migration 20261124000000_offline_plan_stops):
 * sending the same stop twice adds it once.
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let ana: string, stranger: string, trip: string;

beforeAll(async () => {
  db = await startDb('tripley_offline_plan');
  ana = await createUser(db, 'Ana');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, ana, [], 'Lisbon');
});

afterAll(async () => {
  await db?.end();
});

describe('plan stops saved offline', () => {
  it('a retry with the same client id adds nothing', async () => {
    const send = () =>
      as(db, ana, (q) =>
        q(
          `insert into public.itinerary_items (trip_id, day, title, client_id) values ($1, current_date + 3, 'Tram 28', 'c0ffee00-0000-4000-8000-000000000001')
           on conflict (client_id) do nothing`,
          [trip],
        ),
      );
    await send();
    await send();
    expect((await db.query(`select count(*)::int as n from public.itinerary_items where trip_id = $1 and title = 'Tram 28'`, [trip])).rows[0].n).toBe(1);
  });

  it('the client id doesn’t let anyone into someone else’s trip', async () => {
    await expect(
      as(db, stranger, (q) => q(`insert into public.itinerary_items (trip_id, day, title, client_id) values ($1, current_date, 'x', gen_random_uuid())`, [trip])),
    ).rejects.toThrow(/row-level security/);
  });
});
