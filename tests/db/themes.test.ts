/**
 * Themes (migration 20261203000000_themes): your appearance and colour on
 * your profile, and a trip's theme (organizer only; templates keep it).
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let ana: string, ben: string, stranger: string, trip: string;

beforeAll(async () => {
  db = await startDb('tripley_themes');
  ana = await createUser(db, 'Ana');
  ben = await createUser(db, 'Ben');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, ana, [ben], 'Ski week');
});

afterAll(async () => {
  await db?.end();
});

describe('your appearance', () => {
  it('starts as System and Teal', async () => {
    const r = await db.query('select appearance, palette from public.profiles where id = $1', [ana]);
    expect(r.rows[0]).toEqual({ appearance: 'system', palette: 'teal' });
  });

  it('you change your own; nobody else can', async () => {
    await as(db, ana, (q) => q(`update public.profiles set appearance = 'dark', palette = 'ocean' where id = $1`, [ana]));
    const byBen = await as(db, ben, (q) => q(`update public.profiles set palette = 'berry' where id = $1`, [ana]));
    expect(byBen.rowCount).toBe(0);
    const r = await db.query('select appearance, palette from public.profiles where id = $1', [ana]);
    expect(r.rows[0]).toEqual({ appearance: 'dark', palette: 'ocean' });
  });

  it('only known values', async () => {
    await expect(as(db, ana, (q) => q(`update public.profiles set appearance = 'neon' where id = $1`, [ana]))).rejects.toThrow(/check constraint/);
    await expect(as(db, ana, (q) => q(`update public.profiles set palette = 'rainbow' where id = $1`, [ana]))).rejects.toThrow(/check constraint/);
  });
});

describe('trip themes', () => {
  it('the organizer sets the theme; members and strangers can’t', async () => {
    await as(db, ana, (q) => q(`update public.trips set theme = 'ski' where id = $1`, [trip]));
    expect((await as(db, ben, (q) => q(`update public.trips set theme = 'beach' where id = $1`, [trip]))).rowCount).toBe(0);
    expect((await as(db, stranger, (q) => q(`update public.trips set theme = 'beach' where id = $1`, [trip]))).rowCount).toBe(0);
    expect((await as(db, ben, (q) => q('select theme from public.trips where id = $1', [trip]))).rows[0].theme).toBe('ski');
  });

  it('only known themes; no theme is fine', async () => {
    await expect(as(db, ana, (q) => q(`update public.trips set theme = 'space' where id = $1`, [trip]))).rejects.toThrow(/check constraint/);
    const created = await as(db, ben, (q) =>
      q(`insert into public.trips (name, base_currency, organizer_id, theme) values ('Beach days', 'EUR', $1, 'beach') returning theme`, [ben]),
    );
    expect(created.rows[0].theme).toBe('beach');
    const plain = await as(db, ben, (q) => q(`insert into public.trips (name, base_currency, organizer_id) values ('No theme', 'EUR', $1) returning theme`, [ben]));
    expect(plain.rows[0].theme).toBeNull();
  });

  it('a template keeps its trip’s theme', async () => {
    const template = (await as(db, ana, (q) => q(`select public.save_trip_as_template($1, 'Our ski week') as id`, [trip]))).rows[0].id;
    const next = (await as(db, ana, (q) => q(`select public.start_trip_from_template($1, 'Ski week again', current_date + 30) as id`, [template]))).rows[0].id;
    expect((await db.query('select theme from public.trips where id = $1', [next])).rows[0].theme).toBe('ski');
  });
});
