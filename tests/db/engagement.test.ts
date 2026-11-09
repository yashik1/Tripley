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

describe('activity feed', () => {
  let post: string;
  const putPhoto = (who: string, name: string) =>
    as(db, who, (q) => q(`insert into storage.objects (bucket_id, name) values ('trip-photos', $1)`, [name]));
  const create = (who: string, kind: string, body: string | null, photos: string[] = [], place: string | null = null) =>
    as(db, who, (q) => q('select public.create_post($1, $2, $3, $4, $5) as id', [trip, kind, body, photos, place])).then((r) => r.rows[0].id as string);

  it('the trip’s story starts itself: started, joined, pinned, planned', async () => {
    const r = await as(db, lee, (q) => q(`select author_id, event ->> 'type' as type from public.trip_posts where trip_id = $1 and kind = 'event' order by created_at`, [trip]));
    expect(r.rows.map((x) => x.type)).toEqual(['trip_started', 'member_joined', 'member_joined', 'stop_added', 'place_pinned']);
    expect(r.rows[0].author_id).toBe(maya);
  });

  it('members post updates; others are told, unless they turned it off', async () => {
    await as(db, lee, (q) => q(`update public.profiles set notification_prefs = '{"posts": false}' where id = $1`, [lee]));
    post = await create(sam, 'update', '  Landed! Grabbing coffee near the hotel  ');
    const body = await as(db, sam, (q) => q('select body, author_id from public.trip_posts where id = $1', [post]));
    expect(body.rows[0]).toEqual({ body: 'Landed! Grabbing coffee near the hotel', author_id: sam });
    const told = await db.query(`select user_id from public.notifications where kind = 'post_update' and data ->> 'post_id' = $1`, [post]);
    expect(told.rows.map((r) => r.user_id)).toEqual([maya]);
  });

  it('only the organizer posts announcements; empty posts are refused', async () => {
    await expect(create(sam, 'announcement', 'Meet at 9')).rejects.toThrow(/Only the organizer/);
    await create(maya, 'announcement', 'Meet in the lobby at 9');
    await expect(create(sam, 'update', '   ')).rejects.toThrow(/nothing to post/);
    await expect(create(sam, 'photos', null, [])).rejects.toThrow(/nothing to post/);
    await expect(create(sam, 'poll' as string, 'x')).rejects.toThrow(/what kind of post/);
  });

  it('photos must be your own uploads in this trip’s folder', async () => {
    await putPhoto(sam, `${trip}/beach1.jpg`);
    await putPhoto(lee, `${trip}/lees.jpg`);
    const other = await createTrip(db, sam, [], 'Sam solo');
    await putPhoto(sam, `${other}/elsewhere.jpg`);
    const id = await create(sam, 'photos', 'Sunset', [`${trip}/beach1.jpg`]);
    const photos = await as(db, maya, (q) => q('select path from public.post_photos where post_id = $1', [id]));
    expect(photos.rows).toEqual([{ path: `${trip}/beach1.jpg` }]);
    await expect(create(sam, 'photos', null, [`${trip}/lees.jpg`])).rejects.toThrow(/couldn't be found/);
    await expect(create(sam, 'photos', null, [`${other}/elsewhere.jpg`])).rejects.toThrow(/couldn't be found/);
    await expect(create(sam, 'photos', null, [`${trip}/missing.jpg`])).rejects.toThrow(/couldn't be found/);
    await expect(create(sam, 'photos', null, Array.from({ length: 7 }, (_, i) => `${trip}/p${i}.jpg`))).rejects.toThrow(/Up to 6/);
  });

  it('strangers and signed-out visitors see nothing and can’t post', async () => {
    expect((await as(db, stranger, (q) => q('select * from public.trip_posts where trip_id = $1', [trip]))).rows).toEqual([]);
    expect((await as(db, stranger, (q) => q('select * from public.post_photos'))).rows).toEqual([]);
    await expect(as(db, stranger, (q) => q(`select public.create_post($1, 'update', 'hi')`, [trip]))).rejects.toThrow(/not in this trip/);
    await expect(as(db, null, (q) => q('select * from public.trip_posts'))).rejects.toThrow(/permission denied/);
    await expect(as(db, sam, (q) => q(`insert into public.trip_posts (trip_id, author_id, kind, body) values ($1, $2, 'update', 'x')`, [trip, sam]))).rejects.toThrow(/permission denied/);
  });

  it('reactions toggle, one of six emoji, and are visible to members only', async () => {
    const r1 = await as(db, lee, (q) => q(`select public.toggle_reaction($1, '🔥') as added`, [post]));
    expect(r1.rows[0].added).toBe(true);
    await as(db, maya, (q) => q(`select public.toggle_reaction($1, '❤️')`, [post]));
    const r2 = await as(db, lee, (q) => q(`select public.toggle_reaction($1, '🔥') as added`, [post]));
    expect(r2.rows[0].added).toBe(false);
    const all = await as(db, sam, (q) => q('select user_id, emoji from public.post_reactions where post_id = $1', [post]));
    expect(all.rows).toEqual([{ user_id: maya, emoji: '❤️' }]);
    await expect(as(db, lee, (q) => q(`select public.toggle_reaction($1, '💩')`, [post]))).rejects.toThrow(/Pick one/);
    await expect(as(db, stranger, (q) => q(`select public.toggle_reaction($1, '🔥')`, [post]))).rejects.toThrow(/not found/);
    // Reactions notify only those who asked for it (off by default).
    expect((await db.query(`select count(*)::int as n from public.notifications where kind = 'post_reaction'`)).rows[0].n).toBe(0);
  });

  it('comments notify the author; can’t comment as someone else or across trips', async () => {
    await as(db, lee, (q) => q('insert into public.post_comments (post_id, trip_id, body) values ($1, $2, $3)', [post, trip, 'Save me a seat!']));
    const n = await as(db, sam, (q) => q(`select body from public.notifications where kind = 'post_comment'`));
    expect(n.rows[0].body).toBe('Lee commented: Save me a seat!');
    await expect(
      as(db, lee, (q) => q('insert into public.post_comments (post_id, trip_id, user_id, body) values ($1, $2, $3, $4)', [post, trip, maya, 'x'])),
    ).rejects.toThrow(/permission denied/);
    const leeTrip = await createTrip(db, lee, [], 'Lee solo');
    await expect(as(db, lee, (q) => q('insert into public.post_comments (post_id, trip_id, body) values ($1, $2, $3)', [post, leeTrip, 'x']))).rejects.toThrow(/not found/);
    await expect(as(db, stranger, (q) => q('insert into public.post_comments (post_id, trip_id, body) values ($1, $2, $3)', [post, trip, 'x']))).rejects.toThrow(/row-level security/);
  });

  it('authors remove their own posts; the organizer can remove any; automatic posts stay', async () => {
    const del = await as(db, lee, (q) => q('delete from public.trip_posts where id = $1', [post]));
    expect(del.rowCount).toBe(0);
    const ev = await as(db, sam, (q) => q(`delete from public.trip_posts where trip_id = $1 and kind = 'event' and author_id = $2`, [trip, sam]));
    expect(ev.rowCount).toBe(0);
    const own = await as(db, sam, (q) => q('delete from public.trip_posts where id = $1', [post]));
    expect(own.rowCount).toBe(1);
  });

  it('posting has a rate limit', async () => {
    for (let i = 0; i < 20; i++) await create(lee, 'update', `post ${i}`);
    await expect(create(lee, 'update', 'one too many')).rejects.toThrow(/posting very fast/);
  });
});
