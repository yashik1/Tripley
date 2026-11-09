/**
 * Shared itinerary (migration 20261111000000_itinerary): who can read and
 * change stops, server-side validation, ordering, RSVPs and comments.
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let maya: string, sam: string, lee: string, stranger: string;
let trip: string;

const add = (who: string, fields: Record<string, unknown>) =>
  as(db, who, (q) => {
    const cols = Object.keys(fields);
    return q(
      `insert into public.itinerary_items (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
      Object.values(fields),
    );
  }).then((r) => r.rows[0]);
const dayList = async (day: string) =>
  (
    await as(db, maya, (q) =>
      q('select title from public.itinerary_items where trip_id = $1 and day = $2 order by position, created_at', [trip, day]),
    )
  ).rows.map((r) => r.title as string);

beforeAll(async () => {
  db = await startDb('tripley_itinerary');
  maya = await createUser(db, 'Maya');
  sam = await createUser(db, 'Sam');
  lee = await createUser(db, 'Lee');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, maya, [sam, lee], 'Lisbon');
  await db.query(`update public.trips set starts_on = '2026-12-01', ends_on = '2026-12-05' where id = $1`, [trip]);
});

afterAll(async () => {
  await db?.end();
});

describe('stops', () => {
  it('any member adds a stop; the server records who added it', async () => {
    const s = await add(sam, { trip_id: trip, day: '2026-12-02', title: '  Tram 28 ', starts_at: '10:00', ends_at: '11:30', place_name: 'Martim Moniz', lat: 38.7167, lng: -9.1359 });
    expect(s.title).toBe('Tram 28');
    expect(s.created_by).toBe(sam);
    expect(s.updated_by).toBeNull();
  });

  it('can’t pretend someone else added it', async () => {
    await expect(add(sam, { trip_id: trip, day: '2026-12-02', title: 'x', created_by: maya })).rejects.toThrow(/permission denied/);
  });

  it('only members see the plan; strangers can’t add to it', async () => {
    expect((await as(db, stranger, (q) => q('select * from public.itinerary_items'))).rows).toEqual([]);
    await expect(add(stranger, { trip_id: trip, day: '2026-12-02', title: 'Crash the party' })).rejects.toThrow(/row-level security/);
    await expect(as(db, null, (q) => q('select * from public.itinerary_items'))).rejects.toThrow(/permission denied/);
  });

  it('validates fields on the server', async () => {
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ title: ' ' }, /check constraint/],
      [{ title: 'x'.repeat(121) }, /check constraint/],
      [{ title: 'Late', starts_at: '12:00', ends_at: '11:00' }, /itinerary_end_after_start/],
      [{ title: 'No start', ends_at: '11:00' }, /itinerary_end_after_start/],
      [{ title: 'Half a point', lat: 38.7 }, /itinerary_point_complete/],
      [{ title: 'Off the globe', lat: 95, lng: 0 }, /check constraint/],
      [{ title: 'Long notes', notes: 'x'.repeat(1001) }, /check constraint/],
    ];
    for (const [fields, err] of bad) {
      await expect(add(lee, { trip_id: trip, day: '2026-12-02', ...fields })).rejects.toThrow(err);
    }
    await expect(add(lee, { trip_id: trip, day: '2026-12-09', title: 'After the trip' })).rejects.toThrow(/within the trip/);
  });

  it('new stops slot in by start time; untimed ones go at the end', async () => {
    await add(maya, { trip_id: trip, day: '2026-12-02', title: 'Dinner', starts_at: '20:00' });
    await add(lee, { trip_id: trip, day: '2026-12-02', title: 'Breakfast', starts_at: '08:30' });
    await add(lee, { trip_id: trip, day: '2026-12-02', title: 'Buy souvenirs' });
    await add(sam, { trip_id: trip, day: '2026-12-02', title: 'Lunch', starts_at: '13:00' });
    expect(await dayList('2026-12-02')).toEqual(['Breakfast', 'Tram 28', 'Lunch', 'Dinner', 'Buy souvenirs']);
  });

  it('the person who added it, or the organizer, edits and moves it; others can’t', async () => {
    const lunch = (await db.query(`select id from public.itinerary_items where title = 'Lunch'`)).rows[0].id;
    const upd = await as(db, lee, (q) => q(`update public.itinerary_items set title = 'Mine now' where id = $1`, [lunch]));
    expect(upd.rowCount).toBe(0);
    await expect(as(db, lee, (q) => q('select public.move_itinerary_item($1, true)', [lunch]))).rejects.toThrow(/Only the person who added/);

    await as(db, sam, (q) => q(`update public.itinerary_items set title = 'Lunch at Time Out Market' where id = $1`, [lunch]));
    const edited = await as(db, maya, (q) => q(`update public.itinerary_items set notes = 'Book ahead' where id = $1 returning updated_by`, [lunch]));
    expect(edited.rows[0].updated_by).toBe(maya); // organizer, and the last editor is recorded

    await as(db, sam, (q) => q('select public.move_itinerary_item($1, true)', [lunch]));
    expect(await dayList('2026-12-02')).toEqual(['Breakfast', 'Lunch at Time Out Market', 'Tram 28', 'Dinner', 'Buy souvenirs']);
    await as(db, sam, (q) => q('select public.move_itinerary_item($1, false)', [lunch]));
    await as(db, sam, (q) => q('select public.move_itinerary_item($1, false)', [lunch]));
    expect(await dayList('2026-12-02')).toEqual(['Breakfast', 'Tram 28', 'Dinner', 'Lunch at Time Out Market', 'Buy souvenirs']);
    await expect(as(db, stranger, (q) => q('select public.move_itinerary_item($1, true)', [lunch]))).rejects.toThrow(/not found/);
  });

  it('moving a stop to another day puts it in time order there', async () => {
    const dinner = (await db.query(`select id from public.itinerary_items where title = 'Dinner'`)).rows[0].id;
    await add(maya, { trip_id: trip, day: '2026-12-03', title: 'Late show', starts_at: '22:00' });
    await as(db, maya, (q) => q(`update public.itinerary_items set day = '2026-12-03' where id = $1`, [dinner]));
    expect(await dayList('2026-12-03')).toEqual(['Dinner', 'Late show']);
  });

  it('a stop can’t be moved to another trip, and removal is limited', async () => {
    const other = await createTrip(db, sam, [], 'Other');
    const tram = (await db.query(`select id from public.itinerary_items where title = 'Tram 28'`)).rows[0].id;
    await expect(as(db, sam, (q) => q('update public.itinerary_items set trip_id = $1 where id = $2', [other, tram]))).rejects.toThrow(/permission denied/);
    const del = await as(db, lee, (q) => q('delete from public.itinerary_items where id = $1', [tram]));
    expect(del.rowCount).toBe(0);
  });
});

describe('RSVPs', () => {
  let tram: string;
  beforeAll(async () => {
    tram = (await db.query(`select id from public.itinerary_items where title = 'Tram 28'`)).rows[0].id;
  });

  it('each member answers for themselves, and can change or clear it', async () => {
    await as(db, lee, (q) => q(`select public.set_itinerary_rsvp($1, 'going')`, [tram]));
    await as(db, sam, (q) => q(`select public.set_itinerary_rsvp($1, 'maybe')`, [tram]));
    await as(db, sam, (q) => q(`select public.set_itinerary_rsvp($1, 'not_going')`, [tram]));
    await as(db, maya, (q) => q(`select public.set_itinerary_rsvp($1, 'going')`, [tram]));
    await as(db, maya, (q) => q(`select public.set_itinerary_rsvp($1, null)`, [tram]));
    const r = await as(db, lee, (q) => q('select user_id, status from public.itinerary_rsvps where item_id = $1 order by status', [tram]));
    expect(r.rows).toEqual([
      { user_id: lee, status: 'going' },
      { user_id: sam, status: 'not_going' },
    ]);
  });

  it('can’t answer for someone else or write answers directly', async () => {
    await expect(
      as(db, lee, (q) => q(`insert into public.itinerary_rsvps (item_id, trip_id, user_id, status) values ($1, $2, $3, 'going')`, [tram, trip, maya])),
    ).rejects.toThrow(/permission denied/);
    await expect(as(db, lee, (q) => q(`select public.set_itinerary_rsvp($1, 'definitely')`, [tram]))).rejects.toThrow(/going, maybe or not going/);
  });

  it('strangers can’t answer or see answers', async () => {
    await expect(as(db, stranger, (q) => q(`select public.set_itinerary_rsvp($1, 'going')`, [tram]))).rejects.toThrow(/not found/);
    expect((await as(db, stranger, (q) => q('select * from public.itinerary_rsvps'))).rows).toEqual([]);
  });

  it('leaving the trip removes your answers', async () => {
    await as(db, lee, (q) => q('delete from public.trip_members where trip_id = $1 and user_id = $2', [trip, lee]));
    const r = await db.query('select count(*)::int as n from public.itinerary_rsvps where user_id = $1', [lee]);
    expect(r.rows[0].n).toBe(0);
    expect((await as(db, lee, (q) => q('select * from public.itinerary_items where trip_id = $1', [trip]))).rows).toEqual([]);
    const code = (await db.query('select invite_code from public.trips where id = $1', [trip])).rows[0].invite_code;
    await as(db, lee, (q) => q('select public.join_trip_by_code($1)', [code]));
  });
});

describe('comments', () => {
  let tram: string;
  beforeAll(async () => {
    tram = (await db.query(`select id from public.itinerary_items where title = 'Tram 28'`)).rows[0].id;
  });

  it('members comment; whoever added the stop is told', async () => {
    await as(db, lee, (q) => q('insert into public.itinerary_comments (item_id, trip_id, body) values ($1, $2, $3)', [tram, trip, 'Get there early, it fills up']));
    const n = await as(db, sam, (q) => q(`select body, data from public.notifications where kind = 'itinerary_comment'`));
    expect(n.rows[0].body).toBe('Lee on "Tram 28": Get there early, it fills up');
    expect(n.rows[0].data.item_id).toBe(tram);
    // Your own comment on your own stop doesn't notify you.
    await as(db, sam, (q) => q('insert into public.itinerary_comments (item_id, trip_id, body) values ($1, $2, $3)', [tram, trip, 'Good tip']));
    const again = await as(db, sam, (q) => q(`select count(*)::int as n from public.notifications where kind = 'itinerary_comment'`));
    expect(again.rows[0].n).toBe(1);
  });

  it('can’t comment as someone else, on another trip’s stop, or as a stranger', async () => {
    await expect(
      as(db, lee, (q) => q('insert into public.itinerary_comments (item_id, trip_id, user_id, body) values ($1, $2, $3, $4)', [tram, trip, maya, 'hi'])),
    ).rejects.toThrow(/permission denied/);
    const other = await createTrip(db, lee, [], 'Lee solo');
    await expect(
      as(db, lee, (q) => q('insert into public.itinerary_comments (item_id, trip_id, body) values ($1, $2, $3)', [tram, other, 'sneaky'])),
    ).rejects.toThrow(/not found/);
    await expect(
      as(db, stranger, (q) => q('insert into public.itinerary_comments (item_id, trip_id, body) values ($1, $2, $3)', [tram, trip, 'hi'])),
    ).rejects.toThrow(/row-level security/);
    expect((await as(db, stranger, (q) => q('select * from public.itinerary_comments'))).rows).toEqual([]);
  });

  it('authors or the organizer remove comments', async () => {
    const del = await as(db, lee, (q) => q(`delete from public.itinerary_comments where body = 'Good tip'`));
    expect(del.rowCount).toBe(0);
    const mine = await as(db, maya, (q) => q(`delete from public.itinerary_comments where body = 'Good tip'`));
    expect(mine.rowCount).toBe(1);
  });
});

describe('when the trip has ended', () => {
  it('the plan is read-only', async () => {
    await as(db, maya, (q) => q('update public.trips set ended_at = now() where id = $1', [trip]));
    await expect(add(maya, { trip_id: trip, day: '2026-12-04', title: 'Too late' })).rejects.toThrow(/row-level security/);
    const tram = (await db.query(`select id from public.itinerary_items where title = 'Tram 28'`)).rows[0].id;
    await expect(as(db, lee, (q) => q(`select public.set_itinerary_rsvp($1, 'maybe')`, [tram]))).rejects.toThrow(/ended/);
    await expect(as(db, sam, (q) => q(`update public.itinerary_items set title = 'x' where id = $1`, [tram]))).rejects.toThrow(/row-level security/);
    expect((await as(db, lee, (q) => q('select count(*)::int as n from public.itinerary_items where trip_id = $1', [trip]))).rows[0].n).toBe(6);
  });
});
