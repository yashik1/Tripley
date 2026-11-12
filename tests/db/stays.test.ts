/**
 * Where everyone sleeps (migration 20261121000000_stays_and_rooms).
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, begin, connect, createTrip, createUser, sleep, startDb } from './helpers';

let db: Client;
let ana: string, ben: string, cleo: string, dan: string, stranger: string;
let trip: string;
let stay: string;
let big: string, small: string;

const guests = async (s = stay) =>
  (await db.query('select room_id, user_id from public.trip_room_guests where stay_id = $1 order by user_id', [s])).rows;

beforeAll(async () => {
  db = await startDb('tripley_stays');
  ana = await createUser(db, 'Ana');
  ben = await createUser(db, 'Ben');
  cleo = await createUser(db, 'Cleo');
  dan = await createUser(db, 'Dan');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, ana, [ben, cleo, dan], 'Lisbon');
});

afterAll(async () => {
  await db?.end();
});

describe('stays and rooms', () => {
  it('any member adds a stay; its rooms belong to the same trip', async () => {
    stay = (
      await as(db, ben, (q) =>
        q(`insert into public.trip_stays (trip_id, name, check_in, check_out) values ($1, ' Alfama flat ', '2026-12-01', '2026-12-04') returning id, name`, [trip]),
      )
    ).rows[0].id;
    big = (await as(db, ben, (q) => q(`insert into public.trip_rooms (stay_id, name, beds, size_weight) values ($1, 'Big room', 2, 1.5) returning id, trip_id`, [stay]))).rows[0].id;
    small = (await as(db, ben, (q) => q(`insert into public.trip_rooms (stay_id, name, beds) values ($1, 'Small room', 1) returning id`, [stay]))).rows[0].id;
    const row = (await db.query('select name, trip_id from public.trip_stays where id = $1', [stay])).rows[0];
    expect(row).toEqual({ name: 'Alfama flat', trip_id: trip });
    expect((await db.query('select trip_id from public.trip_rooms where id = $1', [big])).rows[0].trip_id).toBe(trip);
  });

  it('only whoever added it or the organizer changes the rooms; strangers see nothing', async () => {
    await expect(as(db, cleo, (q) => q(`insert into public.trip_rooms (stay_id, name) values ($1, 'Sofa')`, [stay]))).rejects.toThrow(/row-level security/);
    const upd = await as(db, cleo, (q) => q(`update public.trip_rooms set beds = 9 where id = $1`, [big]));
    expect(upd.rowCount).toBe(0);
    await as(db, ana, (q) => q(`update public.trip_rooms set name = 'Big room (en-suite)' where id = $1`, [big]));
    expect((await as(db, stranger, (q) => q('select id from public.trip_stays'))).rowCount).toBe(0);
    expect((await as(db, stranger, (q) => q('select id from public.trip_rooms'))).rowCount).toBe(0);
    await expect(as(db, ben, (q) => q(`update public.trip_rooms set trip_id = gen_random_uuid() where id = $1`, [big]))).rejects.toThrow(/permission denied/);
    await expect(
      as(db, ben, (q) => q(`insert into public.trip_room_guests (stay_id, room_id, trip_id, user_id) values ($1, $2, $3, $4)`, [stay, big, trip, ben])),
    ).rejects.toThrow(/permission denied/);
  });

  it('people pick their own bed; picking another room moves you', async () => {
    await as(db, ben, (q) => q('select public.pick_bed($1)', [small]));
    await as(db, ben, (q) => q('select public.pick_bed($1)', [big]));
    expect(await guests()).toEqual([{ room_id: big, user_id: ben }]);
    await as(db, ben, (q) => q('select public.pick_bed($1)', [big])); // again: no change
    expect(await guests()).toHaveLength(1);
  });

  it('a full room is refused, even when two people take the last bed at once', async () => {
    // Big room has 2 beds and Ben is in one. Cleo and Dan both press at once.
    const c1 = await connect();
    const c2 = await connect();
    try {
      await begin(c1, cleo);
      await begin(c2, dan);
      await c1.query('select public.pick_bed($1)', [big]);
      const second = c2.query('select public.pick_bed($1)', [big]); // waits for Cleo's lock
      await sleep(200);
      await c1.query('commit');
      await expect(second).rejects.toThrow(/is full/);
      await c2.query('rollback');
    } finally {
      await c1.end();
      await c2.end();
    }
    expect((await guests()).filter((g) => g.room_id === big).map((g) => g.user_id).sort()).toEqual([ben, cleo].sort());
  });

  it('a room can’t shrink below the people in it', async () => {
    await expect(as(db, ana, (q) => q('update public.trip_rooms set beds = 1 where id = $1', [big]))).rejects.toThrow(/Move someone out first/);
  });

  it('moving other people is for the organizer or whoever added the stay; they are told', async () => {
    const someoneInBig = cleo;
    await expect(as(db, someoneInBig, (q) => q('select public.pick_bed($1, $2)', [small, ben]))).rejects.toThrow(/Only the organizer/);
    await as(db, ana, (q) => q('select public.leave_bed($1, $2)', [stay, someoneInBig]));
    await as(db, ana, (q) => q('select public.pick_bed($1, $2)', [small, someoneInBig]));
    const told = await db.query(`select body from public.notifications where kind = 'room_assigned' and user_id = $1`, [someoneInBig]);
    expect(told.rows[0].body).toBe('Ana put you in Small room.');
    await expect(as(db, ana, (q) => q('select public.pick_bed($1, $2)', [small, stranger]))).rejects.toThrow(/aren't on this trip/);
  });

  it('when the organizer chooses rooms, people can’t move themselves', async () => {
    await as(db, ana, (q) => q('update public.trip_stays set self_pick = false where id = $1', [stay]));
    const anyone = (await guests()).find((g) => g.user_id !== ben)!.user_id;
    await expect(as(db, anyone, (q) => q('select public.leave_bed($1)', [stay]))).rejects.toThrow(/organizer is choosing/);
    // Ben added the stay, so he still arranges it.
    await as(db, ben, (q) => q('select public.leave_bed($1)', [stay]));
    await as(db, ben, (q) => q('select public.pick_bed($1)', [big]));
    await as(db, ana, (q) => q('update public.trip_stays set self_pick = true where id = $1', [stay]));
  });

  it('leaving the trip frees your bed; a deleted room frees its beds', async () => {
    const before = (await guests()).length;
    await as(db, dan, (q) => q('delete from public.trip_members where trip_id = $1 and user_id = $2', [trip, dan]));
    const after = await guests();
    expect(after.some((g) => g.user_id === dan)).toBe(false);
    expect(after.length).toBe((await db.query('select 1 from public.trip_room_guests where stay_id = $1', [stay])).rowCount);
    expect(after.length).toBeLessThanOrEqual(before);
    await as(db, ben, (q) => q('delete from public.trip_rooms where id = $1', [small]));
    expect((await guests()).every((g) => g.room_id === big)).toBe(true);
  });

  it('a stay links only to a bill from its own trip', async () => {
    const other = await createTrip(db, stranger, [], 'Elsewhere');
    const foreign = (
      await db.query(
        `insert into public.bills (trip_id, paid_by, title, currency, fx_rate, split_mode, subtotal_minor, total_minor, total_base_minor, created_by)
         values ($1, $2, 'Hotel', 'EUR', 1, 'equal', 100, 100, 100, $2) returning id`,
        [other, stranger],
      )
    ).rows[0].id;
    await expect(as(db, ben, (q) => q('update public.trip_stays set bill_id = $2 where id = $1', [stay, foreign]))).rejects.toThrow(/isn't on this trip/);
  });
});
