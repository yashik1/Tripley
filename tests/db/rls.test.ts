/**
 * Database tests: run the real migration on a local Postgres (with a small
 * stand-in for Supabase's auth/storage schemas) and exercise the access rules
 * and server functions as different users.
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
let db: Client;

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;

/** Run `fn` inside a transaction as the given user (or anon when null). */
async function as<T>(uid: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    if (uid) {
      await db.query('set local role authenticated');
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    } else {
      await db.query('set local role anon');
    }
    const result = await fn((sql, params) => db.query(sql, params as any[]));
    await db.query('commit');
    return result;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}

async function createUser(name: string, phone?: string, email?: string): Promise<string> {
  const { rows } = await db.query(
    `insert into auth.users (phone, email, raw_user_meta_data) values ($1, $2, $3) returning id`,
    [phone ?? null, email ?? null, JSON.stringify({ full_name: name })],
  );
  return rows[0].id;
}

let maya: string, sam: string, lee: string, stranger: string;
let tripId: string, inviteCode: string;

beforeAll(async () => {
  const out = execFileSync(path.join(ROOT, 'scripts/test-db.sh'), ['start'], { encoding: 'utf8' });
  const url = out.trim().split('\n').pop()!;
  const u = new URL(url);
  db = new Client({
    host: u.searchParams.get('host') ?? undefined,
    port: Number(u.port),
    user: 'postgres',
    database: u.pathname.slice(1),
  });
  await db.connect();
  maya = await createUser('Maya', '15550000001', 'maya@example.com');
  sam = await createUser('Sam', '15550000002', 'sam@example.com');
  lee = await createUser('Lee', '447700900003', 'lee@example.com');
  stranger = await createUser('Stranger', '15550000009');
});

afterAll(async () => {
  await db?.end();
});

