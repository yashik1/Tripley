/**
 * Getting ready (migration 20261115000000_preparation): private packing
 * lists, shared group tasks, challenges, and the progress counts.
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let maya: string, sam: string, stranger: string;
let trip: string;

const addTask = (who: string, kind: string, title: string, extra: Record<string, unknown> = {}) =>
  as(db, who, (q) => {
    const fields: Record<string, unknown> = { trip_id: trip, kind, title, ...extra };
    const cols = Object.keys(fields);
    const marks = cols.map((_, i) => '$' + (i + 1)).join(', ');
    return q('insert into public.trip_tasks (' + cols.join(', ') + ') values (' + marks + ') returning *', Object.values(fields));
  }).then((r) => r.rows[0]);

beforeAll(async () => {
  db = await startDb('tripley_prep');
  maya = await createUser(db, 'Maya');
  sam = await createUser(db, 'Sam');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, maya, [sam], 'Lisbon');
});

afterAll(async () => {
  await db?.end();
});

describe('packing lists', () => {
  it('your packing list is private to you', async () => {
    await addTask(sam, 'packing', 'Passport');
    await addTask(sam, 'packing', 'Sunscreen', { done: true });
    await addTask(maya, 'packing', 'Camera');
    const mine = await as(db, sam, (q) => q(`select title, done from public.trip_tasks where kind = 'packing' order by title`));
    expect(mine.rows).toEqual([
      { title: 'Passport', done: false },
      { title: 'Sunscreen', done: true },
    ]);
    const hers = await as(db, maya, (q) => q(`select title from public.trip_tasks where kind = 'packing'`));
    expect(hers.rows).toEqual([{ title: 'Camera' }]);
  });

  it('nobody else can tick off or delete your items', async () => {
    const r = await as(db, maya, (q) => q(`update public.trip_tasks set done = true where title = 'Passport'`));
    expect(r.rowCount).toBe(0);
    const d = await as(db, maya, (q) => q(`delete from public.trip_tasks where title = 'Passport'`));
    expect(d.rowCount).toBe(0);
  });

  it('packing items can’t be assigned to someone', async () => {
    await expect(addTask(sam, 'packing', 'x', { assignee_id: maya })).rejects.toThrow(/trip_tasks_packing_unassigned/);
  });
});

describe('group tasks', () => {
  let task: string;
  it('anyone adds and assigns them to someone in the trip; everyone sees them', async () => {
    task = (await addTask(maya, 'group', 'Book the ferry', { assignee_id: sam })).id;
    const seen = await as(db, sam, (q) => q(`select title, assignee_id, created_by from public.trip_tasks where kind = 'group'`));
    expect(seen.rows).toEqual([{ title: 'Book the ferry', assignee_id: sam, created_by: maya }]);
    await expect(addTask(maya, 'group', 'x', { assignee_id: stranger })).rejects.toThrow(/need to be in the trip/);
  });

  it('ticking off records who and when; unticking clears it', async () => {
    const done = await as(db, sam, (q) => q('update public.trip_tasks set done = true where id = $1 returning done_by, done_at', [task]));
    expect(done.rows[0].done_by).toBe(sam);
    expect(done.rows[0].done_at).not.toBeNull();
    const undone = await as(db, maya, (q) => q('update public.trip_tasks set done = false where id = $1 returning done_by', [task]));
    expect(undone.rows[0].done_by).toBeNull();
  });

  it('can’t pretend someone else ticked it, or move it to another trip', async () => {
    await expect(as(db, sam, (q) => q('update public.trip_tasks set done_by = $2 where id = $1', [task, maya]))).rejects.toThrow(/permission denied/);
    const other = await createTrip(db, sam, [], 'Other');
    await expect(as(db, sam, (q) => q('update public.trip_tasks set trip_id = $2 where id = $1', [task, other]))).rejects.toThrow(/permission denied/);
  });

  it('strangers see nothing and can’t add', async () => {
    expect((await as(db, stranger, (q) => q('select * from public.trip_tasks'))).rows).toEqual([]);
    await expect(addTask(stranger, 'group', 'x')).rejects.toThrow(/row-level security/);
  });

  it('progress counts: my packing and the group’s tasks', async () => {
    const r = await as(db, sam, (q) => q('select stats from public.my_trip_overview() where trip_id = $1', [trip]));
    expect(r.rows[0].stats).toMatchObject({ packing_total: 2, packing_done: 1, tasks_total: 1, tasks_done: 0 });
  });
});

describe('challenges', () => {
  let challenge: string;
  let post: string;
  it('anyone starts one; it shows in the feed', async () => {
    challenge = (await as(db, sam, (q) => q(`select public.create_challenge($1, 'Find the best local food', 'Post your best bite', '🍽️') as id`, [trip]))).rows[0].id;
    const ev = await as(db, maya, (q) => q(`select event ->> 'label' as label from public.trip_posts where event ->> 'type' = 'challenge_started'`));
    expect(ev.rows).toEqual([{ label: 'Find the best local food' }]);
    await expect(as(db, stranger, (q) => q(`select public.create_challenge($1, 'x')`, [trip]))).rejects.toThrow(/not in this trip/);
  });

  it('you enter your own posts only', async () => {
    post = (await as(db, maya, (q) => q(`select public.create_post($1, 'update', 'Pastel de nata at Manteigaria!') as id`, [trip]))).rows[0].id;
    await expect(as(db, sam, (q) => q('select public.enter_challenge($1, $2)', [challenge, post]))).rejects.toThrow(/your own posts/);
    await as(db, maya, (q) => q('select public.enter_challenge($1, $2)', [challenge, post]));
    await as(db, maya, (q) => q('select public.enter_challenge($1, $2)', [challenge, post]));
    const e = await as(db, sam, (q) => q('select user_id from public.challenge_entries where challenge_id = $1', [challenge]));
    expect(e.rows).toEqual([{ user_id: maya }]);
    expect((await as(db, stranger, (q) => q('select * from public.challenge_entries'))).rows).toEqual([]);
  });
});
