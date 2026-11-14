/**
 * Destination photos (migration 20261204000000_place_photos): only the
 * organizer sets them, only Wikimedia addresses, always with a credit.
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let ana: string, ben: string, trip: string;
const photo = {
  url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Lisbon.jpg/1600px-Lisbon.jpg',
  page: 'https://commons.wikimedia.org/wiki/File:Lisbon.jpg',
  credit: 'Jane Doe · CC BY-SA 4.0',
};
const setPhoto = (who: string, p: Partial<typeof photo> = {}) => {
  const v = { ...photo, ...p };
  return as(db, who, (q) =>
    q(
      `update public.trips set place_photo_url = $2, place_photo_page = $3, place_photo_credit = $4, place_photo_for = 'Lisbon, Portugal' where id = $1`,
      [trip, v.url, v.page, v.credit],
    ),
  );
};

beforeAll(async () => {
  db = await startDb('tripley_place_photos');
  ana = await createUser(db, 'Ana');
  ben = await createUser(db, 'Ben');
  trip = await createTrip(db, ana, [ben], 'Lisbon');
});

afterAll(async () => {
  await db?.end();
});

describe('destination photos', () => {
  it('the organizer saves one; members see it but can’t change it', async () => {
    expect((await setPhoto(ana)).rowCount).toBe(1);
    expect((await setPhoto(ben, { credit: 'Someone else · CC0' })).rowCount).toBe(0);
    const seen = await as(db, ben, (q) => q('select place_photo_url, place_photo_credit, place_photo_off from public.trips where id = $1', [trip]));
    expect(seen.rows[0]).toEqual({ place_photo_url: photo.url, place_photo_credit: photo.credit, place_photo_off: false });
  });

  it('only Wikimedia addresses', async () => {
    await expect(setPhoto(ana, { url: 'https://evil.example/pixel.gif' })).rejects.toThrow(/check constraint/);
    await expect(setPhoto(ana, { url: 'http://upload.wikimedia.org/x.jpg' })).rejects.toThrow(/check constraint/);
    await expect(setPhoto(ana, { page: 'https://evil.example/File:Lisbon.jpg' })).rejects.toThrow(/check constraint/);
    await expect(setPhoto(ana, { url: `${photo.url} onerror=x` })).rejects.toThrow(/check constraint/);
  });

  it('a photo always comes with its page and credit', async () => {
    await expect(
      as(db, ana, (q) => q(`update public.trips set place_photo_credit = null where id = $1`, [trip])),
    ).rejects.toThrow(/trips_place_photo_complete/);
    await as(db, ana, (q) => q(`update public.trips set place_photo_url = null, place_photo_page = null, place_photo_credit = null where id = $1`, [trip]));
  });

  it('only the organizer switches it off', async () => {
    expect((await as(db, ben, (q) => q(`update public.trips set place_photo_off = true where id = $1`, [trip]))).rowCount).toBe(0);
    expect((await as(db, ana, (q) => q(`update public.trips set place_photo_off = true where id = $1`, [trip]))).rowCount).toBe(1);
  });
});
