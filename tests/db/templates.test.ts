/**
 * Trip templates (migration 20261126000000_trip_templates).
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let ana: string, ben: string, stranger: string, trip: string;
let template: string;

beforeAll(async () => {
  db = await startDb('tripley_templates');
  ana = await createUser(db, 'Ana');
  ben = await createUser(db, 'Ben');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, ana, [ben], 'Ski week');
  await db.query(`update public.trips set starts_on = '2027-02-07', ends_on = '2027-02-13', destination = 'Val Thorens' where id = $1`, [trip]);
  await as(db, ana, (q) => q(`insert into public.itinerary_items (trip_id, day, title, starts_at) values ($1, '2027-02-07', 'Collect ski passes', '16:00'), ($1, '2027-02-09', 'Fondue night', '19:30')`, [trip]));
  await as(db, ben, (q) => q(`insert into public.trip_suggestions (trip_id, name, category) values ($1, 'Night sledging', 'experience')`, [trip]));
  await as(db, ana, (q) => q(`insert into public.trip_tasks (trip_id, kind, title) values ($1, 'group', 'Book the chalet'), ($1, 'packing', 'Goggles')`, [trip]));
  await as(db, ben, (q) => q(`insert into public.trip_tasks (trip_id, kind, title) values ($1, 'packing', 'Bens secret snacks')`, [trip]));
  await as(db, ben, (q) => q(`insert into public.bills (trip_id, paid_by, title, currency, fx_rate, split_mode, subtotal_minor, total_minor, total_base_minor) values ($1, $2, 'Lift', 'EUR', 1, 'equal', 100, 100, 100)`, [trip, ben]).catch(() => null));
});

afterAll(async () => {
  await db?.end();
});

describe('trip templates', () => {
  it('saves the plan as days from the start, the ideas, group tasks and only your own packing list', async () => {
    template = (await as(db, ana, (q) => q(`select public.save_trip_as_template($1, 'Our ski week') as id`, [trip]))).rows[0].id;
    const t = (await db.query('select name, destination, days, data from public.trip_templates where id = $1', [template])).rows[0];
    expect(t.name).toBe('Our ski week');
    expect(t.days).toBe(7);
    expect(t.data.stops.map((s: { offset: number; title: string }) => [s.offset, s.title])).toEqual([
      [0, 'Collect ski passes'],
      [2, 'Fondue night'],
    ]);
    expect(t.data.ideas.map((i: { name: string }) => i.name)).toEqual(['Night sledging']);
    expect(t.data.tasks).toEqual(['Book the chalet']);
    expect(t.data.packing).toEqual(['Goggles']);
    expect(JSON.stringify(t.data)).not.toMatch(/Lift|snacks|paid_by|user_id/);
  });

  it('is private to whoever saved it; strangers can’t save someone else’s trip', async () => {
    expect((await as(db, ben, (q) => q('select id from public.trip_templates'))).rowCount).toBe(0);
    await expect(as(db, stranger, (q) => q(`select public.save_trip_as_template($1, 'Mine now')`, [trip]))).rejects.toThrow(/not found/);
    await expect(as(db, ben, (q) => q(`select public.start_trip_from_template($1, 'x', current_date + 30)`, [template]))).rejects.toThrow(/not found/);
    await expect(as(db, ana, (q) => q(`insert into public.trip_templates (name, base_currency, days, data) values ('x', 'EUR', 1, '{}')`))).rejects.toThrow(/permission denied/);
  });

  it('starts a new trip at the dates you pick, everything shifted to match, you organizing it', async () => {
    const next = (await as(db, ana, (q) => q(`select public.start_trip_from_template($1, 'Ski week 2028', '2028-02-05') as id`, [template]))).rows[0].id;
    const t = (await db.query('select name, starts_on::text, ends_on::text, organizer_id, destination from public.trips where id = $1', [next])).rows[0];
    expect(t).toEqual({ name: 'Ski week 2028', starts_on: '2028-02-05', ends_on: '2028-02-11', organizer_id: ana, destination: 'Val Thorens' });
    const stops = (await db.query('select day::text, title, starts_at::text from public.itinerary_items where trip_id = $1 order by day', [next])).rows;
    expect(stops).toEqual([
      { day: '2028-02-05', title: 'Collect ski passes', starts_at: '16:00:00' },
      { day: '2028-02-07', title: 'Fondue night', starts_at: '19:30:00' },
    ]);
    expect((await db.query(`select count(*)::int as n from public.trip_members where trip_id = $1`, [next])).rows[0].n).toBe(1);
    const tasks = (await db.query('select kind, title, created_by from public.trip_tasks where trip_id = $1 order by kind', [next])).rows;
    expect(tasks).toEqual([
      { kind: 'group', title: 'Book the chalet', created_by: ana },
      { kind: 'packing', title: 'Goggles', created_by: ana },
    ]);
    await expect(as(db, ana, (q) => q(`select public.start_trip_from_template($1, 'Past', '2020-01-01')`, [template]))).rejects.toThrow(/from today on/);
  });
});
