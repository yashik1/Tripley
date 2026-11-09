/**
 * Bucket list and group polls (migration 20261114000000_bucket_list_polls):
 * who can suggest, vote, add to the plan (exactly once, even at the same
 * moment), start, vote in and close polls.
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, begin, connect, createTrip, createUser, sleep, startDb } from './helpers';

let db: Client;
let maya: string, sam: string, lee: string, stranger: string;
let trip: string;

beforeAll(async () => {
  db = await startDb('tripley_bucket');
  maya = await createUser(db, 'Maya');
  sam = await createUser(db, 'Sam');
  lee = await createUser(db, 'Lee');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, maya, [sam, lee], 'Lisbon');
  await db.query(`update public.profiles set notification_prefs = '{"posts": false}' where id = $1`, [lee]);
});

afterAll(async () => {
  await db?.end();
});

describe('bucket list', () => {
  let idea: string;
  const suggest = (who: string, fields: Record<string, unknown>) =>
    as(db, who, (q) => {
      const cols = Object.keys(fields);
      const marks = cols.map((_, i) => '$' + (i + 1)).join(', ');
      return q('insert into public.trip_suggestions (' + cols.join(', ') + ') values (' + marks + ') returning *', Object.values(fields));
    }).then((r) => r.rows[0]);

  it('members suggest places; the server records who; it shows in the feed', async () => {
    const s = await suggest(sam, {
      trip_id: trip,
      category: 'food',
      name: '  Time Out Market ',
      description: 'Huge food hall',
      cost_minor: 2500,
      cost_currency: 'EUR',
      lat: 38.707,
      lng: -9.146,
    });
    idea = s.id;
    expect(s.suggested_by).toBe(sam);
    expect(s.name).toBe('Time Out Market');
    const ev = await as(db, lee, (q) => q(`select event ->> 'label' as label from public.trip_posts where event ->> 'type' = 'suggestion_added'`));
    expect(ev.rows).toEqual([{ label: 'Time Out Market' }]);
  });

  it('validates on the server, and can’t claim to be someone else', async () => {
    await expect(suggest(sam, { trip_id: trip, category: 'casino', name: 'x' })).rejects.toThrow(/check constraint/);
    await expect(suggest(sam, { trip_id: trip, category: 'food', name: 'x', cost_minor: 100 })).rejects.toThrow(/suggestions_cost_complete/);
    await expect(suggest(sam, { trip_id: trip, category: 'food', name: 'x', photo_path: `${trip}/never-uploaded.jpg` })).rejects.toThrow(/photo couldn't be found/);
    await expect(suggest(sam, { trip_id: trip, category: 'food', name: 'x', suggested_by: maya })).rejects.toThrow(/permission denied/);
    await expect(suggest(stranger, { trip_id: trip, category: 'food', name: 'x' })).rejects.toThrow(/row-level security/);
  });

  it('a photo must be your own upload in this trip’s folder', async () => {
    await as(db, lee, (q) => q(`insert into storage.objects (bucket_id, name) values ('trip-photos', $1)`, [`${trip}/lee-beach.jpg`]));
    await expect(suggest(sam, { trip_id: trip, category: 'beach', name: 'Beach', photo_path: `${trip}/lee-beach.jpg` })).rejects.toThrow(/photo couldn't be found/);
    const ok = await suggest(lee, { trip_id: trip, category: 'beach', name: 'Praia da Ursa', photo_path: `${trip}/lee-beach.jpg` });
    expect(ok.photo_path).toBe(`${trip}/lee-beach.jpg`);
  });

  it('only who suggested it or the organizer edits or removes it', async () => {
    const r = await as(db, lee, (q) => q(`update public.trip_suggestions set name = 'Mine' where id = $1`, [idea]));
    expect(r.rowCount).toBe(0);
    const d = await as(db, lee, (q) => q('delete from public.trip_suggestions where id = $1', [idea]));
    expect(d.rowCount).toBe(0);
    await as(db, maya, (q) => q(`update public.trip_suggestions set description = 'Huge food hall, go early' where id = $1`, [idea]));
  });

  it('one vote each, toggled; strangers can’t vote or see', async () => {
    await as(db, maya, (q) => q('select public.toggle_suggestion_vote($1)', [idea]));
    for (let i = 0; i < 3; i++) await as(db, lee, (q) => q('select public.toggle_suggestion_vote($1)', [idea]));
    const v = await as(db, sam, (q) => q('select user_id from public.suggestion_votes where suggestion_id = $1', [idea]));
    expect(v.rows.map((r) => r.user_id).sort()).toEqual([maya, lee].sort());
    await expect(as(db, stranger, (q) => q('select public.toggle_suggestion_vote($1)', [idea]))).rejects.toThrow(/not found/);
    expect((await as(db, stranger, (q) => q('select * from public.trip_suggestions'))).rows).toEqual([]);
    await expect(as(db, null, (q) => q('select * from public.trip_suggestions'))).rejects.toThrow(/permission denied/);
  });

  it('two people adding it to the plan at once make one stop', async () => {
    const c2 = await connect();
    try {
      await begin(db, maya);
      await begin(c2, lee);
      const a = (await db.query('select public.add_suggestion_to_plan($1) as id', [idea])).rows[0].id;
      const pending = c2.query('select public.add_suggestion_to_plan($1) as id', [idea]);
      await sleep(150);
      await db.query('commit');
      const b = (await pending).rows[0].id;
      await c2.query('commit');
      expect(b).toBe(a);
      const stops = await db.query(`select title, place_name, notes, lat from public.itinerary_items where trip_id = $1`, [trip]);
      expect(stops.rows).toEqual([{ title: 'Time Out Market', place_name: 'Time Out Market', notes: 'Huge food hall, go early', lat: 38.707 }]);
      expect((await db.query('select itinerary_item_id from public.trip_suggestions where id = $1', [idea])).rows[0].itinerary_item_id).toBe(a);
      // Pressing again later still returns the same stop.
      const again = await as(db, sam, (q) => q('select public.add_suggestion_to_plan($1) as id', [idea]));
      expect(again.rows[0].id).toBe(a);
    } finally {
      await c2.end();
    }
  });

  it('strangers can’t add it to their plan', async () => {
    await expect(as(db, stranger, (q) => q('select public.add_suggestion_to_plan($1)', [idea]))).rejects.toThrow(/not found/);
  });
});

describe('polls', () => {
  let poll: string;
  let opts: { id: string; label: string }[];
  const vote = (who: string, option: string | null, p = poll) => as(db, who, (q) => q('select public.vote_poll($1, $2)', [p, option]));

  it('anyone in the trip starts a poll; options keep their order; the group is told', async () => {
    poll = (await as(db, sam, (q) => q(`select public.create_poll($1, 'Where should we eat tonight?', array['Taberna', ' Pizza ', 'Ramen', 'Taberna']) as id`, [trip]))).rows[0].id;
    opts = (await as(db, lee, (q) => q('select id, label from public.poll_options where poll_id = $1 order by position', [poll]))).rows;
    expect(opts.map((o) => o.label)).toEqual(['Taberna', 'Pizza', 'Ramen']);
    const told = await db.query(`select user_id from public.notifications where kind = 'poll_created'`);
    expect(told.rows.map((r) => r.user_id)).toEqual([maya]); // Lee turned post notifications off
    const ev = await db.query(`select count(*)::int as n from public.trip_posts where event ->> 'type' = 'poll_created'`);
    expect(ev.rows[0].n).toBe(1);
  });

  it('needs 2–8 different options and a future closing time', async () => {
    await expect(as(db, sam, (q) => q(`select public.create_poll($1, 'Q?', array['Only one', ' Only one'])`, [trip]))).rejects.toThrow(/2 to 8/);
    await expect(as(db, sam, (q) => q(`select public.create_poll($1, 'Q?', array['a','b','c','d','e','f','g','h','i'])`, [trip]))).rejects.toThrow(/2 to 8/);
    await expect(as(db, sam, (q) => q(`select public.create_poll($1, 'Q?', array['a','b'], now() - interval '1 hour')`, [trip]))).rejects.toThrow(/future/);
    await expect(as(db, stranger, (q) => q(`select public.create_poll($1, 'Q?', array['a','b'])`, [trip]))).rejects.toThrow(/not in this trip/);
  });

  it('one vote each; change it or withdraw it; votes can’t be written directly', async () => {
    await vote(maya, opts[0].id);
    await vote(lee, opts[1].id);
    await vote(maya, opts[2].id);
    await vote(lee, null);
    const v = await as(db, sam, (q) => q('select user_id, option_id from public.poll_votes where poll_id = $1', [poll]));
    expect(v.rows).toEqual([{ user_id: maya, option_id: opts[2].id }]);
    await expect(vote(stranger, opts[0].id)).rejects.toThrow(/not found/);
    await expect(
      as(db, maya, (q) => q('insert into public.poll_votes (poll_id, option_id, trip_id, user_id) values ($1, $2, $3, $4)', [poll, opts[0].id, trip, lee])),
    ).rejects.toThrow(/permission denied/);
  });

  it('an option from another poll is refused; fixed votes stay fixed', async () => {
    const other = (await as(db, maya, (q) => q(`select public.create_poll($1, 'When do we leave?', array['8am','9am'], null, false) as id`, [trip]))).rows[0].id;
    await expect(vote(lee, opts[0].id, other)).rejects.toThrow(/isn't one of the options/);
    const o2 = (await db.query('select id from public.poll_options where poll_id = $1 order by position', [other])).rows;
    await vote(lee, o2[0].id, other);
    await expect(vote(lee, o2[1].id, other)).rejects.toThrow(/doesn't allow changing/);
  });

  it('only its creator or the organizer closes it; then no more votes', async () => {
    await expect(as(db, lee, (q) => q('select public.close_poll($1)', [poll]))).rejects.toThrow(/Only whoever started/);
    await as(db, sam, (q) => q('select public.close_poll($1)', [poll]));
    await expect(vote(lee, opts[0].id)).rejects.toThrow(/closed/);
    const n = await as(db, maya, (q) => q(`select body from public.notifications where kind = 'poll_closed'`));
    expect(n.rows[0].body).toBe('"Where should we eat tonight?" is closed: Ramen won');
  });

  it('a poll past its closing time takes no votes', async () => {
    const p = (await as(db, maya, (q) => q(`select public.create_poll($1, 'Beach or museum?', array['Beach','Museum'], now() + interval '1 hour') as id`, [trip]))).rows[0].id;
    await db.query(`update public.trip_polls set closes_at = now() - interval '1 minute' where id = $1`, [p]);
    const o = (await db.query('select id from public.poll_options where poll_id = $1 limit 1', [p])).rows[0].id;
    await expect(vote(sam, o, p)).rejects.toThrow(/closed/);
  });

  it('strangers and signed-out visitors see no polls', async () => {
    expect((await as(db, stranger, (q) => q('select * from public.trip_polls'))).rows).toEqual([]);
    await expect(as(db, null, (q) => q('select * from public.poll_votes'))).rejects.toThrow(/permission denied/);
  });
});
