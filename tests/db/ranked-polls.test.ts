/**
 * Ranked polls (migration 20261125000000_ranked_polls).
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let ana: string, ben: string, stranger: string, trip: string;
let poll: string;
let opt: Record<string, string>;

const ranks = async (user: string) =>
  (await db.query('select o.label, v.rank from public.poll_votes v join public.poll_options o on o.id = v.option_id where v.poll_id = $1 and v.user_id = $2 order by v.rank', [poll, user])).rows.map(
    (r) => `${r.rank}:${r.label}`,
  );

beforeAll(async () => {
  db = await startDb('tripley_ranked_polls');
  ana = await createUser(db, 'Ana');
  ben = await createUser(db, 'Ben');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, ana, [ben], 'Lisbon');
});

afterAll(async () => {
  await db?.end();
});

describe('ranked polls', () => {
  it('is made ranked in one step, and never also pick-several', async () => {
    poll = (await as(db, ben, (q) => q(`select public.create_ranked_poll($1, 'Where first?', array['Sintra','Belém','Cascais']) as id`, [trip]))).rows[0].id;
    expect((await db.query('select ranked, multiple from public.trip_polls where id = $1', [poll])).rows[0]).toEqual({ ranked: true, multiple: false });
    opt = Object.fromEntries((await db.query('select label, id from public.poll_options where poll_id = $1', [poll])).rows.map((r) => [r.label, r.id]));
    await expect(db.query('update public.trip_polls set multiple = true where id = $1', [poll])).rejects.toThrow(/ranked_single/);
  });

  it('people put the options in order; a new order replaces the old', async () => {
    await as(db, ana, (q) => q('select public.rank_poll($1, $2)', [poll, [opt['Belém'], opt.Sintra, opt.Cascais]]));
    expect(await ranks(ana)).toEqual(['1:Belém', '2:Sintra', '3:Cascais']);
    await as(db, ana, (q) => q('select public.rank_poll($1, $2)', [poll, [opt.Sintra, opt['Belém']]]));
    expect(await ranks(ana)).toEqual(['1:Sintra', '2:Belém']);
    await as(db, ana, (q) => q('select public.rank_poll($1, $2)', [poll, []]));
    expect(await ranks(ana)).toEqual([]);
  });

  it('refuses repeats, other polls’ options, plain votes, and strangers', async () => {
    await expect(as(db, ben, (q) => q('select public.rank_poll($1, $2)', [poll, [opt.Sintra, opt.Sintra]]))).rejects.toThrow(/once/);
    const other = (await as(db, ben, (q) => q(`select public.create_poll($1, 'Dinner?', array['A','B']) as id`, [trip]))).rows[0].id;
    const foreign = (await db.query('select id from public.poll_options where poll_id = $1 limit 1', [other])).rows[0].id;
    await expect(as(db, ben, (q) => q('select public.rank_poll($1, $2)', [poll, [foreign]]))).rejects.toThrow(/isn't one of the options/);
    await expect(as(db, ben, (q) => q('select public.vote_poll($1, $2)', [poll, opt.Sintra]))).rejects.toThrow(/in order/);
    await expect(as(db, ben, (q) => q('select public.rank_poll($1, $2)', [other, [foreign]]))).rejects.toThrow(/isn't ranked/);
    await expect(as(db, stranger, (q) => q('select public.rank_poll($1, $2)', [poll, [opt.Sintra]]))).rejects.toThrow(/not found/);
    await expect(as(db, ben, (q) => q(`insert into public.poll_votes (poll_id, option_id, trip_id, user_id, rank) values ($1, $2, $3, $4, 1)`, [poll, opt.Sintra, trip, ben]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('a ranked poll from bucket-list ideas keeps the link to each idea; closed polls take no more rankings', async () => {
    const ideas: string[] = [];
    for (const name of ['Tile museum', 'Fado night']) {
      ideas.push((await as(db, ben, (q) => q(`insert into public.trip_suggestions (trip_id, name, category) values ($1, $2, 'sight') returning id`, [trip, name]))).rows[0].id);
    }
    const fromIdeas = (await as(db, ana, (q) => q(`select public.create_ranked_poll_from_ideas($1, 'Which first?', $2) as id`, [trip, ideas]))).rows[0].id;
    const linked = (await db.query('select count(*)::int as n from public.poll_options where poll_id = $1 and suggestion_id is not null', [fromIdeas])).rows[0].n;
    expect(linked).toBe(2);
    expect((await db.query('select ranked from public.trip_polls where id = $1', [fromIdeas])).rows[0].ranked).toBe(true);
    await as(db, ben, (q) => q('select public.close_poll($1)', [poll]));
    await expect(as(db, ana, (q) => q('select public.rank_poll($1, $2)', [poll, [opt.Sintra]]))).rejects.toThrow(/closed/);
  });
});
