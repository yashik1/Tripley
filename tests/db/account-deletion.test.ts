/**
 * Account deletion (migration 20261117000000_account_deletion): what is
 * removed, what stays for the rest of the group, who takes over a trip, and
 * that a deleted account can't come back on its old access token.
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let ana: string, ben: string, cleo: string, stranger: string;
let lisbon: string, solo: string, rome: string;
let bill: string, bensPost: string, poll: string, task: string, stop: string;

const file = (owner: string, bucket: string, name: string) =>
  db.query('insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', [bucket, name, owner]);
const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
const count = async (sql: string, params: unknown[] = []) => Number((await one(`select count(*) as n from ${sql}`, params)).n);
const preview = (who: string) => as(db, who, (q) => q('select public.account_deletion_preview() as p')).then((r) => r.rows[0].p);

function billFor(trip: string, payer: string, people: string[], receipt?: string) {
  const each = 100_00;
  return JSON.stringify({
    trip_id: trip,
    paid_by: payer,
    title: 'Dinner',
    currency: 'EUR',
    split_mode: 'itemized',
    total_minor: each * people.length,
    total_base_minor: each * people.length,
    receipt_path: receipt,
    items: [{ name: 'Set menu', line_total_minor: each * people.length, shares: people.map((user_id) => ({ user_id, weight: 1 })) }],
    shares: people.map((user_id) => ({ user_id, amount_minor: each, amount_base_minor: each })),
  });
}

beforeAll(async () => {
  db = await startDb('tripley_account_deletion');
  ana = await createUser(db, 'Ana', undefined, 'ana@example.com');
  ben = await createUser(db, 'Ben');
  cleo = await createUser(db, 'Cleo');
  stranger = await createUser(db, 'Stranger');
  // Ana organizes Lisbon (Ben joined first, then Cleo) and a trip of her own; Ben organizes Rome.
  lisbon = await createTrip(db, ana, [ben, cleo], 'Lisbon');
  solo = await createTrip(db, ana, [], 'Solo weekend');
  rome = await createTrip(db, ben, [ana], 'Rome');

  // Files Ana uploaded.
  await file(ana, 'trip-photos', `${lisbon}/cover.jpg`); // stays: the trip's cover
  await file(ana, 'receipts', `${lisbon}/dinner.jpg`); // stays: a shared bill's receipt
  await file(ana, 'trip-photos', `${lisbon}/post.jpg`);
  await file(ana, 'trip-photos', `${lisbon}/memory.jpg`);
  await file(ana, 'trip-photos', `${lisbon}/cafe.jpg`);
  await file(ana, 'trip-photos', `${lisbon}/idea.jpg`);
  await file(ana, 'trip-photos', `${lisbon}/never-used.jpg`);
  await file(ana, 'receipts', `${solo}/taxi.jpg`); // goes: the trip goes
  await file(ana, 'avatars', `${ana}/me.jpg`);
  await file(ben, 'trip-photos', `${lisbon}/bens.jpg`);

  await as(db, ana, (q) => q('update public.trips set cover_path = $2 where id = $1', [lisbon, `${lisbon}/cover.jpg`]));
  bill = (await as(db, ana, (q) => q('select public.save_bill($1) as id', [billFor(lisbon, ana, [ana, ben, cleo], `${lisbon}/dinner.jpg`)]))).rows[0].id;
  await as(db, ana, (q) => q('select public.save_bill($1)', [billFor(solo, ana, [ana], `${solo}/taxi.jpg`)]));
  await as(db, ben, (q) => q('select public.save_bill($1)', [billFor(rome, ben, [ana, ben])]));

  // What Ana wrote and shared in Lisbon.
  await as(db, ana, (q) => q(`select public.create_post($1, 'photos', 'Sunset', $2)`, [lisbon, [`${lisbon}/post.jpg`]]));
  bensPost = (await as(db, ben, (q) => q(`select public.create_post($1, 'update', 'Landed!') as id`, [lisbon]))).rows[0].id;
  await as(db, ana, (q) => q('insert into public.post_comments (post_id, trip_id, body) values ($1, $2, $3)', [bensPost, lisbon, 'See you soon']));
  await as(db, ana, (q) => q(`select public.toggle_reaction($1, '🔥')`, [bensPost]));
  await as(db, cleo, (q) => q(`select public.toggle_reaction($1, '🔥')`, [bensPost]));
  await as(db, ana, (q) => q(`insert into public.trip_tasks (trip_id, kind, title) values ($1, 'packing', 'Passport')`, [lisbon]));
  task = (await as(db, ben, (q) => q(`insert into public.trip_tasks (trip_id, kind, title, assignee_id) values ($1, 'group', 'Book the tram', $2) returning id`, [lisbon, ana]))).rows[0].id;
  await as(db, ana, (q) =>
    q(`insert into public.trip_places (trip_id, kind, name, lat, lng, photo_path) values ($1, 'memory', 'Viewpoint', 38.71, -9.13, $2), ($1, 'food', 'Café', 38.72, -9.14, $3)`, [
      lisbon,
      `${lisbon}/memory.jpg`,
      `${lisbon}/cafe.jpg`,
    ]),
  );
  await as(db, ana, (q) => q(`insert into public.trip_suggestions (trip_id, name, category, photo_path) values ($1, 'Fado night', 'experience', $2)`, [lisbon, `${lisbon}/idea.jpg`]));
  poll = (await as(db, ana, (q) => q(`select public.create_poll($1, 'Beach or museum?', array['Beach','Museum']) as id`, [lisbon]))).rows[0].id;
  const option = (await one('select id from public.poll_options where poll_id = $1 order by position limit 1', [poll])).id;
  await as(db, ana, (q) => q('select public.vote_poll($1, $2)', [poll, option]));
  await as(db, ben, (q) => q('select public.vote_poll($1, $2)', [poll, option]));
  stop = (await as(db, ana, (q) => q(`insert into public.itinerary_items (trip_id, day, title) values ($1, current_date, 'Tile museum') returning id`, [lisbon]))).rows[0].id;
  await as(db, ana, (q) => q(`select public.set_itinerary_rsvp($1, 'going')`, [stop]));
  await as(db, ana, (q) => q(`update public.profiles set payment_handles = '{"upi":"ana@bank"}' where id = $1`, [ana]));
  await db.query(`insert into public.push_tokens (token, user_id, platform) values ('tok-ana', $1, 'web')`, [ana]);
});

afterAll(async () => {
  await db?.end();
});

describe('before deleting', () => {
  it('the preview says which trips go, which stay, and who takes over', async () => {
    const p = await preview(ana);
    expect(p.trips_deleted).toEqual([{ id: solo, name: 'Solo weekend' }]);
    expect(p.trips_left).toEqual([
      { id: lisbon, name: 'Lisbon', new_organizer: 'Ben' },
      { id: rome, name: 'Rome', new_organizer: null },
    ]);
    expect(p.pro).toBe(false);
    expect(p.kitties_held).toBe(0);
  });

  it('lists the files to remove, keeping the shared trip’s cover and receipt', async () => {
    const p = await preview(ana);
    expect(p.files).toEqual([
      { bucket: 'avatars', path: `${ana}/me.jpg` },
      { bucket: 'receipts', path: `${solo}/taxi.jpg` },
      { bucket: 'trip-photos', path: `${lisbon}/cafe.jpg` },
      { bucket: 'trip-photos', path: `${lisbon}/idea.jpg` },
      { bucket: 'trip-photos', path: `${lisbon}/memory.jpg` },
      { bucket: 'trip-photos', path: `${lisbon}/never-used.jpg` },
      { bucket: 'trip-photos', path: `${lisbon}/post.jpg` },
    ]);
  });

  it('is only for signed-in people, and only ever about yourself', async () => {
    await expect(as(db, null, (q) => q('select public.account_deletion_preview()'))).rejects.toThrow(/permission denied/);
    await expect(as(db, null, (q) => q('select public.delete_my_account()'))).rejects.toThrow(/permission denied/);
    await expect(as(db, ben, (q) => q('select * from public.account_files($1)', [ana]))).rejects.toThrow(/permission denied/);
    expect((await preview(stranger)).trips_left).toEqual([]);
  });

  it('refuses while the person’s photos are still stored, and changes nothing', async () => {
    await expect(as(db, ana, (q) => q('select public.delete_my_account()'))).rejects.toThrow(/photos couldn.t be removed/);
    expect(await count('public.trip_members where user_id = $1', [ana])).toBe(3);
    expect(await count('auth.users where id = $1', [ana])).toBe(1);
  });

  it('nobody can hand a trip to someone else directly', async () => {
    await expect(as(db, ana, (q) => q('update public.trips set organizer_id = $2 where id = $1', [lisbon, cleo]))).rejects.toThrow();
    await expect(db.query('update public.trips set organizer_id = $2 where id = $1', [lisbon, cleo])).rejects.toThrow(/organizer can.t be changed/);
  });
});

describe('deleting the account', () => {
  beforeAll(async () => {
    // The app removes these through the Storage API.
    const { files } = await preview(ana);
    for (const f of files) await db.query('delete from storage.objects where bucket_id = $1 and name = $2', [f.bucket, f.path]);
    await as(db, ana, (q) => q('select public.delete_my_account()'));
  });

  it('removes the sign-in record and empties the profile', async () => {
    expect(await count('auth.users where id = $1', [ana])).toBe(0);
    const p = await one('select display_name, avatar_url, payment_handles, deleted_at is not null as deleted from public.profiles where id = $1', [ana]);
    expect(p).toEqual({ display_name: 'Former member', avatar_url: null, payment_handles: {}, deleted: true });
    expect(await count('public.push_tokens where user_id = $1', [ana])).toBe(0);
    expect(await count('public.notifications where user_id = $1', [ana])).toBe(0);
    expect(await count('public.accounts where user_id = $1', [ana])).toBe(0);
  });

  it('deletes the trip nobody else was on, with its bill', async () => {
    expect(await count('public.trips where id = $1', [solo])).toBe(0);
    expect(await count('public.bills where trip_id = $1', [solo])).toBe(0);
  });

  it('hands a shared trip to the longest-standing member and tells them', async () => {
    const t = await one('select organizer_id from public.trips where id = $1', [lisbon]);
    expect(t.organizer_id).toBe(ben);
    const members = (await db.query('select user_id, role from public.trip_members where trip_id = $1 order by joined_at', [lisbon])).rows;
    expect(members).toEqual([
      { user_id: ben, role: 'organizer' },
      { user_id: cleo, role: 'member' },
    ]);
    const n = await one(`select body from public.notifications where user_id = $1 and kind = 'organizer_changed'`, [ben]);
    expect(n.body).toMatch(/now the organizer/);
    // Ben can do organizer things; Cleo wasn't promoted.
    await as(db, ben, (q) => q(`update public.trips set name = 'Lisbon 2026' where id = $1`, [lisbon]));
    expect(await count(`public.notifications where user_id = $1 and kind = 'organizer_changed'`, [cleo])).toBe(0);
  });

  it('leaves trips organized by someone else untouched', async () => {
    const t = await one('select organizer_id from public.trips where id = $1', [rome]);
    expect(t.organizer_id).toBe(ben);
    expect(await count('public.trip_members where trip_id = $1', [rome])).toBe(1);
  });

  it('keeps bills and shares so everyone’s balances still add up', async () => {
    const b = await as(db, ben, (q) => q('select paid_by, total_base_minor::int as total from public.bills where id = $1', [bill]));
    expect(b.rows).toEqual([{ paid_by: ana, total: 300_00 }]);
    const shares = await as(db, cleo, (q) => q('select count(*)::int as n, sum(amount_base_minor)::int as total from public.bill_shares where bill_id = $1', [bill]));
    expect(shares.rows[0]).toEqual({ n: 3, total: 300_00 });
    expect(await count('public.bill_shares where user_id = $1', [ana])).toBe(2); // Lisbon and Rome
  });

  it('removes what they wrote and shared', async () => {
    expect(await count('public.trip_posts where author_id = $1', [ana])).toBe(0);
    expect(await count('public.post_comments where user_id = $1', [ana])).toBe(0);
    expect(await count('public.post_reactions where user_id = $1', [ana])).toBe(0);
    expect(await count('public.poll_votes where user_id = $1', [ana])).toBe(0);
    expect(await count('public.itinerary_rsvps where user_id = $1', [ana])).toBe(0);
    expect(await count(`public.trip_tasks where created_by = $1 and kind = 'packing'`, [ana])).toBe(0);
    expect(await count(`public.trip_places where trip_id = $1 and kind = 'memory'`, [lisbon])).toBe(0);
  });

  it('keeps the group’s plans, without their photos or their name on a task', async () => {
    // Other people's posts, reactions and votes are untouched.
    expect(await count('public.trip_posts where id = $1', [bensPost])).toBe(1);
    expect(await count('public.post_reactions where post_id = $1', [bensPost])).toBe(1);
    expect(await count('public.poll_votes where poll_id = $1', [poll])).toBe(1);
    expect(await count('public.trip_polls where id = $1', [poll])).toBe(1);
    expect(await count('public.itinerary_items where id = $1', [stop])).toBe(1);
    expect(await one('select assignee_id from public.trip_tasks where id = $1', [task])).toEqual({ assignee_id: null });
    expect(await one(`select photo_path from public.trip_places where trip_id = $1 and name = 'Café'`, [lisbon])).toEqual({ photo_path: null });
    expect(await one(`select photo_path from public.trip_suggestions where trip_id = $1 and name = 'Fado night'`, [lisbon])).toEqual({ photo_path: null });
    // The cover and the shared receipt were never on the list to remove.
    expect(await one('select cover_path from public.trips where id = $1', [lisbon])).toEqual({ cover_path: `${lisbon}/cover.jpg` });
    expect(await count(`storage.objects where owner = $1`, [ana])).toBe(2);
  });

  it('other members can no longer see the profile', async () => {
    const seen = await as(db, ben, (q) => q('select display_name from public.profiles where id = $1', [ana]));
    expect(seen.rows).toEqual([]);
  });
});

describe('a deleted account cannot come back on its old access token', () => {
  it('can’t delete twice, edit the profile, create a trip or join one', async () => {
    await expect(as(db, ana, (q) => q('select public.delete_my_account()'))).rejects.toThrow(/account was deleted/);
    await expect(as(db, ana, (q) => q(`update public.profiles set display_name = 'Ana again' where id = $1`, [ana]))).rejects.toThrow(/account was deleted/);
    await expect(as(db, ana, (q) => q(`insert into public.trips (name, base_currency) values ('New', 'EUR')`))).rejects.toThrow(/account was deleted/);
    const code = (await one('select invite_code from public.trips where id = $1', [rome])).invite_code;
    await expect(as(db, ana, (q) => q('select public.join_trip_by_code($1)', [code]))).rejects.toThrow(/account was deleted/);
  });

  it('sees nothing of the trips it was on', async () => {
    expect((await as(db, ana, (q) => q('select id from public.trips'))).rows).toEqual([]);
    expect((await as(db, ana, (q) => q('select id from public.bills'))).rows).toEqual([]);
  });

  it('the same email can sign up again as a brand new account', async () => {
    const again = await createUser(db, 'Ana', undefined, 'ana@example.com');
    expect(again).not.toBe(ana);
    expect((await as(db, again, (q) => q('select id from public.trips'))).rows).toEqual([]);
  });
});

describe('removing a user from the auth server directly still works as before', () => {
  it('takes the profile with it', async () => {
    await db.query('delete from auth.users where id = $1', [stranger]);
    expect(await count('public.profiles where id = $1', [stranger])).toBe(0);
  });

  it('is still refused while the group’s bills depend on them', async () => {
    await expect(db.query('delete from auth.users where id = $1', [cleo])).rejects.toThrow(/violates foreign key/);
    expect(await count('public.profiles where id = $1', [cleo])).toBe(1);
  });
});

describe('the last two people', () => {
  it('when the organizer of a two-person trip deletes, the other person takes over', async () => {
    const { files } = await preview(ben);
    expect(files).toEqual([{ bucket: 'trip-photos', path: `${lisbon}/bens.jpg` }]);
    await db.query(`delete from storage.objects where owner = $1`, [ben]);
    await as(db, ben, (q) => q('select public.delete_my_account()'));
    // Rome had only Ben left, so it's gone; Lisbon passes to Cleo.
    expect(await count('public.trips where id = $1', [rome])).toBe(0);
    expect(await one('select organizer_id from public.trips where id = $1', [lisbon])).toEqual({ organizer_id: cleo });
    expect(await count('public.bills where id = $1', [bill])).toBe(1);
  });
});
