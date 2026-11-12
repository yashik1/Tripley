/**
 * Bookings and documents (migration 20261122000000_bookings_and_documents).
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, begin, connect, createTrip, createUser, sleep, startDb } from './helpers';

let db: Client;
let ana: string, ben: string, cleo: string, stranger: string;
let trip: string;

const upload = (owner: string, path: string, mime = 'application/pdf', size = 2048) =>
  db.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('trip-docs', $1, $2, $3)`, [
    path,
    owner,
    JSON.stringify({ mimetype: mime, size }),
  ]);
const canRead = async (who: string, path: string) =>
  (await as(db, who, (q) => q(`select 1 from storage.objects where bucket_id = 'trip-docs' and name = $1`, [path]))).rowCount === 1;

beforeAll(async () => {
  db = await startDb('tripley_bookings');
  ana = await createUser(db, 'Ana');
  ben = await createUser(db, 'Ben');
  cleo = await createUser(db, 'Cleo');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, ana, [ben, cleo], 'Lisbon');
});

afterAll(async () => {
  await db?.end();
});

describe('bookings', () => {
  let flight: string;
  let mine: string;

  it('members add bookings; travellers are only people on the trip; strangers see nothing', async () => {
    flight = (
      await as(db, ben, (q) =>
        q(
          `insert into public.trip_bookings (trip_id, kind, title, reference, start_day, start_time, from_place, to_place, traveller_ids)
           values ($1, 'flight', ' TP1350 Lisbon → Porto ', ' ABC123 ', '2026-12-02', '09:40', 'Lisbon LIS', 'Porto OPO', $2) returning id`,
          [trip, [ben, cleo, stranger]],
        ),
      )
    ).rows[0].id;
    const row = (await db.query('select title, reference, traveller_ids from public.trip_bookings where id = $1', [flight])).rows[0];
    expect(row.title).toBe('TP1350 Lisbon → Porto');
    expect(row.reference).toBe('ABC123');
    expect([...row.traveller_ids].sort()).toEqual([ben, cleo].sort());
    expect((await as(db, cleo, (q) => q('select id from public.trip_bookings'))).rowCount).toBe(1);
    expect((await as(db, stranger, (q) => q('select id from public.trip_bookings'))).rowCount).toBe(0);
    await expect(
      as(db, stranger, (q) => q(`insert into public.trip_bookings (trip_id, title) values ($1, 'Sneaky')`, [trip])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(db, ben, (q) => q(`insert into public.trip_bookings (trip_id, title, start_day, end_day) values ($1, 'Bad', '2026-12-05', '2026-12-01')`, [trip])),
    ).rejects.toThrow(/end_after_start/);
  });

  it('a private booking is only for whoever added it, even the organizer can’t touch it', async () => {
    mine = (
      await as(db, cleo, (q) => q(`insert into public.trip_bookings (trip_id, kind, title, reference, private) values ($1, 'flight', 'My flight home', 'ZZ9', true) returning id`, [trip]))
    ).rows[0].id;
    expect((await as(db, ana, (q) => q('select id from public.trip_bookings where id = $1', [mine]))).rowCount).toBe(0);
    expect((await as(db, ana, (q) => q(`update public.trip_bookings set title = 'x' where id = $1`, [mine]))).rowCount).toBe(0);
    expect((await as(db, ana, (q) => q('delete from public.trip_bookings where id = $1', [mine]))).rowCount).toBe(0);
    // The organizer edits shared ones; other members can't.
    expect((await as(db, ana, (q) => q(`update public.trip_bookings set notes = 'Gate B' where id = $1`, [flight]))).rowCount).toBe(1);
    expect((await as(db, cleo, (q) => q(`update public.trip_bookings set notes = 'nope' where id = $1`, [flight]))).rowCount).toBe(0);
    await expect(as(db, ben, (q) => q(`update public.trip_bookings set created_by = $2 where id = $1`, [flight, cleo]))).rejects.toThrow(/permission denied/);
  });

  it('goes into the plan once, even if two people press at once; private ones stay out', async () => {
    const c1 = await connect();
    const c2 = await connect();
    let a: { rows: { id: string }[] }, b: { rows: { id: string }[] };
    try {
      await begin(c1, ana);
      await begin(c2, ben);
      a = await c1.query('select public.add_booking_to_plan($1) as id', [flight]);
      const second = c2.query('select public.add_booking_to_plan($1) as id', [flight]);
      await sleep(200);
      await c1.query('commit');
      b = await second;
      await c2.query('commit');
    } finally {
      await c1.end();
      await c2.end();
    }
    expect(a.rows[0].id).toBe(b.rows[0].id);
    const stop = (await db.query('select title, day::text, starts_at::text, place_name from public.itinerary_items where id = $1', [a.rows[0].id])).rows[0];
    expect(stop).toEqual({ title: 'TP1350 Lisbon → Porto', day: '2026-12-02', starts_at: '09:40:00', place_name: 'Lisbon LIS' });
    expect((await db.query('select itinerary_item_id from public.trip_bookings where id = $1', [flight])).rows[0].itinerary_item_id).toBe(a.rows[0].id);
    await expect(as(db, cleo, (q) => q('select public.add_booking_to_plan($1)', [mine]))).rejects.toThrow(/Private bookings/);
    await expect(as(db, ana, (q) => q('select public.add_booking_to_plan($1)', [mine]))).rejects.toThrow(/not found/);
  });
});

describe('documents', () => {
  let ticketPath: string, passportPath: string;

  it('a document is a file you uploaded into the trip; its type and size come from the file', async () => {
    ticketPath = `${trip}/ticket1.pdf`;
    await expect(
      as(db, ben, (q) => q(`insert into public.trip_documents (trip_id, name, path, mime, size_bytes) values ($1, 'Ticket', $2, 'application/pdf', 1)`, [trip, ticketPath])),
    ).rejects.toThrow(/Upload the file/);
    await upload(ben, ticketPath, 'application/pdf', 4321);
    await expect(
      as(db, cleo, (q) => q(`insert into public.trip_documents (trip_id, name, path, mime, size_bytes) values ($1, 'Ticket', $2, 'application/pdf', 1)`, [trip, ticketPath])),
    ).rejects.toThrow(/Upload the file/); // not Cleo's upload
    await as(db, ben, (q) => q(`insert into public.trip_documents (trip_id, name, path, mime, size_bytes) values ($1, ' Ticket ', $2, 'image/png', 1)`, [trip, ticketPath]));
    const doc = (await db.query('select name, mime, size_bytes from public.trip_documents where path = $1', [ticketPath])).rows[0];
    expect(doc).toEqual({ name: 'Ticket', mime: 'application/pdf', size_bytes: 4321 });
  });

  it('files are readable by the trip while the document allows it; private ones only by their owner', async () => {
    expect(await canRead(cleo, ticketPath)).toBe(true);
    expect(await canRead(stranger, ticketPath)).toBe(false);
    passportPath = `${trip}/passport.jpg`;
    await upload(cleo, passportPath, 'image/jpeg', 900);
    expect(await canRead(ben, passportPath)).toBe(false); // uploaded, no document yet
    await as(db, cleo, (q) => q(`insert into public.trip_documents (trip_id, name, path, mime, size_bytes, private) values ($1, 'Passport', $2, 'image/jpeg', 1, true)`, [trip, passportPath]));
    expect(await canRead(cleo, passportPath)).toBe(true);
    expect(await canRead(ben, passportPath)).toBe(false);
    expect(await canRead(ana, passportPath)).toBe(false);
    expect((await as(db, ana, (q) => q('select id from public.trip_documents where path = $1', [passportPath]))).rowCount).toBe(0);
    await expect(
      as(db, ben, (q) => q(`insert into storage.objects (bucket_id, name, owner) values ('trip-docs', $1, $2)`, [`${trip}/../x.pdf`, ben])),
    ).rejects.toThrow(/row-level security/);
  });

  it('making a booking private hides its documents; other people’s are unlinked instead', async () => {
    const booking = (await as(db, ben, (q) => q(`insert into public.trip_bookings (trip_id, title) values ($1, 'Hostel') returning id`, [trip]))).rows[0].id;
    await as(db, ben, (q) => q('update public.trip_documents set booking_id = $2 where path = $1', [ticketPath, booking]));
    const cleoFile = `${trip}/hostel-map.png`;
    await upload(cleo, cleoFile, 'image/png', 100);
    await as(db, cleo, (q) => q(`insert into public.trip_documents (trip_id, booking_id, name, path, mime, size_bytes) values ($1, $2, 'Map', $3, 'image/png', 1)`, [trip, booking, cleoFile]));
    await as(db, ben, (q) => q('update public.trip_bookings set private = true where id = $1', [booking]));
    const docs = (await db.query('select path, private, booking_id from public.trip_documents where path = any($1) order by path', [[ticketPath, cleoFile]])).rows;
    expect(docs).toEqual([
      { path: cleoFile, private: false, booking_id: null },
      { path: ticketPath, private: true, booking_id: booking },
    ]);
    expect(await canRead(cleo, ticketPath)).toBe(false);
    await expect(
      as(db, cleo, (q) => q('update public.trip_documents set booking_id = $2 where path = $1', [cleoFile, booking])),
    ).rejects.toThrow(/isn't on this trip/);
  });

  it('leaving the trip takes your private bookings and documents', async () => {
    await as(db, cleo, (q) => q('delete from public.trip_members where trip_id = $1 and user_id = $2', [trip, cleo]));
    expect((await db.query('select 1 from public.trip_documents where uploaded_by = $1 and private', [cleo])).rowCount).toBe(0);
    expect((await db.query('select 1 from public.trip_bookings where created_by = $1 and private', [cleo])).rowCount).toBe(0);
    expect((await db.query('select 1 from public.trip_documents where uploaded_by = $1', [cleo])).rowCount).toBe(1); // the shared map stays
  });

  it('deleting your account lists your files and removes your documents', async () => {
    const files = (await as(db, ben, (q) => q('select public.account_deletion_preview() as p'))).rows[0].p.files as { bucket: string; path: string }[];
    expect(files).toContainEqual({ bucket: 'trip-docs', path: ticketPath });
    await db.query('update public.profiles set deleted_at = now() where id = $1', [ben]);
    expect((await db.query('select 1 from public.trip_documents where uploaded_by = $1', [ben])).rowCount).toBe(0);
  });
});

describe('AI reading quota', () => {
  it('accepts a PDF or a plan draft as what a reservation is for, nothing else', async () => {
    const pro = await createUser(db, 'Pro');
    const code = (await db.query('select invite_code from public.trips where id = $1', [trip])).rows[0].invite_code;
    await as(db, pro, (q) => q('select public.join_trip_by_code($1)', [code]));
    await db.query(`update public.accounts set plan = 'pro', plan_expires_at = now() + interval '30 days' where user_id = $1`, [pro]);
    const reserve = (request: string, path: string) =>
      as(db, 'service_role', (q) => q('select public.reserve_ai_scan($1, $2, $3, $4, 10, 100) as r', [pro, request, trip, path])).then((r) => r.rows[0].r.status);
    expect(await reserve('00000000-0000-4000-8000-000000000101', `${trip}/booking.pdf`)).toBe('reserved');
    const planReq = '00000000-0000-4000-8000-000000000102';
    expect(await reserve(planReq, `${trip}/ai-plan-${planReq}`)).toBe('reserved');
    expect(await reserve('00000000-0000-4000-8000-000000000103', `${trip}/notes.txt`)).toBe('bad_request');
    expect(await reserve('00000000-0000-4000-8000-000000000104', `${trip}/ai-plan-nope`)).toBe('bad_request');
  });
});
