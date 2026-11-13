/**
 * Trip Fun (migrations 20261129000000_trip_fun_hub, 20261130000000_trip_fun_realtime,
 * 20261201000000_trip_fun_fixes, 20261202000000_trip_fun_complete).
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let ana: string, ben: string, cleo: string, stranger: string, trip: string, otherTrip: string;

type Extra = Record<string, unknown>;
const addEntry = (who: string, kind: string, title: string, extra: Extra = {}) => {
  const cols = ['trip_id', 'kind', 'title', 'created_by', ...Object.keys(extra)];
  const vals = [trip, kind, title, who, ...Object.values(extra)];
  return as(db, who, (q) =>
    q(
      `insert into public.trip_fun_entries (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       returning id, is_complete, completed_by, food_kind`,
      vals,
    ),
  );
};
const upload = (path: string, owner: string) =>
  db.query(`insert into storage.objects (bucket_id, name, owner) values ('trip-photos', $1, $2)`, [path, owner]);
const setFeature = (key: string, enabled: boolean) => db.query('update public.trip_feature_catalog set enabled = $2 where feature_key = $1', [key, enabled]);
const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  db = await startDb('tripley_trip_fun');
  ana = await createUser(db, 'Ana');
  ben = await createUser(db, 'Ben');
  cleo = await createUser(db, 'Cleo');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, ana, [ben, cleo], 'Lisbon');
  otherTrip = await createTrip(db, stranger, [], 'Elsewhere');
});

afterAll(async () => {
  await db?.end();
});

describe('Trip Fun activities', () => {
  it('members add food finds; strangers can’t add or see them', async () => {
    const r = await addEntry(ben, 'food', 'Pastel de nata', { place_name: 'Manteigaria' });
    expect(r.rows[0].food_kind).toBe('dish');
    await expect(addEntry(stranger, 'food', 'Sneaky')).rejects.toThrow(/row-level security|not a member/);
    expect((await as(db, stranger, (q) => q('select id from public.trip_fun_entries'))).rowCount).toBe(0);
  });

  it('a new activity starts not done, whatever the app sends', async () => {
    const r = await addEntry(ben, 'food', 'Ginjinha', { is_complete: true, completed_by: cleo });
    expect(r.rows[0]).toMatchObject({ is_complete: false, completed_by: null });
  });

  it('food photos must be your own upload in this trip’s folder', async () => {
    await upload(`${trip}/bens-tart.jpg`, ben);
    await upload(`${trip}/anas-photo.jpg`, ana);
    await upload(`${otherTrip}/elsewhere.jpg`, ben);
    expect((await addEntry(ben, 'food', 'Tart', { food_kind: 'restaurant', photo_path: `${trip}/bens-tart.jpg` })).rowCount).toBe(1);
    await expect(addEntry(ben, 'food', 'Not mine', { photo_path: `${trip}/anas-photo.jpg` })).rejects.toThrow(/couldn't be found/);
    await expect(addEntry(ben, 'food', 'Wrong trip', { photo_path: `${otherTrip}/elsewhere.jpg` })).rejects.toThrow(/couldn't be found/);
    await expect(addEntry(ben, 'food', 'Odd kind', { food_kind: 'snack' })).rejects.toThrow(/check constraint/);
  });

  it('songs take an https link; links and photos only where they belong', async () => {
    expect((await addEntry(cleo, 'soundtrack', 'Fado — Amália', { link_url: 'https://open.spotify.com/track/abc?si=1' })).rowCount).toBe(1);
    await expect(addEntry(cleo, 'soundtrack', 'Bad', { link_url: 'javascript:alert(1)' })).rejects.toThrow(/check constraint/);
    await expect(addEntry(cleo, 'soundtrack', 'Bad', { link_url: 'http://example.com/song' })).rejects.toThrow(/check constraint/);
    await expect(addEntry(cleo, 'food', 'Bad', { link_url: 'https://example.com' })).rejects.toThrow(/check constraint/);
  });

  it('details can’t be edited; checklist items now live in the scavenger hunt', async () => {
    const id = (await addEntry(cleo, 'soundtrack', 'Song', { link_url: 'https://music.example.com/a' })).rows[0].id;
    await expect(as(db, cleo, (q) => q(`update public.trip_fun_entries set link_url = 'https://evil.example.com' where id = $1`, [id]))).rejects.toThrow(
      /can't be edited/,
    );
    await expect(addEntry(ben, 'scavenger', 'Find street art')).rejects.toThrow(/Adventure Scavenger Hunt/);
  });

  it('secret missions are off; when on, only the sender and recipient see them and completion is server-set', async () => {
    await expect(addEntry(ana, 'mission', 'Get Ben to say “wow”', { assigned_to: cleo })).rejects.toThrow(/turned off/);
    await setFeature('secret_missions', true);
    try {
      const id = (await addEntry(ana, 'mission', 'Get Ben to say “wow”', { assigned_to: cleo })).rows[0].id;
      const seen = async (who: string) => (await as(db, who, (q) => q(`select id from public.trip_fun_entries where kind = 'mission'`))).rowCount;
      expect([await seen(ana), await seen(cleo), await seen(ben)]).toEqual([1, 1, 0]);
      await as(db, cleo, (q) => q('update public.trip_fun_entries set is_complete = true, completed_by = $2 where id = $1', [id, ben]));
      const row = (await db.query('select is_complete, completed_by, completed_at is not null as at from public.trip_fun_entries where id = $1', [id])).rows[0];
      expect(row).toEqual({ is_complete: true, completed_by: cleo, at: true });
      await expect(as(db, cleo, (q) => q('update public.trip_fun_entries set completed_by = $2 where id = $1', [id, ana]))).rejects.toThrow(/set by the database/);
      await expect(addEntry(ana, 'mission', 'To a stranger', { assigned_to: stranger })).rejects.toThrow(/row-level security|must be on this trip/);
    } finally {
      await setFeature('secret_missions', false);
    }
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
});

describe('Adventure Scavenger Hunt (the trip’s challenges)', () => {
  it('follows the feature catalogue', async () => {
    const start = () => as(db, ben, (q) => q(`select public.create_challenge($1, 'Find the best view', null, '🧭') as id`, [trip]));
    expect((await start()).rows[0].id).toBeTruthy();
    await setFeature('scavenger_hunt', false);
    try {
      await expect(start()).rejects.toThrow(/turned off/);
    } finally {
      await setFeature('scavenger_hunt', true);
    }
  });
});

describe('Digital Travel Scrapbook', () => {
  const addMemory = (who: string, caption: string, extra: Extra = {}, tripId = trip) => {
    const all: Extra = { trip_id: tripId, caption, happened_on: today(), ...extra };
    const cols = Object.keys(all);
    const vals = Object.values(all);
    return as(db, who, (q) =>
      q(`insert into public.trip_memories (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id, created_by`, vals),
    );
  };

  it('members add memories with their own photos; strangers can’t add or see them', async () => {
    await upload(`${trip}/sunset-1.jpg`, cleo);
    await upload(`${trip}/sunset-2.jpg`, cleo);
    const r = await addMemory(cleo, 'Sunset at Miradouro', { description: 'Everyone sang.', photo_paths: [`${trip}/sunset-1.jpg`, `${trip}/sunset-2.jpg`], created_by: ana });
    expect(r.rows[0].created_by).toBe(cleo);
    await expect(addMemory(cleo, 'Not mine', { photo_paths: [`${trip}/anas-photo.jpg`] })).rejects.toThrow(/couldn't be found/);
    await expect(addMemory(stranger, 'Sneaky')).rejects.toThrow(/row-level security|not in this trip/);
    expect((await as(db, stranger, (q) => q('select id from public.trip_memories'))).rowCount).toBe(0);
    expect((await as(db, ben, (q) => q('select id from public.trip_memories'))).rowCount).toBe(1);
  });

  it('a memory’s day can’t be in the future', async () => {
    await expect(addMemory(ben, 'Tomorrow', { happened_on: '2999-01-01' })).rejects.toThrow(/already happened/);
  });

  it('only the author edits; the organizer can remove', async () => {
    const id = (await addMemory(ben, 'Tram 28')).rows[0].id;
    await as(db, ben, (q) => q(`update public.trip_memories set caption = 'Tram 28, finally', description = 'Squeezed in.' where id = $1`, [id]));
    expect((await db.query('select caption from public.trip_memories where id = $1', [id])).rows[0].caption).toBe('Tram 28, finally');
    const byCleo = await as(db, cleo, (q) => q(`update public.trip_memories set caption = 'Hijacked' where id = $1`, [id]));
    expect(byCleo.rowCount).toBe(0);
    await expect(as(db, ben, (q) => q('update public.trip_memories set created_by = $2 where id = $1', [id, cleo]))).rejects.toThrow(/can change|row-level/);
    expect((await as(db, cleo, (q) => q('delete from public.trip_memories where id = $1', [id]))).rowCount).toBe(0);
    expect((await as(db, ana, (q) => q('delete from public.trip_memories where id = $1', [id]))).rowCount).toBe(1);
  });
});

describe('My Travel Passport', () => {
  const stamp = (who: string, place: string, extra: Extra = {}) => {
    const all: Extra = { place, visited_on: today(), ...extra };
    const cols = Object.keys(all);
    const vals = Object.values(all);
    return as(db, who, (q) =>
      q(`insert into public.passport_stamps (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id, user_id, country_code`, vals),
    );
  };

  it('stamps are yours alone, linked only to trips you’re on', async () => {
    const r = await stamp(ana, 'Lisbon', { country: 'Portugal', country_code: 'pt', trip_id: trip, user_id: ben });
    expect(r.rows[0]).toMatchObject({ user_id: ana, country_code: 'PT' });
    expect((await as(db, ben, (q) => q('select id from public.passport_stamps'))).rowCount).toBe(0);
    expect((await as(db, ana, (q) => q('select id from public.passport_stamps'))).rowCount).toBe(1);
    await expect(stamp(ana, 'Elsewhere', { trip_id: otherTrip })).rejects.toThrow(/trips you're on/);
    expect((await as(db, ben, (q) => q('delete from public.passport_stamps'))).rowCount).toBe(0);
  });

  it('no future visits, and the same place and day only once', async () => {
    await expect(stamp(ben, 'Mars', { visited_on: '2999-01-01' })).rejects.toThrow(/already happened/);
    await stamp(ben, 'Porto', { country: 'Portugal' });
    await expect(stamp(ben, ' porto ', { country: 'portugal' })).rejects.toThrow(/duplicate key/);
  });
});

describe('Deleting an account', () => {
  it('deletes that person’s memories and passport stamps', async () => {
    const dee = await createUser(db, 'Dee');
    await db.query('insert into public.trip_members (trip_id, user_id) values ($1, $2)', [trip, dee]);
    await as(db, dee, (q) => q(`insert into public.trip_memories (trip_id, caption, happened_on) values ($1, 'Dee was here', current_date)`, [trip]));
    await as(db, dee, (q) => q(`insert into public.passport_stamps (place, visited_on) values ('Sintra', current_date)`));
    await db.query('update public.profiles set deleted_at = now() where id = $1', [dee]);
    const left = await db.query(
      `select (select count(*) from public.trip_memories where created_by = $1)::int as memories, (select count(*) from public.passport_stamps where user_id = $1)::int as stamps`,
      [dee],
    );
    expect(left.rows[0]).toEqual({ memories: 0, stamps: 0 });
  });
});

describe('Access', () => {
  it('the plan check answers only for the person asking; helpers and triggers can’t be called by anyone', async () => {
    expect((await as(db, ben, (q) => q(`select public.trip_fun_feature_available('trip_awards', $1) as ok`, [ben]))).rows[0].ok).toBe(true);
    expect((await as(db, ben, (q) => q(`select public.trip_fun_feature_available('trip_awards', $1) as ok`, [ana]))).rows[0].ok).toBe(false);
    const callable = await db.query(
      `select r.rolname, p.proname from pg_proc p cross join (values ('anon'), ('authenticated')) r(rolname)
       where p.proname in ('guard_trip_fun_entry', 'guard_trip_fun_vote', 'trip_fun_feature_available', 'require_trip_fun_feature',
                           'guard_trip_memory', 'guard_passport_stamp', 'handle_profile_deleted_fun')
         and has_function_privilege(r.rolname, p.oid, 'execute')
       order by 1, 2`,
    );
    expect(callable.rows).toEqual([{ rolname: 'authenticated', proname: 'trip_fun_feature_available' }]);
    const anonTables = await db.query(
      `select table_name from information_schema.role_table_grants where grantee = 'anon' and table_name in ('trip_memories', 'passport_stamps')`,
    );
    expect(anonTables.rowCount).toBe(0);
  });
});
