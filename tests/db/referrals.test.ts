/**
 * Invite friends (migration 20261127000000_referrals).
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let ana: string, ben: string, old: string;
let code: string;

const bonus = async (u: string) => (await db.query('select bonus_pro_until > now() + interval \'29 days\' as yes from public.accounts where user_id = $1', [u])).rows[0]?.yes ?? false;

beforeAll(async () => {
  db = await startDb('tripley_referrals');
  ana = await createUser(db, 'Ana');
  ben = await createUser(db, 'Ben');
  old = await createUser(db, 'Old timer');
  await db.query(`update auth.users set created_at = now() - interval '30 days' where id = $1`, [old]);
});

afterAll(async () => {
  await db?.end();
});

describe('invite friends', () => {
  it('everyone gets one readable code, the same each time; only you see it', async () => {
    code = (await as(db, ana, (q) => q('select public.my_referral_code() as c'))).rows[0].c;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect((await as(db, ana, (q) => q('select public.my_referral_code() as c'))).rows[0].c).toBe(code);
    expect((await as(db, ben, (q) => q('select code from public.referral_codes'))).rowCount).toBe(0);
  });

  it('a new account links to whoever invited it; not your own code, not an old account, once', async () => {
    await expect(as(db, ana, (q) => q('select public.claim_referral($1)', [code]))).rejects.toThrow(/your own code/);
    await expect(as(db, old, (q) => q('select public.claim_referral($1)', [code]))).rejects.toThrow(/new accounts/);
    await expect(as(db, ben, (q) => q(`select public.claim_referral('WRONG234')`))).rejects.toThrow(/isn't right/);
    expect((await as(db, ben, (q) => q('select public.claim_referral($1) as r', [code.toLowerCase()]))).rows[0].r).toBe('linked');
    expect((await as(db, ben, (q) => q('select public.claim_referral($1) as r', [code]))).rows[0].r).toBe('already');
    expect(await bonus(ana)).toBe(false); // nothing until Ben actually plans a trip with someone
  });

  it('when Ben is on a trip with someone else, both get a month of Pro and are told', async () => {
    const trip = await createTrip(db, ben, [], 'Ben’s weekend');
    expect(await bonus(ben)).toBe(false); // alone on it
    const cleo = await createUser(db, 'Cleo');
    await db.query('insert into public.trip_members (trip_id, user_id) values ($1, $2)', [trip, cleo]);
    expect(await bonus(ana)).toBe(true);
    expect(await bonus(ben)).toBe(true);
    const told = (await db.query(`select user_id from public.notifications where kind = 'referral_reward' order by user_id`)).rows.map((r) => r.user_id);
    expect(told.sort()).toEqual([ana, ben].sort());
    // Only once.
    await db.query('insert into public.trip_members (trip_id, user_id) values ($1, $2)', [trip, await createUser(db, 'Dan')]);
    expect((await db.query(`select count(*)::int as n from public.notifications where kind = 'referral_reward'`)).rows[0].n).toBe(2);
  });

  it('a bonus month counts as Pro for AI reading', async () => {
    const trip = await createTrip(db, ben, [], 'Scan trip');
    const r = await as(db, 'service_role', (q) =>
      q(`select public.reserve_ai_scan($1, '00000000-0000-4000-8000-0000000000aa', $2, $3, 10, 100) as r`, [ben, trip, `${trip}/r.jpg`]),
    );
    expect(r.rows[0].r.status).toBe('reserved');
  });

  it('at most 6 rewards a year for whoever invites', async () => {
    for (let i = 0; i < 6; i++) {
      const friend = await createUser(db, `Friend ${i}`);
      await as(db, friend, (q) => q('select public.claim_referral($1)', [code]));
      const t = await createTrip(db, friend, [], `Trip ${i}`);
      await db.query('insert into public.trip_members (trip_id, user_id) values ($1, $2)', [t, await createUser(db, `Buddy ${i}`)]);
    }
    expect((await db.query('select count(*)::int as n from public.referrals where referrer_id = $1 and rewarded_at is not null', [ana])).rows[0].n).toBe(6);
  });
});