describe('sign-up', () => {
  it('creates a profile and a free account for every new user', async () => {
    const { rows } = await db.query('select display_name from public.profiles where id = $1', [maya]);
    expect(rows[0].display_name).toBe('Maya');
    const acc = await db.query('select plan from public.accounts where user_id = $1', [maya]);
    expect(acc.rows[0].plan).toBe('free');
  });

  it('lets users edit their name but not their plan', async () => {
    await as(maya, (q) => q(`update public.profiles set display_name = 'Maya R' where id = $1`, [maya]));
    await expect(
      as(maya, (q) => q(`update public.accounts set plan = 'pro' where user_id = $1`, [maya])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('trips and invites', () => {
  it('organizer creates a trip and becomes a member', async () => {
    const trip = await as(maya, (q) =>
      q(`insert into public.trips (name, base_currency) values ('Goa', 'INR') returning id, invite_code`),
    );
    tripId = trip.rows[0].id;
    inviteCode = trip.rows[0].invite_code;
    const members = await as(maya, (q) => q('select user_id, role from public.trip_members where trip_id = $1', [tripId]));
    expect(members.rows).toEqual([{ user_id: maya, role: 'organizer' }]);
  });

  it('strangers cannot see the trip', async () => {
    const r = await as(stranger, (q) => q('select * from public.trips where id = $1', [tripId]));
    expect(r.rowCount).toBe(0);
  });

  it('shows a preview for the invite link, even before sign-in', async () => {
    const r = await as(null, (q) => q('select name, organizer_name, member_count, is_member from public.trip_preview($1)', [inviteCode]));
    expect(r.rows[0]).toMatchObject({ name: 'Goa', organizer_name: 'Maya R', member_count: 1, is_member: false });
    const bad = await as(null, (q) => q('select * from public.trip_preview($1)', ['nope']));
    expect(bad.rowCount).toBe(0);
  });

  it('anon cannot read tables directly', async () => {
    await expect(as(null, (q) => q('select * from public.trips'))).rejects.toThrow(/permission denied/);
  });

  it('joins with the invite link', async () => {
    const r = await as(sam, (q) => q('select public.join_trip_by_code($1) as id', [inviteCode.toUpperCase()]));
    expect(r.rows[0].id).toBe(tripId);
    const seen = await as(sam, (q) => q('select name from public.trips where id = $1', [tripId]));
    expect(seen.rows[0].name).toBe('Goa');
    // Joining twice is harmless.
    await as(sam, (q) => q('select public.join_trip_by_code($1)', [inviteCode]));
  });

  it('notifies the organizer when someone joins', async () => {
    const r = await as(maya, (q) => q(`select body from public.notifications where kind = 'member_joined'`));
    expect(r.rows.map((x) => x.body)).toContain('Sam joined the trip');
  });

  it('invites by phone number without revealing who it is', async () => {
    const r = await as(maya, (q) => q('select public.invite_by_phone($1, $2) as s', [tripId, '+44 7700 900003']));
    expect(r.rows[0].s).toBe('invited');
    const again = await as(maya, (q) => q('select public.invite_by_phone($1, $2) as s', [tripId, '+447700900003']));
    expect(again.rows[0].s).toBe('already_invited');
    const unknown = await as(maya, (q) => q('select public.invite_by_phone($1, $2) as s', [tripId, '+1 555 123 4567']));
    expect(unknown.rows[0].s).toBe('not_found');
    const member = await as(maya, (q) => q('select public.invite_by_phone($1, $2) as s', [tripId, '+15550000002']));
    expect(member.rows[0].s).toBe('already_member');
  });

  it('only trip members can invite', async () => {
    await expect(
      as(stranger, (q) => q('select public.invite_by_phone($1, $2)', [tripId, '+15550000001'])),
    ).rejects.toThrow(/not in this trip/);
  });

  it('invitee sees and accepts the invitation', async () => {
    const inv = await as(lee, (q) => q('select * from public.my_invitations()'));
    expect(inv.rows[0]).toMatchObject({ trip_name: 'Goa', invited_by_name: 'Maya R' });
    const note = await as(lee, (q) => q(`select body from public.notifications where kind = 'invitation'`));
    expect(note.rows[0].body).toBe('Maya R invited you to Goa');
    // Invitee can see the inviter's profile before joining.
    const p = await as(lee, (q) => q('select display_name from public.profiles where id = $1', [maya]));
    expect(p.rowCount).toBe(1);
    await as(lee, (q) => q('select public.respond_to_invitation($1, true)', [inv.rows[0].invitation_id]));
    const members = await as(lee, (q) => q('select count(*)::int as n from public.trip_members where trip_id = $1', [tripId]));
    expect(members.rows[0].n).toBe(3);
  });

  it('profiles are only visible to people you travel with', async () => {
    const r = await as(stranger, (q) => q('select id from public.profiles where id = any($1)', [[maya, sam, lee]]));
    expect(r.rowCount).toBe(0);
    const friends = await as(sam, (q) => q('select user_id from public.my_trip_friends()'));
    expect(friends.rows.map((x) => x.user_id).sort()).toEqual([maya, lee].sort());
  });

  it('only the organizer can rename the trip or regenerate the link', async () => {
    await expect(
      as(sam, async (q) => {
        const r = await q(`update public.trips set name = 'Hacked' where id = $1`, [tripId]);
        if (r.rowCount === 0) throw new Error('no rows updated');
      }),
    ).rejects.toThrow(/no rows updated/);
    await expect(as(sam, (q) => q('select public.regenerate_invite_code($1)', [tripId]))).rejects.toThrow(/organizer/);
    const r = await as(maya, (q) => q('select public.regenerate_invite_code($1) as c', [tripId]));
    expect(r.rows[0].c).not.toBe(inviteCode);
    await expect(
      as(null, async (q) => {
        const p = await q('select * from public.trip_preview($1)', [inviteCode]);
        if (p.rowCount === 0) throw new Error('old link no longer works');
      }),
    ).rejects.toThrow(/old link/);
    await expect(
      as(maya, (q) => q(`update public.trips set invite_code = 'chosen' where id = $1`, [tripId])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('live locations', () => {
  const upsert = (uid: string, lat: number, lng: number) =>
    as(uid, (q) =>
      q(
        `insert into public.member_locations (trip_id, user_id, lat, lng, accuracy_m)
         values ($1, $2, $3, $4, 10)
         on conflict (trip_id, user_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now()`,
        [tripId, uid, lat, lng],
      ),
    );

  it('members share and see each other', async () => {
    await upsert(sam, 15.5, 73.8);
    await upsert(sam, 15.51, 73.81);
    const r = await as(maya, (q) => q('select user_id, lat from public.member_locations where trip_id = $1', [tripId]));
    expect(r.rows).toEqual([{ user_id: sam, lat: 15.51 }]);
  });

  it('nobody can write someone else’s location', async () => {
    await expect(
      as(sam, (q) =>
        q(`insert into public.member_locations (trip_id, user_id, lat, lng) values ($1, $2, 0, 0)`, [tripId, maya]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('strangers can’t read or write', async () => {
    const r = await as(stranger, (q) => q('select * from public.member_locations'));
    expect(r.rowCount).toBe(0);
    await expect(upsert(stranger, 1, 1)).rejects.toThrow();
  });

  it('pausing sharing hides the dot and blocks updates', async () => {
    await as(sam, (q) => q('update public.trip_members set location_sharing = false where trip_id = $1 and user_id = $2', [tripId, sam]));
    const r = await as(maya, (q) => q('select * from public.member_locations where trip_id = $1', [tripId]));
    expect(r.rowCount).toBe(0);
    await expect(upsert(sam, 15.5, 73.8)).rejects.toThrow(/row-level security/);
    await as(sam, (q) => q('update public.trip_members set location_sharing = true where trip_id = $1 and user_id = $2', [tripId, sam]));
    await upsert(sam, 15.5, 73.8);
  });

  it('members cannot change their own role', async () => {
    await expect(
      as(sam, (q) => q(`update public.trip_members set role = 'organizer' where trip_id = $1 and user_id = $2`, [tripId, sam])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('bills', () => {
  // Dinner in INR paid by Maya: pizza shared by all three, beer for Sam, tax 300.
  const dinner = () => ({
    trip_id: tripId,
    paid_by: maya,
    title: 'Dinner at Britto’s',
    currency: 'INR',
    split_mode: 'itemized',
    tax_minor: 300_00,
    total_minor: 3600_00,
    total_base_minor: 3600_00,
    items: [
      { name: 'Pizza', line_total_minor: 2400_00, shares: [maya, sam, lee].map((user_id) => ({ user_id, weight: 1 })) },
      { name: 'Beer', line_total_minor: 900_00, shares: [{ user_id: sam, weight: 1 }] },
    ],
    shares: [
      { user_id: maya, amount_minor: 872_73, amount_base_minor: 872_73 },
      { user_id: sam, amount_minor: 1854_54, amount_base_minor: 1854_54 },
      { user_id: lee, amount_minor: 872_73, amount_base_minor: 872_73 },
    ],
  });
  let billId: string;

  it('saves an itemized bill with items, who-had-what and shares', async () => {
    const r = await as(maya, (q) => q('select public.save_bill($1) as id', [JSON.stringify(dinner())]));
    billId = r.rows[0].id;
    const shares = await as(lee, (q) => q('select user_id, amount_base_minor::int from public.bill_shares where bill_id = $1 order by amount_base_minor', [billId]));
    expect(shares.rowCount).toBe(3);
    const items = await as(lee, (q) =>
      q(
        `select i.name, count(s.user_id)::int as people from public.bill_items i
         join public.bill_item_shares s on s.item_id = i.id where i.bill_id = $1 group by i.name, i.position order by i.position`,
        [billId],
      ),
    );
    expect(items.rows).toEqual([{ name: 'Pizza', people: 3 }, { name: 'Beer', people: 1 }]);
  });

  it('notifies people who owe, but not the payer', async () => {
    const sams = await as(sam, (q) => q(`select body from public.notifications where kind = 'bill_added'`));
    expect(sams.rows[0].body).toBe('Maya R added "Dinner at Britto’s" · your share 1,854.54 INR');
    const mayas = await as(maya, (q) => q(`select * from public.notifications where kind = 'bill_added'`));
    expect(mayas.rowCount).toBe(0);
  });

  it('rejects totals that do not add up', async () => {
    const bad = { ...dinner(), total_minor: 3700_00, total_base_minor: 3700_00 };
    await expect(as(maya, (q) => q('select public.save_bill($1)', [JSON.stringify(bad)]))).rejects.toThrow(/doesn.t match/);
    const badShares = dinner();
    badShares.shares[0].amount_minor -= 1;
    badShares.shares[0].amount_base_minor -= 1;
    await expect(as(maya, (q) => q('select public.save_bill($1)', [JSON.stringify(badShares)]))).rejects.toThrow(/add up/);
  });

  it('rejects people who are not in the trip', async () => {
    const bad = dinner();
    bad.shares[2].user_id = stranger;
    await expect(as(maya, (q) => q('select public.save_bill($1)', [JSON.stringify(bad)]))).rejects.toThrow(/must be in the trip/);
    await expect(as(stranger, (q) => q('select public.save_bill($1)', [JSON.stringify(dinner())]))).rejects.toThrow(/not in this trip/);
  });

  it('cannot write bills directly, only through save_bill', async () => {
    await expect(
      as(maya, (q) => q(`update public.bills set total_minor = 1 where id = $1`, [billId])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(maya, (q) => q(`insert into public.bill_shares (bill_id, user_id, amount_minor, amount_base_minor) values ($1, $2, 1, 1)`, [billId, stranger])),
    ).rejects.toThrow(/permission denied/);
  });

  it('converts foreign-currency bills with the exchange rate', async () => {
    const taxi = {
      trip_id: tripId,
      paid_by: sam,
      title: 'Taxi',
      currency: 'EUR',
      fx_rate: 95.5,
      split_mode: 'equal',
      total_minor: 30_00,
      total_base_minor: 2865_00,
      shares: [
        { user_id: maya, amount_minor: 10_00, amount_base_minor: 955_00 },
        { user_id: sam, amount_minor: 10_00, amount_base_minor: 955_00 },
        { user_id: lee, amount_minor: 10_00, amount_base_minor: 955_00 },
      ],
    };
    await as(sam, (q) => q('select public.save_bill($1)', [JSON.stringify(taxi)]));
    const wrongRate = { ...taxi, total_base_minor: 2000_00, shares: taxi.shares.map((s) => ({ ...s, amount_base_minor: s.user_id === maya ? 66_668 : 66_666 })) };
    await expect(as(sam, (q) => q('select public.save_bill($1)', [JSON.stringify(wrongRate)]))).rejects.toThrow(/exchange rate/);
  });

  it('only the creator, payer or organizer can edit or delete', async () => {
    const edit = { ...dinner(), id: billId, title: 'Dinner (edited)' };
    await expect(as(lee, (q) => q('select public.save_bill($1)', [JSON.stringify(edit)]))).rejects.toThrow(/Only the person/);
    await as(maya, (q) => q('select public.save_bill($1)', [JSON.stringify(edit)]));
    const r = await as(lee, (q) => q('select title from public.bills where id = $1', [billId]));
    expect(r.rows[0].title).toBe('Dinner (edited)');
    const del = await as(lee, (q) => q('delete from public.bills where id = $1', [billId]));
    expect(del.rowCount).toBe(0);
  });

  it('locks the trip currency once bills exist', async () => {
    await expect(
      as(maya, (q) => q(`update public.trips set base_currency = 'USD' where id = $1`, [tripId])),
    ).rejects.toThrow(/permission denied|can.t be changed/);
  });
});

describe('settling up', () => {
  let settlementId: string;

  it('the person who owes marks a payment as paid', async () => {
    const r = await as(lee, (q) =>
      q(`insert into public.settlements (trip_id, to_user, amount_base_minor, method) values ($1, $2, 872_73, 'upi') returning id, from_user`, [tripId, maya]),
    );
    settlementId = r.rows[0].id;
    expect(r.rows[0].from_user).toBe(lee);
    const note = await as(maya, (q) => q(`select body from public.notifications where kind = 'settlement_paid'`));
    expect(note.rows[0].body).toBe('Lee marked 872.73 INR as paid to you. Tap to confirm.');
  });

  it('nobody can record a payment on someone else’s behalf', async () => {
    await expect(
      as(lee, (q) => q(`insert into public.settlements (trip_id, from_user, to_user, amount_base_minor) values ($1, $2, $3, 100)`, [tripId, sam, maya])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(lee, (q) => q(`insert into public.settlements (trip_id, to_user, amount_base_minor) values ($1, $2, 100)`, [tripId, stranger])),
    ).rejects.toThrow(/must be in the trip/);
  });

  it('only the receiver can confirm or dispute', async () => {
    await expect(as(lee, (q) => q(`select public.respond_to_settlement($1, 'confirmed')`, [settlementId]))).rejects.toThrow(/not found/);
    await expect(as(lee, (q) => q(`update public.settlements set status = 'confirmed' where id = $1`, [settlementId]))).rejects.toThrow(/permission denied/);
    await as(maya, (q) => q(`select public.respond_to_settlement($1, 'confirmed')`, [settlementId]));
    const note = await as(lee, (q) => q(`select body from public.notifications where kind = 'settlement_confirmed'`));
    expect(note.rows[0].body).toBe('Maya R confirmed your payment of 872.73 INR');
  });

  it('the receiver can record a cash payment, which counts as confirmed', async () => {
    const r = await as(maya, (q) => q(`select public.record_payment_received($1, $2, 500_00, 'cash') as id`, [tripId, sam]));
    const row = await as(sam, (q) => q('select from_user, to_user, status from public.settlements where id = $1', [r.rows[0].id]));
    expect(row.rows[0]).toEqual({ from_user: sam, to_user: maya, status: 'confirmed' });
    const note = await as(sam, (q) => q(`select body from public.notifications where kind = 'settlement_recorded'`));
    expect(note.rows[0].body).toBe('Maya R recorded that you paid them 500.00 INR');
    await expect(as(stranger, (q) => q(`select public.record_payment_received($1, $2, 100)`, [tripId, sam]))).rejects.toThrow(/not in this trip/);
    await expect(as(maya, (q) => q(`select public.record_payment_received($1, $2, 100)`, [tripId, stranger]))).rejects.toThrow(/must be in the trip/);
  });

  it('a confirmed payment can no longer be undone by the payer', async () => {
    const r = await as(lee, (q) => q('delete from public.settlements where id = $1', [settlementId]));
    expect(r.rowCount).toBe(0);
  });
});

describe('storage and notifications', () => {
  it('only trip members can upload receipts into the trip folder', async () => {
    await as(sam, (q) => q(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${tripId}/r1.jpg`]));
    await expect(
      as(stranger, (q) => q(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${tripId}/r2.jpg`])),
    ).rejects.toThrow(/row-level security/);
    const seen = await as(stranger, (q) => q(`select * from storage.objects where bucket_id = 'receipts'`));
    expect(seen.rowCount).toBe(0);
    const member = await as(lee, (q) => q(`select * from storage.objects where bucket_id = 'receipts'`));
    expect(member.rowCount).toBe(1);
  });

  it('avatars go in your own folder only', async () => {
    await as(sam, (q) => q(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${sam}/a.jpg`]));
    await expect(
      as(sam, (q) => q(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${maya}/a.jpg`])),
    ).rejects.toThrow(/row-level security/);
  });

  it('users only see and clear their own notifications', async () => {
    const theirs = await as(stranger, (q) => q('select * from public.notifications'));
    expect(theirs.rowCount).toBe(0);
    await as(maya, (q) => q('select public.mark_notifications_read()'));
    const unread = await as(maya, (q) => q('select count(*)::int as n from public.notifications where read_at is null'));
    expect(unread.rows[0].n).toBe(0);
    await expect(
      as(maya, (q) => q(`insert into public.notifications (user_id, kind, title, body) values ($1, 'x', 'x', 'x')`, [sam])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('ending a trip', () => {
  it('stops location sharing once the trip has ended', async () => {
    await as(maya, (q) => q('update public.trips set ended_at = now() where id = $1', [tripId]));
    await expect(
      as(sam, (q) =>
        q(
          `insert into public.member_locations (trip_id, user_id, lat, lng) values ($1, $2, 1, 1)
           on conflict (trip_id, user_id) do update set lat = 1`,
          [tripId, sam],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    // Ending the trip deletes everyone's last position straight away.
    const left = await db.query('select count(*)::int as n from public.member_locations where trip_id = $1', [tripId]);
    expect(left.rows[0].n).toBe(0);
    // Trips that just run past their end date are cleaned up by the scheduled job.
    await db.query(`update public.trips set ended_at = null, ends_on = current_date - 5 where id = $1`, [tripId]);
    await db.query(`insert into public.member_locations (trip_id, user_id, lat, lng) values ($1, $2, 1, 1)`, [tripId, sam]);
    const { rows } = await db.query('select public.purge_ended_trip_locations() as n');
    expect(rows[0].n).toBe(1);
    await db.query(`update public.trips set ended_at = now() - interval '2 days', ends_on = null where id = $1`, [tripId]);
  });

  it('the invite link stops working', async () => {
    const code = (await db.query('select invite_code from public.trips where id = $1', [tripId])).rows[0].invite_code;
    const r = await as(null, (q) => q('select * from public.trip_preview($1)', [code]));
    expect(r.rowCount).toBe(0);
    await expect(as(stranger, (q) => q('select public.join_trip_by_code($1)', [code]))).rejects.toThrow(/not valid/);
  });
});

describe('stale location reminders', () => {
  it('reminds people whose dot has gone stale, at most once every few hours', async () => {
    const t = await as(maya, (q) => q(`insert into public.trips (name, base_currency) values ('Lisbon', 'EUR') returning id, invite_code`));
    const lisbon = t.rows[0].id;
    await as(sam, (q) => q('select public.join_trip_by_code($1)', [t.rows[0].invite_code]));
    await as(sam, (q) => q('insert into public.member_locations (trip_id, user_id, lat, lng) values ($1, $2, 38.7, -9.1)', [lisbon, sam]));
    await as(maya, (q) => q('insert into public.member_locations (trip_id, user_id, lat, lng) values ($1, $2, 38.7, -9.1)', [lisbon, maya]));
    // Sam's dot is 3 hours old; Maya's is fresh.
    await db.query(`update public.member_locations set updated_at = now() - interval '3 hours' where trip_id = $1 and user_id = $2`, [lisbon, sam]);

    const first = await db.query('select public.nudge_stale_sharers() as n');
    expect(first.rows[0].n).toBe(1);
    const note = await as(sam, (q) => q(`select body from public.notifications where kind = 'location_stale'`));
    expect(note.rows[0].body).toBe('Your friends last saw you 3 h ago. Open Tripley to keep sharing your location.');
    const again = await db.query('select public.nudge_stale_sharers() as n');
    expect(again.rows[0].n).toBe(0);

    // Battery saver mode tolerates longer gaps.
    await db.query(`update public.trip_members set last_nudged_at = null, sharing_mode = 'saver' where trip_id = $1 and user_id = $2`, [lisbon, sam]);
    const saver = await db.query('select public.nudge_stale_sharers() as n');
    expect(saver.rows[0].n).toBe(0);
  });

  it('is not callable by app users', async () => {
    await expect(as(maya, (q) => q('select public.nudge_stale_sharers()'))).rejects.toThrow(/permission denied/);
  });
});

describe('places and arrival alerts', () => {
  let rome: string;
  let hotel: string;
  const move = (uid: string, lat: number, lng: number) =>
    as(uid, (q) =>
      q(
        `insert into public.member_locations (trip_id, user_id, lat, lng, accuracy_m)
         values ($1, $2, $3, $4, 10)
         on conflict (trip_id, user_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now()`,
        [rome, uid, lat, lng],
      ),
    );
  const arrivals = (uid: string) =>
    as(uid, (q) => q(`select body from public.notifications where kind = 'arrival' and trip_id = $1 order by created_at`, [rome]));

  beforeAll(async () => {
    const t = await as(maya, (q) => q(`insert into public.trips (name, base_currency) values ('Rome', 'EUR') returning id, invite_code`));
    rome = t.rows[0].id;
    for (const u of [sam, lee]) await as(u, (q) => q('select public.join_trip_by_code($1)', [t.rows[0].invite_code]));
  });

  it('members pin places; strangers can’t see them', async () => {
    const r = await as(sam, (q) =>
      q(
        `insert into public.trip_places (trip_id, kind, name, lat, lng, radius_m, alerts)
         values ($1, 'stay', 'Hotel Artemide', 41.9, 12.49, 100, true) returning id`,
        [rome],
      ),
    );
    hotel = r.rows[0].id;
    await as(lee, (q) =>
      q(`insert into public.trip_places (trip_id, kind, name, note, lat, lng) values ($1, 'food', 'Roscioli', 'Best carbonara', 41.894, 12.473)`, [rome]),
    );
    const seen = await as(maya, (q) => q('select name from public.trip_places where trip_id = $1 order by name', [rome]));
    expect(seen.rows.map((x) => x.name)).toEqual(['Hotel Artemide', 'Roscioli']);
    expect((await as(stranger, (q) => q('select * from public.trip_places'))).rowCount).toBe(0);
    await expect(
      as(stranger, (q) => q(`insert into public.trip_places (trip_id, name, lat, lng) values ($1, 'x', 0, 0)`, [rome])),
    ).rejects.toThrow(/row-level security/);
  });

  it('only the person who pinned it or the organizer can remove it', async () => {
    const r = await as(lee, (q) => q(`delete from public.trip_places where name = 'Hotel Artemide'`));
    expect(r.rowCount).toBe(0);
    const tmp = await as(lee, (q) => q(`insert into public.trip_places (trip_id, name, lat, lng) values ($1, 'Tmp', 1, 1) returning id`, [rome]));
    const del = await as(maya, (q) => q('delete from public.trip_places where id = $1', [tmp.rows[0].id]));
    expect(del.rowCount).toBe(1);
  });

  it('photos must live in the trip’s folder', async () => {
    await expect(
      as(lee, (q) => q(`update public.trip_places set photo_path = 'other-trip/x.jpg' where name = 'Roscioli'`)),
    ).rejects.toThrow(/check constraint/);
    await as(lee, (q) => q(`update public.trip_places set photo_path = $1 where name = 'Roscioli'`, [`${rome}/carbonara.jpg`]));
  });

  it('tells the others when someone arrives, not where they already were', async () => {
    await as(lee, (q) => q('update public.trip_members set arrival_alerts = false where trip_id = $1 and user_id = $2', [rome, lee]));
    await move(maya, 41.9, 12.49); // first position, already at the hotel: no alert
    await move(sam, 41.95, 12.49); // ~5.5 km away
    expect((await arrivals(sam)).rowCount).toBe(0);
    await move(sam, 41.9004, 12.49); // ~45 m from the hotel
    expect((await arrivals(maya)).rows.map((x) => x.body)).toEqual(['Sam arrived at Hotel Artemide']);
    expect((await arrivals(lee)).rowCount).toBe(0); // turned alerts off
    expect((await arrivals(sam)).rowCount).toBe(0); // not told about yourself
  });

  it('doesn’t repeat when someone steps out and back within half an hour', async () => {
    await move(sam, 41.9012, 12.49); // ~130 m: still "inside" (leaves only past 1.5 × radius)
    await move(sam, 41.95, 12.49);
    await move(sam, 41.9004, 12.49);
    expect((await arrivals(maya)).rowCount).toBe(1);
    await db.query(`update public.place_presence set last_alert_at = now() - interval '31 minutes' where place_id = $1`, [hotel]);
    await move(sam, 41.95, 12.49);
    await move(sam, 41.9004, 12.49);
    expect((await arrivals(maya)).rowCount).toBe(2);
  });

  it('keeps who-is-where state away from app users', async () => {
    await expect(as(maya, (q) => q('select * from public.place_presence'))).rejects.toThrow(/permission denied/);
  });
});

describe('cash kitty', () => {
  let trip: string;
  let kitty: string;
  const cash = async () => (await db.query('select public.kitty_cash($1)::int as c', [kitty])).rows[0].c;
  const kittyBill = (paidBy: string, total: number) => ({
    trip_id: trip,
    paid_by: paidBy,
    kitty_id: kitty,
    title: 'Taxi',
    currency: 'EUR',
    split_mode: 'equal',
    total_minor: total,
    total_base_minor: total,
    shares: [
      { user_id: maya, amount_minor: total / 2, amount_base_minor: total / 2 },
      { user_id: lee, amount_minor: total / 2, amount_base_minor: total / 2 },
    ],
  });

  beforeAll(async () => {
    trip = (await db.query(`select id from public.trips where name = 'Rome'`)).rows[0].id;
  });

  it('anyone on the trip starts a kitty and picks who holds it', async () => {
    const r = await as(maya, (q) => q(`select public.create_kitty($1, 'Cash', $2) as id`, [trip, sam]));
    kitty = r.rows[0].id;
    const n = await as(sam, (q) => q(`select body from public.notifications where kind = 'kitty_holder'`));
    expect(n.rows[0].body).toBe('Maya R made you the holder of the "Cash" cash kitty');
    await expect(as(stranger, (q) => q(`select public.create_kitty($1, 'x', $2)`, [trip, stranger]))).rejects.toThrow(/not in this trip/);
  });

  it('putting cash in: the holder confirms, or records it themselves', async () => {
    const lees = await as(lee, (q) => q('select public.kitty_add_cash($1, $2, 5000) as id', [kitty, lee]));
    const s1 = await db.query('select status, to_user, kitty_role from public.settlements where id = $1', [lees.rows[0].id]);
    expect(s1.rows[0]).toEqual({ status: 'paid', to_user: sam, kitty_role: 'contribution' });
    const ask = await as(sam, (q) => q(`select body from public.notifications where kind = 'settlement_paid' order by created_at desc limit 1`));
    expect(ask.rows[0].body).toBe('Lee put 50.00 EUR in the kitty. Tap to confirm you got it.');
    await as(sam, (q) => q(`select public.respond_to_settlement($1, 'confirmed')`, [lees.rows[0].id]));

    await as(sam, (q) => q('select public.kitty_add_cash($1, $2, 5000)', [kitty, maya])); // holder records Maya's cash
    await as(sam, (q) => q(`select public.kitty_add_cash($1, $2, 2000, 'my own cash')`, [kitty, sam])); // holder's own money
    expect(await cash()).toBe(12000);

    await expect(as(lee, (q) => q('select public.kitty_add_cash($1, $2, 100)', [kitty, maya]))).rejects.toThrow(/holder or the person/);
    await expect(as(maya, (q) => q('select public.kitty_add_cash($1, $2, 100)', [kitty, sam]))).rejects.toThrow(/Only the holder/);
  });

  it('kitty moves can’t be faked with a plain payment', async () => {
    await expect(
      as(lee, (q) =>
        q(`insert into public.settlements (trip_id, to_user, amount_base_minor, kitty_id, kitty_role) values ($1, $2, 100, $3, 'contribution')`, [trip, sam, kitty]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('spending from the kitty is a bill paid by the holder', async () => {
    await expect(as(maya, (q) => q('select public.save_bill($1)', [JSON.stringify(kittyBill(maya, 3000))]))).rejects.toThrow(/person holding it/);
    await as(maya, (q) => q('select public.save_bill($1)', [JSON.stringify(kittyBill(sam, 3000))]));
    expect(await cash()).toBe(9000);
    const n = await as(lee, (q) => q(`select body from public.notifications where kind = 'bill_added' and trip_id = $1`, [trip]));
    expect(n.rows[0].body).toContain('(paid from the kitty)');
  });

  it('handing over moves all the cash to the new holder', async () => {
    await expect(as(lee, (q) => q('select public.kitty_handover($1, $2)', [kitty, lee]))).rejects.toThrow(/holding the kitty/);
    await as(sam, (q) => q('select public.kitty_handover($1, $2)', [kitty, lee]));
    const k = await db.query('select holder_id from public.trip_kitties where id = $1', [kitty]);
    expect(k.rows[0].holder_id).toBe(lee);
    const h = await db.query(`select from_user, to_user, amount_base_minor::int as a, status from public.settlements where kitty_role = 'handover'`);
    expect(h.rows).toEqual([{ from_user: sam, to_user: lee, a: 9000, status: 'confirmed' }]);
    const n = await as(lee, (q) => q(`select body from public.notifications where kind = 'kitty_holder'`));
    expect(n.rows[0].body).toBe('Sam handed you the "Cash" kitty (90.00 EUR in cash)');
    expect(await cash()).toBe(9000);
  });

  it('the holder gives leftover cash back, up to what’s there', async () => {
    await expect(as(lee, (q) => q('select public.kitty_payout($1, $2, 99999)', [kitty, maya]))).rejects.toThrow(/that much cash/);
    await as(lee, (q) => q('select public.kitty_payout($1, $2, 4000)', [kitty, maya]));
    expect(await cash()).toBe(5000);
  });

  it('the ledger still balances to zero', async () => {
    const { rows } = await db.query(
      `select coalesce(sum(v), 0)::int as total from (
         select bs.amount_base_minor * -1 as v from public.bill_shares bs join public.bills b on b.id = bs.bill_id where b.trip_id = $1
         union all select b.total_base_minor from public.bills b where b.trip_id = $1
         union all select s.amount_base_minor from public.settlements s where s.trip_id = $1 and s.status <> 'disputed'
         union all select -s.amount_base_minor from public.settlements s where s.trip_id = $1 and s.status <> 'disputed'
       ) x`,
      [trip],
    );
    expect(rows[0].total).toBe(0);
  });

  it('app users can’t call the internal cash total', async () => {
    await expect(as(maya, (q) => q('select public.kitty_cash($1)', [kitty]))).rejects.toThrow(/permission denied/);
  });
});

describe('offline saves and locked exchange rates', () => {
  let trip: string;
  const coffee = (extra: Record<string, unknown> = {}) => ({
    trip_id: trip,
    paid_by: maya,
    title: 'Coffee',
    currency: 'USD',
    fx_rate: 0.9,
    fx_source: 'ecb',
    split_mode: 'equal',
    total_minor: 1000,
    total_base_minor: 900,
    shares: [
      { user_id: maya, amount_minor: 500, amount_base_minor: 450 },
      { user_id: sam, amount_minor: 500, amount_base_minor: 450 },
    ],
    ...extra,
  });

  beforeAll(async () => {
    trip = (await db.query(`select id from public.trips where name = 'Rome'`)).rows[0].id;
  });

  it('saving the same offline bill twice adds it once', async () => {
    const client_id = '7f6c2a1e-4b7d-4c1a-9f00-1234567890ab';
    const a = await as(maya, (q) => q('select public.save_bill($1) as id', [JSON.stringify(coffee({ client_id }))]));
    const b = await as(maya, (q) => q('select public.save_bill($1) as id', [JSON.stringify(coffee({ client_id }))]));
    expect(b.rows[0].id).toBe(a.rows[0].id);
    const n = await db.query('select count(*)::int as n from public.bills where client_id = $1', [client_id]);
    expect(n.rows[0].n).toBe(1);
    // Someone outside the trip can't learn about it by guessing the id.
    await expect(as(stranger, (q) => q('select public.save_bill($1)', [JSON.stringify(coffee({ client_id }))]))).rejects.toThrow(/not found/);
  });

  it('locks the rate with its source and time, until the rate or currency changes', async () => {
    const r = await as(maya, (q) => q('select public.save_bill($1) as id', [JSON.stringify(coffee())]));
    const id = r.rows[0].id;
    const first = (await db.query('select fx_source, fx_locked_at from public.bills where id = $1', [id])).rows[0];
    expect(first.fx_source).toBe('ecb');
    expect(first.fx_locked_at).not.toBeNull();
    await db.query(`update public.bills set fx_locked_at = now() - interval '3 days' where id = $1`, [id]);

    await as(maya, (q) => q('select public.save_bill($1)', [JSON.stringify(coffee({ id, title: 'Coffees' }))]));
    const kept = (await db.query(`select title, fx_locked_at < now() - interval '2 days' as old from public.bills where id = $1`, [id])).rows[0];
    expect(kept).toEqual({ title: 'Coffees', old: true });

    const manual = coffee({ id, fx_rate: 0.95, fx_source: 'manual', total_base_minor: 950, shares: [
      { user_id: maya, amount_minor: 500, amount_base_minor: 475 },
      { user_id: sam, amount_minor: 500, amount_base_minor: 475 },
    ] });
    await as(maya, (q) => q('select public.save_bill($1)', [JSON.stringify(manual)]));
    const relocked = (await db.query(`select fx_source, fx_locked_at > now() - interval '1 minute' as fresh from public.bills where id = $1`, [id])).rows[0];
    expect(relocked).toEqual({ fx_source: 'manual', fresh: true });
  });

  it('same-currency bills have no rate to lock', async () => {
    const r = await as(maya, (q) =>
      q('select public.save_bill($1) as id', [JSON.stringify(coffee({ currency: 'EUR', fx_rate: 1, total_base_minor: 1000, shares: [
        { user_id: maya, amount_minor: 500, amount_base_minor: 500 },
        { user_id: sam, amount_minor: 500, amount_base_minor: 500 },
      ] }))]),
    );
    const b = (await db.query('select fx_source, fx_locked_at from public.bills where id = $1', [r.rows[0].id])).rows[0];
    expect(b).toEqual({ fx_source: null, fx_locked_at: null });
  });
});
