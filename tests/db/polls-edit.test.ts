/**
 * Polls with more than one choice, and editing a poll (migration
 * 20261118000000_places_and_polls). Also the destination's map point.
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let ana: string, ben: string, cleo: string, stranger: string;
let trip: string;

const options = (poll: string) =>
  db.query('select id, label from public.poll_options where poll_id = $1 order by position', [poll]).then((r) => r.rows as { id: string; label: string }[]);
const votes = (poll: string) =>
  db
    .query(
      `select v.user_id, o.label from public.poll_votes v join public.poll_options o on o.id = v.option_id
       where v.poll_id = $1 order by v.user_id, o.position`,
      [poll],
    )
    .then((r) => r.rows as { user_id: string; label: string }[]);
const vote = (who: string, poll: string, option: string | null) => as(db, who, (q) => q('select public.vote_poll($1, $2)', [poll, option]));
const newPoll = (who: string, question: string, opts: string[], multiple = false, allowChange = true) =>
  as(db, who, (q) => q('select public.create_poll($1, $2, $3, null, $4, $5) as id', [trip, question, opts, allowChange, multiple])).then(
    (r) => r.rows[0].id as string,
  );
const edit = (who: string, poll: string, fields: { question?: string; options: { id?: string | null; label: string }[]; closesAt?: string | null; allowChange?: boolean; multiple?: boolean }) =>
  as(db, who, (q) =>
    q('select public.update_poll($1, $2, $3, $4, $5, $6)', [
      poll,
      fields.question ?? 'Question?',
      JSON.stringify(fields.options),
      fields.closesAt ?? null,
      fields.allowChange ?? true,
      fields.multiple ?? false,
    ]),
  );

beforeAll(async () => {
  db = await startDb('tripley_polls_edit');
  ana = await createUser(db, 'Ana');
  ben = await createUser(db, 'Ben');
  cleo = await createUser(db, 'Cleo');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, ana, [ben, cleo], 'Lisbon');
});

afterAll(async () => {
  await db?.end();
});

describe('more than one choice', () => {
  let poll: string;
  let o: { id: string; label: string }[];

  beforeAll(async () => {
    poll = await newPoll(ben, 'Which days work for the boat trip?', ['Friday', 'Saturday', 'Sunday'], true);
    o = await options(poll);
  });

  it('each tap ticks or unticks one option', async () => {
    await vote(cleo, poll, o[0].id);
    await vote(cleo, poll, o[2].id);
    await vote(ana, poll, o[1].id);
    expect(await votes(poll)).toEqual(
      [
        { user_id: cleo, label: 'Friday' },
        { user_id: cleo, label: 'Sunday' },
        { user_id: ana, label: 'Saturday' },
      ].sort((a, b) => a.user_id.localeCompare(b.user_id)),
    );
    await vote(cleo, poll, o[0].id);
    expect((await votes(poll)).filter((v) => v.user_id === cleo)).toEqual([{ user_id: cleo, label: 'Sunday' }]);
  });

  it('null clears all your picks', async () => {
    await vote(ana, poll, o[0].id);
    await vote(ana, poll, null);
    expect((await votes(poll)).filter((v) => v.user_id === ana)).toEqual([]);
  });

  it('when changes aren’t allowed, picks can be added but not taken back', async () => {
    const fixed = await newPoll(ben, 'Which museums?', ['Tiles', 'Coaches', 'Gulbenkian'], true, false);
    const f = await options(fixed);
    await vote(cleo, fixed, f[0].id);
    await vote(cleo, fixed, f[1].id);
    await expect(vote(cleo, fixed, f[0].id)).rejects.toThrow(/doesn't allow changing/);
    await expect(vote(cleo, fixed, null)).rejects.toThrow(/doesn't allow changing/);
    expect((await votes(fixed)).map((v) => v.label)).toEqual(['Tiles', 'Coaches']);
  });

  it('one-choice polls still replace your vote', async () => {
    const single = await newPoll(ben, 'Dinner?', ['Taberna', 'Pizza']);
    const s = await options(single);
    await vote(cleo, single, s[0].id);
    await vote(cleo, single, s[1].id);
    await vote(cleo, single, s[1].id); // tapping your own choice again changes nothing
    expect(await votes(single)).toEqual([{ user_id: cleo, label: 'Pizza' }]);
  });

  it('closing announces the option with the most picks', async () => {
    await vote(ana, poll, o[2].id);
    await as(db, ben, (q) => q('select public.close_poll($1)', [poll]));
    const n = await db.query(`select body from public.notifications where user_id = $1 and kind = 'poll_closed' order by created_at desc limit 1`, [ana]);
    expect(n.rows[0].body).toBe('"Which days work for the boat trip?" is closed: Sunday won');
  });
});

describe('editing a poll', () => {
  let poll: string;
  let o: { id: string; label: string }[];

  beforeAll(async () => {
    poll = await newPoll(cleo, 'Where should we eat?', ['Taberna', 'Pizza', 'Ramen']);
    o = await options(poll);
    await vote(ana, poll, o[0].id); // Taberna
    await vote(ben, poll, o[2].id); // Ramen
  });

  it('only whoever started it or the organizer can edit', async () => {
    await expect(edit(ben, poll, { options: [{ id: o[0].id, label: 'Taberna' }, { label: 'Tacos' }] })).rejects.toThrow(/Only whoever started/);
    await expect(edit(stranger, poll, { options: [{ id: o[0].id, label: 'Taberna' }, { label: 'Tacos' }] })).rejects.toThrow(/not found/);
    await expect(edit(null as unknown as string, poll, { options: [] })).rejects.toThrow(/permission denied/);
  });

  it('the organizer renames, reorders, adds and removes options; votes follow their option', async () => {
    await edit(ana, poll, {
      question: 'Where should we eat on Friday?',
      options: [{ id: o[2].id, label: 'Ramen bar' }, { id: o[0].id, label: 'Taberna da Rua' }, { label: 'Tacos' }],
    });
    const p = await db.query('select question, updated_at is not null as edited from public.trip_polls where id = $1', [poll]);
    expect(p.rows[0]).toEqual({ question: 'Where should we eat on Friday?', edited: true });
    expect((await options(poll)).map((x) => x.label)).toEqual(['Ramen bar', 'Taberna da Rua', 'Tacos']);
    // Pizza had no votes and is gone; Ana's and Ben's votes kept their (renamed) options.
    expect(await votes(poll)).toEqual(
      [
        { user_id: ana, label: 'Taberna da Rua' },
        { user_id: ben, label: 'Ramen bar' },
      ].sort((a, b) => a.user_id.localeCompare(b.user_id)),
    );
  });

  it('removing an option removes its votes', async () => {
    const now = await options(poll);
    await edit(cleo, poll, { question: 'Where should we eat on Friday?', options: [{ id: now[1].id, label: 'Taberna da Rua' }, { id: now[2].id, label: 'Tacos' }] });
    expect(await votes(poll)).toEqual([{ user_id: ana, label: 'Taberna da Rua' }]);
  });

  it('switching to more than one choice, then back, keeps each person’s first pick', async () => {
    const now = await options(poll);
    await edit(ana, poll, { question: 'Where?', options: now.map((x) => ({ id: x.id, label: x.label })), multiple: true });
    await vote(ana, poll, now[1].id); // Ana now has Taberna and Tacos
    await edit(ana, poll, { question: 'Where?', options: now.map((x) => ({ id: x.id, label: x.label })), multiple: false });
    expect(await votes(poll)).toEqual([{ user_id: ana, label: 'Taberna da Rua' }]);
  });

  it('checks the options and the closing time like a new poll does', async () => {
    const now = await options(poll);
    await expect(edit(ana, poll, { options: [{ id: now[0].id, label: 'Same' }] })).rejects.toThrow(/2 to 8/);
    await expect(edit(ana, poll, { options: [{ label: 'Tacos' }, { label: ' tacos ' }, { label: 'Pizza' }] })).rejects.toThrow(/same/);
    await expect(edit(ana, poll, { options: [{ label: 'a' }, { label: 'b' }], closesAt: new Date(Date.now() - 60_000).toISOString() })).rejects.toThrow(/future/);
  });

  it('can’t take over another poll’s option', async () => {
    const other = await newPoll(ana, 'Beach?', ['Yes', 'No']);
    const theirs = (await options(other))[0].id;
    const now = await options(poll);
    await expect(edit(ana, poll, { options: [{ id: theirs, label: 'Stolen' }, { id: now[0].id, label: now[0].label }] })).rejects.toThrow(/isn't part of this poll/);
    expect((await options(other)).map((x) => x.label)).toEqual(['Yes', 'No']);
  });

  it('sets or clears a closing time, and a closed poll can’t be edited', async () => {
    const now = await options(poll);
    const later = new Date(Date.now() + 3_600_000).toISOString();
    await edit(ana, poll, { question: 'Where?', options: now.map((x) => ({ id: x.id, label: x.label })), closesAt: later });
    expect((await db.query('select closes_at is not null as set from public.trip_polls where id = $1', [poll])).rows[0].set).toBe(true);
    await as(db, ana, (q) => q('select public.close_poll($1)', [poll]));
    await expect(edit(ana, poll, { question: 'Where?', options: now.map((x) => ({ id: x.id, label: x.label })) })).rejects.toThrow(/closed/);
  });

  it('options and polls still can’t be written directly', async () => {
    await expect(as(db, ana, (q) => q(`update public.trip_polls set question = 'x' where id = $1`, [poll]))).rejects.toThrow(/permission denied/);
    await expect(as(db, ana, (q) => q(`update public.poll_options set label = 'x' where poll_id = $1`, [poll]))).rejects.toThrow(/permission denied/);
  });
});

describe('destination map point', () => {
  it('the organizer saves it with the destination; both halves or neither', async () => {
    await as(db, ana, (q) => q(`update public.trips set destination = 'Lisbon, Portugal', destination_lat = 38.72, destination_lng = -9.14 where id = $1`, [trip]));
    const t = await as(db, cleo, (q) => q('select destination_lat, destination_lng from public.trips where id = $1', [trip]));
    expect(t.rows[0]).toEqual({ destination_lat: 38.72, destination_lng: -9.14 });
    await expect(as(db, ana, (q) => q('update public.trips set destination_lat = null where id = $1', [trip]))).rejects.toThrow(/destination_point_complete/);
    await expect(as(db, ana, (q) => q('update public.trips set destination_lat = 123, destination_lng = 0 where id = $1', [trip]))).rejects.toThrow(/check constraint/);
  });

  it('members who aren’t the organizer can’t change it', async () => {
    const r = await as(db, ben, (q) => q('update public.trips set destination_lat = 0, destination_lng = 0 where id = $1', [trip]));
    expect(r.rowCount).toBe(0);
  });
});
