/**
 * Trip Fun (migrations 20261129000000_trip_fun_hub, 20261130000000_trip_fun_realtime,
 * 20261201000000_trip_fun_fixes).
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let ana: string, ben: string, cleo: string, stranger: string, trip: string;

const addEntry = (who: string, kind: string, title: string, assignedTo: string | null = null, extra = '') =>
  as(db, who, (q) =>
    q(
      `insert into public.trip_fun_entries (trip_id, kind, title, created_by, assigned_to${extra ? ', is_complete, completed_by, completed_at' : ''})
       values ($1, $2, $3, $4, $5${extra ? `, ${extra}` : ''}) returning id, is_complete, completed_by`,
      [trip, kind, title, who, assignedTo],
    ),
  );

beforeAll(async () => {
  db = await startDb('tripley_trip_fun');
  ana = await createUser(db, 'Ana');
  ben = await createUser(db, 'Ben');
  cleo = await createUser(db, 'Cleo');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, ana, [ben, cleo], 'Lisbon');
});

afterAll(async () => {
  await db?.end();
});

describe('Trip Fun', () => {
  it('members add activities (the plan check works for signed-in people); strangers can’t', async () => {
    const r = await addEntry(ben, 'food', 'Pastel de nata at Manteigaria');
    expect(r.rowCount).toBe(1);
    await expect(addEntry(stranger, 'food', 'Sneaky')).rejects.toThrow(/row-level security|not a member/);
    expect((await as(db, stranger, (q) => q('select id from public.trip_fun_entries'))).rowCount).toBe(0);
  });

  it('a new activity starts not done, whatever the app sends', async () => {
    const r = await addEntry(ben, 'scavenger', 'Find street art', null, `true, '${cleo}', now() - interval '1 day'`);
    expect(r.rows[0]).toMatchObject({ is_complete: false, completed_by: null });
  });

  it('secret missions are seen only by the sender and the recipient', async () => {
    await addEntry(ana, 'mission', 'Get Ben to say “wow”', cleo);
    const seen = async (who: string) => (await as(db, who, (q) => q(`select id from public.trip_fun_entries where kind = 'mission'`))).rowCount;
    expect([await seen(ana), await seen(cleo), await seen(ben)]).toEqual([1, 1, 0]);
    await expect(addEntry(ana, 'mission', 'To a stranger', stranger)).rejects.toThrow(/row-level security|must be on this trip/);
  });

  it('completion is set by the database: who and when can’t be faked; details can’t be edited', async () => {
    const id = (await addEntry(ana, 'scavenger', 'Best view in town')).rows[0].id;
    await as(db, cleo, (q) => q('update public.trip_fun_entries set is_complete = true, completed_by = $2 where id = $1', [id, ben]));
    const row = (await db.query('select is_complete, completed_by, completed_at is not null as at from public.trip_fun_entries where id = $1', [id])).rows[0];
    expect(row).toEqual({ is_complete: true, completed_by: cleo, at: true });
    await expect(as(db, cleo, (q) => q('update public.trip_fun_entries set completed_by = $2 where id = $1', [id, ana]))).rejects.toThrow(/set by the database/);
    await expect(as(db, cleo, (q) => q(`update public.trip_fun_entries set title = 'Changed' where id = $1`, [id]))).rejects.toThrow(/can't be edited/);
  });

  it('award votes: not for yourself, only people on the trip, and only the nominee can change', async () => {
    await expect(
      as(db, ben, (q) => q(`insert into public.trip_fun_votes (trip_id, award_key, voter_id, nominee_id) values ($1, 'food_scout', $2, $2)`, [trip, ben])),
    ).rejects.toThrow(/check constraint|Invalid award vote/);
    await expect(
      as(db, ben, (q) => q(`insert into public.trip_fun_votes (trip_id, award_key, voter_id, nominee_id) values ($1, 'food_scout', $2, $3)`, [trip, ben, stranger])),
    ).rejects.toThrow(/row-level security|on this trip/);
    const vote = (
      await as(db, ben, (q) => q(`insert into public.trip_fun_votes (trip_id, award_key, voter_id, nominee_id) values ($1, 'food_scout', $2, $3) returning id`, [trip, ben, ana]))
    ).rows[0].id;
    await as(db, ben, (q) => q('update public.trip_fun_votes set nominee_id = $2 where id = $1', [vote, cleo]));
    await expect(as(db, ben, (q) => q(`update public.trip_fun_votes set award_key = 'photo_pro' where id = $1`, [vote]))).rejects.toThrow(/only change its nominee/);
  });

  it('the plan check answers only for the person asking; trigger functions can’t be called by anyone', async () => {
    expect((await as(db, ben, (q) => q(`select public.trip_fun_feature_available('trip_awards', $1) as ok`, [ben]))).rows[0].ok).toBe(true);
    expect((await as(db, ben, (q) => q(`select public.trip_fun_feature_available('trip_awards', $1) as ok`, [ana]))).rows[0].ok).toBe(false);
    const callable = await db.query(
      `select r.rolname, p.proname from pg_proc p cross join (values ('anon'), ('authenticated')) r(rolname)
       where p.proname in ('guard_trip_fun_entry', 'guard_trip_fun_vote', 'trip_fun_feature_available') and has_function_privilege(r.rolname, p.oid, 'execute')
       order by 1, 2`,
    );
    expect(callable.rows).toEqual([{ rolname: 'authenticated', proname: 'trip_fun_feature_available' }]);
  });
});
