/**
 * Security and money-integrity tests (migration 20261110000000_security_hardening):
 * function privileges, subscription webhooks, AI scan quota, kitty races,
 * storage rules and location visibility. Race tests use two connections.
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, begin, connect, createTrip, createUser, sleep, startDb } from './helpers';

let db: Client;
let c2: Client;
let maya: string, sam: string, lee: string, stranger: string;
let trip: string;

beforeAll(async () => {
  db = await startDb('tripley_security');
  c2 = await connect();
  maya = await createUser(db, 'Maya');
  sam = await createUser(db, 'Sam');
  lee = await createUser(db, 'Lee');
  stranger = await createUser(db, 'Stranger');
  trip = await createTrip(db, maya, [sam, lee], 'Lisbon');
});

afterAll(async () => {
  await c2?.end();
  await db?.end();
});

/** Two concurrent calls on separate connections; the first holds its transaction open briefly. */
async function race<T>(
  first: { who: string | 'service_role'; sql: string; params: unknown[] },
  second: { who: string | 'service_role'; sql: string; params: unknown[] },
): Promise<[PromiseSettledResult<T>, PromiseSettledResult<T>]> {
  await begin(db, first.who);
  await begin(c2, second.who);
  let a: PromiseSettledResult<T>;
  try {
    a = { status: 'fulfilled', value: (await db.query(first.sql, first.params as any[])).rows[0] as T };
  } catch (e) {
    a = { status: 'rejected', reason: e };
  }
  // The second call has to wait for the first one's lock.
  const pending = c2.query(second.sql, second.params as any[]).then(
    (r) => ({ status: 'fulfilled', value: r.rows[0] as T }) as PromiseSettledResult<T>,
    (e) => ({ status: 'rejected', reason: e }) as PromiseSettledResult<T>,
  );
  await sleep(150);
  await db.query(a.status === 'fulfilled' ? 'commit' : 'rollback');
  const b = await pending;
  await c2.query(b.status === 'fulfilled' ? 'commit' : 'rollback');
  return [a, b];
}

// ---------------------------------------------------------------------------
describe('who can call which function', () => {
  const callable = async (role: string) =>
    (
      await db.query(
        `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and has_function_privilege($1, p.oid, 'execute') order by 1`,
        [role],
      )
    ).rows.map((r) => r.name as string);

  it('without signing in, only the invite preview', async () => {
    expect(await callable('anon')).toEqual(['trip_preview']);
  });

  it('signed in: exactly the app’s functions and the helpers row rules use', async () => {
    expect(await callable('authenticated')).toEqual([
      'account_deletion_preview',
      'add_suggestion_to_plan',
      'can_read_bill',
      'can_see_profile',
      'can_share_location',
      'can_upload_now',
      'cancel_invitation',
      'close_kitty',
      'close_poll',
      'create_challenge',
      'create_kitty',
      'create_poll',
      'create_post',
      'delete_my_account',
      'enter_challenge',
      'invite_by_email',
      'invite_by_phone',
      'invite_user',
      'is_trip_member',
      'is_trip_organizer',
      'join_trip_by_code',
      'kitty_add_cash',
      'kitty_handover',
      'kitty_payout',
      'mark_notifications_read',
      'move_itinerary_item',
      'my_invitations',
      'my_trip_friends',
      'my_trip_overview',
      'new_invite_code',
      'record_payment_received',
      'regenerate_invite_code',
      'respond_to_invitation',
      'respond_to_settlement',
      'save_bill',
      'set_itinerary_rsvp',
      'toggle_reaction',
      'toggle_suggestion_vote',
      'trip_is_active',
      'trip_preview',
      'try_uuid',
      'update_poll',
      'user_achievements',
      'vote_poll',
    ]);
  });

  it('internal helpers refuse app users', async () => {
    for (const sql of [
      'select public.is_member_of($1::uuid, $2::uuid)',
      'select public.display_name_of($2::uuid), $1::uuid',
      'select public.kitty_cash($1::uuid), $2::uuid',
      `select public.notify($2::uuid, $1::uuid, 'x', 'x', 'x', '{}')`,
      `select public.apply_subscription_event('{}'), $1::uuid, $2::uuid`,
      `select public.reserve_ai_scan($2::uuid, $1::uuid, $1::uuid, 'x', 1)`,
      'select public.purge_ended_trip_locations(), $1::uuid, $2::uuid',
      'select public.nudge_stale_sharers(1, 1, 1), $1::uuid, $2::uuid',
    ]) {
      await expect(as(db, stranger, (q) => q(sql, [trip, maya]))).rejects.toThrow(/permission denied/);
    }
    await expect(as(db, null, (q) => q('select public.save_bill($1)', ['{}']))).rejects.toThrow(/permission denied/);
  });

  it('every SECURITY DEFINER function pins an empty search_path', async () => {
    const { rows } = await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and not coalesce('search_path=""' = any (p.proconfig), false)`,
    );
    expect(rows).toEqual([]);
  });

  it('row-level security is on for every table', async () => {
    const { rows } = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it('function parameters can’t reach another trip', async () => {
    const other = await createTrip(db, stranger, [], 'Elsewhere');
    const k = await as(db, stranger, (q) => q(`select public.create_kitty($1, 'Theirs', $2) as id`, [other, stranger]));
    await expect(as(db, maya, (q) => q('select public.kitty_payout($1, $2, 1)', [k.rows[0].id, sam]))).rejects.toThrow(/Kitty not found/);
    await expect(as(db, maya, (q) => q('select public.kitty_add_cash($1, $2, 1)', [k.rows[0].id, maya]))).rejects.toThrow(/Kitty not found/);
    await expect(as(db, maya, (q) => q(`select public.create_kitty($1, 'x', $2)`, [other, maya]))).rejects.toThrow(/not in this trip/);
    await expect(as(db, maya, (q) => q(`select public.record_payment_received($1, $2, 100)`, [other, stranger]))).rejects.toThrow(/not in this trip/);
    await expect(as(db, maya, (q) => q('select public.regenerate_invite_code($1)', [other]))).rejects.toThrow();
    // Trip id in one place, a member of another trip in another.
    await expect(as(db, maya, (q) => q('select public.kitty_add_cash($1, $2, 1)', [k.rows[0].id, stranger]))).rejects.toThrow(/Kitty not found/);
  });
});

// ---------------------------------------------------------------------------
describe('subscription webhook events', () => {
  let buyer: string;
  const T0 = Date.UTC(2026, 10, 1);
  const DAY = 86_400_000;
  const apply = (event: Record<string, unknown>, allowSandbox = false) =>
    as(db, 'service_role', (q) =>
      q(`select public.apply_subscription_event($1::jsonb, 'pro', $2) as r`, [JSON.stringify(event), allowSandbox]),
    ).then((r) => r.rows[0].r as { outcome: string; user_id?: string });
  const account = async (id = buyer) =>
    (await db.query('select plan, plan_expires_at, plan_event_at from public.accounts where user_id = $1', [id])).rows[0];
  const ev = (id: string, type: string, at: number, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    event_timestamp_ms: at,
    app_user_id: buyer,
    entitlement_ids: ['pro'],
    environment: 'PRODUCTION',
    product_id: 'tripley_pro_monthly',
    store: 'APP_STORE',
    ...extra,
  });

  beforeAll(async () => {
    buyer = await createUser(db, 'Buyer');
  });

  it('only the server can apply events or read them', async () => {
    await expect(as(db, buyer, (q) => q(`select public.apply_subscription_event('{}')`))).rejects.toThrow(/permission denied/);
    await expect(as(db, buyer, (q) => q('select * from public.subscription_events'))).rejects.toThrow(/permission denied/);
    await expect(as(db, buyer, (q) => q(`update public.accounts set plan = 'pro'`))).rejects.toThrow(/permission denied/);
  });

  it('a purchase turns on Pro until the expiry', async () => {
    expect((await apply(ev('e1', 'INITIAL_PURCHASE', T0, { expiration_at_ms: T0 + 30 * DAY }))).outcome).toBe('applied');
    const a = await account();
    expect(a.plan).toBe('pro');
    expect(new Date(a.plan_expires_at).getTime()).toBe(T0 + 30 * DAY);
  });

  it('the same event delivered twice applies once', async () => {
    expect((await apply(ev('e2', 'EXPIRATION', T0 + 31 * DAY))).outcome).toBe('applied');
    expect((await account()).plan).toBe('free');
    // A retry of the original purchase must not switch Pro back on.
    expect((await apply(ev('e1', 'INITIAL_PURCHASE', T0, { expiration_at_ms: T0 + 30 * DAY }))).outcome).toBe('duplicate');
    expect((await account()).plan).toBe('free');
    const n = await db.query(`select count(*)::int as n from public.subscription_events where id = 'e1'`);
    expect(n.rows[0].n).toBe(1);
  });

  it('two copies at the same time: one applies, one is a duplicate', async () => {
    const sql = `select public.apply_subscription_event($1::jsonb) as r`;
    const e = JSON.stringify(ev('e3', 'RENEWAL', T0 + 32 * DAY, { expiration_at_ms: T0 + 62 * DAY }));
    const [a, b] = await race<{ r: { outcome: string } }>(
      { who: 'service_role', sql, params: [e] },
      { who: 'service_role', sql, params: [e] },
    );
    expect(a.status === 'fulfilled' && a.value.r.outcome).toBe('applied');
    expect(b.status === 'fulfilled' && b.value.r.outcome).toBe('duplicate');
    expect((await account()).plan).toBe('pro');
  });

  it('an older event arriving late can’t roll the plan back', async () => {
    // An expiration from before the renewal shows up now.
    expect((await apply(ev('e4', 'EXPIRATION', T0 + 31.5 * DAY))).outcome).toBe('stale');
    const a = await account();
    expect(a.plan).toBe('pro');
    expect(new Date(a.plan_event_at).getTime()).toBe(T0 + 32 * DAY);
  });

  it('a renewal extends Pro', async () => {
    await apply(ev('e5', 'RENEWAL', T0 + 62 * DAY, { expiration_at_ms: T0 + 92 * DAY }));
    expect(new Date((await account()).plan_expires_at).getTime()).toBe(T0 + 92 * DAY);
  });

  it('turning off auto-renew keeps Pro to the end of the period; a billing issue keeps the grace period', async () => {
    await apply(ev('e6', 'CANCELLATION', T0 + 70 * DAY, { cancel_reason: 'UNSUBSCRIBE', expiration_at_ms: T0 + 92 * DAY }));
    let a = await account();
    expect(a.plan).toBe('pro');
    expect(new Date(a.plan_expires_at).getTime()).toBe(T0 + 92 * DAY);
    await apply(ev('e7', 'BILLING_ISSUE', T0 + 71 * DAY, { expiration_at_ms: T0 + 95 * DAY }));
    a = await account();
    expect(a.plan).toBe('pro');
    expect(new Date(a.plan_expires_at).getTime()).toBe(T0 + 95 * DAY);
  });

  it('a refund ends Pro at once; a reversed refund restores it', async () => {
    await apply(ev('e8', 'CANCELLATION', T0 + 72 * DAY, { cancel_reason: 'CUSTOMER_SUPPORT', expiration_at_ms: T0 + 72 * DAY }));
    expect((await account()).plan).toBe('free');
    await apply(ev('e9', 'REFUND_REVERSED', T0 + 73 * DAY, { expiration_at_ms: T0 + 95 * DAY }));
    expect((await account()).plan).toBe('pro');
  });

  it('expiry ends Pro', async () => {
    await apply(ev('e10', 'EXPIRATION', T0 + 96 * DAY));
    expect((await account()).plan).toBe('free');
  });

  it('unknown event types and other entitlements are recorded but change nothing', async () => {
    expect((await apply(ev('e11', 'SOMETHING_NEW', T0 + 97 * DAY))).outcome).toBe('ignored_type');
    expect((await apply(ev('e12', 'INITIAL_PURCHASE', T0 + 98 * DAY, { entitlement_ids: ['other'] }))).outcome).toBe('ignored_entitlement');
    expect((await apply(ev('e13', 'TEST', T0 + 98 * DAY))).outcome).toBe('ignored_test');
    expect((await account()).plan).toBe('free');
  });

  it('sandbox purchases don’t grant Pro unless allowed', async () => {
    const e = { environment: 'SANDBOX', expiration_at_ms: T0 + 200 * DAY };
    expect((await apply(ev('e14', 'INITIAL_PURCHASE', T0 + 99 * DAY, e))).outcome).toBe('ignored_sandbox');
    expect((await account()).plan).toBe('free');
    expect((await apply(ev('e15', 'INITIAL_PURCHASE', T0 + 99 * DAY, e), true)).outcome).toBe('applied');
    expect((await account()).plan).toBe('pro');
  });

  it('missing or malformed ids', async () => {
    await expect(apply({ ...ev('x', 'RENEWAL', T0), id: undefined })).rejects.toThrow(/Malformed event id/);
    await expect(apply({ ...ev('bad id!', 'RENEWAL', T0) })).rejects.toThrow(/Malformed event id/);
    await expect(apply({ ...ev('x2', 'RENEWAL', T0), event_timestamp_ms: 'soon' })).rejects.toThrow(/Malformed event time/);
    expect((await apply(ev('e16', 'RENEWAL', T0 + 100 * DAY, { app_user_id: 'not-a-uuid', aliases: ['$RCAnonymousID:abc'] }))).outcome).toBe(
      'ignored_no_user',
    );
    expect(
      (await apply(ev('e17', 'RENEWAL', T0 + 100 * DAY, { app_user_id: '00000000-0000-4000-8000-000000000000' }))).outcome,
    ).toBe('ignored_no_user');
    // The Supabase id can come as an alias.
    expect(
      (await apply(ev('e18', 'RENEWAL', T0 + 101 * DAY, { app_user_id: '$RCAnonymousID:abc', aliases: [buyer], expiration_at_ms: T0 + 130 * DAY })))
        .outcome,
    ).toBe('applied');
  });

  it('a transfer moves Pro to the new account', async () => {
    const receiver = await createUser(db, 'Receiver');
    const r = await apply({
      id: 'e19',
      type: 'TRANSFER',
      event_timestamp_ms: T0 + 102 * DAY,
      transferred_from: [buyer],
      transferred_to: [receiver],
      environment: 'PRODUCTION',
    });
    expect(r.outcome).toBe('applied');
    expect((await account()).plan).toBe('free');
    const to = await account(receiver);
    expect(to.plan).toBe('pro');
    expect(new Date(to.plan_expires_at).getTime()).toBe(T0 + 130 * DAY);
  });
});

// ---------------------------------------------------------------------------
describe('AI receipt scan quota', () => {
  let pro: string;
  let req = 0;
  const id = () => `00000000-0000-4000-8000-${String(++req).padStart(12, '0')}`;
  const path = (t = trip, f = 'r1.jpg') => `${t}/${f}`;
  const reserve = (user: string, request: string, p = path(), limit = 3, perMinute = 100) =>
    as(db, 'service_role', (q) =>
      q('select public.reserve_ai_scan($1, $2, $3, $4, $5, $6) as r', [user, request, trip, p, limit, perMinute]),
    ).then((r) => r.rows[0].r);
  const used = async () => (await db.query('select ai_scans_used from public.accounts where user_id = $1', [pro])).rows[0].ai_scans_used;

  beforeAll(async () => {
    pro = await createUser(db, 'Pro Paula');
    const code = (await db.query('select invite_code from public.trips where id = $1', [trip])).rows[0].invite_code;
    await as(db, pro, (q) => q('select public.join_trip_by_code($1)', [code]));
    await db.query(`update public.accounts set plan = 'pro', plan_expires_at = now() + interval '30 days' where user_id = $1`, [pro]);
  });

  it('app users can’t reserve scans or read the request log', async () => {
    await expect(as(db, pro, (q) => q(`select public.reserve_ai_scan($1, $1, $1, 'x', 99)`, [pro]))).rejects.toThrow(/permission denied/);
    await expect(as(db, pro, (q) => q('select * from public.ai_scan_requests'))).rejects.toThrow(/permission denied/);
  });

  it('needs Pro, an unexpired plan and trip membership', async () => {
    expect((await reserve(sam, id())).status).toBe('pro_required');
    await db.query(`update public.accounts set plan = 'pro', plan_expires_at = now() - interval '1 day' where user_id = $1`, [sam]);
    expect((await reserve(sam, id())).status).toBe('pro_required');
    await db.query(`update public.accounts set plan = 'pro', plan_expires_at = now() + interval '1 day' where user_id = $1`, [stranger]);
    expect((await reserve(stranger, id())).status).toBe('not_member');
  });

  it('rejects malformed requests and file names', async () => {
    for (const p of [path(trip, 'r.svg'), path(trip, 'x/../r.jpg'), `${'0'.repeat(8)}-0000-4000-8000-000000000000/r.jpg`, path(trip, 'r.html'), '']) {
      expect((await reserve(pro, id(), p)).status).toBe('bad_request');
    }
    expect(
      (await as(db, 'service_role', (q) => q('select public.reserve_ai_scan($1, null, $2, $3, 3) as r', [pro, trip, path()]))).rows[0].r.status,
    ).toBe('bad_request');
  });

  it('a scan that worked is charged once, even when retried', async () => {
    const r = id();
    expect(await reserve(pro, r)).toEqual({ status: 'reserved', scans_left: 2 });
    expect((await reserve(pro, r)).status).toBe('in_progress');
    await as(db, 'service_role', (q) => q(`select public.finish_ai_scan($1, $2, '{"merchant":"Café"}')`, [pro, r]));
    expect(await used()).toBe(1);
    // Retry after the app timed out: same receipt back, nothing more charged.
    expect(await reserve(pro, r)).toEqual({ status: 'done', result: { merchant: 'Café' }, scans_left: 2 });
    expect(await used()).toBe(1);
  });

  it('a failed AI call gives the scan back, and the retry is charged once', async () => {
    const r = id();
    await reserve(pro, r, path(trip, 'r2.jpg'));
    expect(await used()).toBe(2);
    await as(db, 'service_role', (q) => q('select public.release_ai_scan($1, $2)', [pro, r]));
    expect(await used()).toBe(1);
    // Releasing twice doesn't refund twice.
    await as(db, 'service_role', (q) => q('select public.release_ai_scan($1, $2)', [pro, r]));
    expect(await used()).toBe(1);
    expect((await reserve(pro, r, path(trip, 'r2.jpg'))).status).toBe('reserved');
    expect(await used()).toBe(2);
    await as(db, 'service_role', (q) => q(`select public.finish_ai_scan($1, $2, '{}')`, [pro, r]));
  });

  it('two requests for the last scan: only one gets it', async () => {
    const sql = 'select public.reserve_ai_scan($1, $2, $3, $4, 3, 100) as r';
    const [a, b] = await race<{ r: { status: string } }>(
      { who: 'service_role', sql, params: [pro, id(), trip, path(trip, 'r3.jpg')] },
      { who: 'service_role', sql, params: [pro, id(), trip, path(trip, 'r4.jpg')] },
    );
    expect(a.status === 'fulfilled' && a.value.r.status).toBe('reserved');
    expect(b.status === 'fulfilled' && b.value.r).toEqual({ status: 'quota_exceeded', limit: 3 });
    expect(await used()).toBe(3);
  });

  it('at the limit, no more scans this month', async () => {
    expect((await reserve(pro, id(), path(trip, 'r5.jpg'))).status).toBe('quota_exceeded');
  });

  it('a reservation whose function died is refunded after ten minutes', async () => {
    await db.query(`update public.ai_scan_requests set created_at = now() - interval '11 minutes' where status = 'reserved' and user_id = $1`, [pro]);
    expect((await reserve(pro, id(), path(trip, 'r6.jpg'))).status).toBe('reserved');
    expect(await used()).toBe(3);
  });

  it('too many requests in a minute are slowed down', async () => {
    await db.query(`update public.accounts set ai_scans_used = 0 where user_id = $1`, [pro]);
    const status = (await reserve(pro, id(), path(trip, 'r7.jpg'), 50, 2)).status;
    expect(status).toBe('rate_limited');
  });
});

// ---------------------------------------------------------------------------
describe('cash kitty under concurrent use', () => {
  let kitty: string;
  const cash = async () => (await db.query('select public.kitty_cash($1)::int as c', [kitty])).rows[0].c;
  const payout = 'select public.kitty_payout($1, $2, $3) as id';

  beforeAll(async () => {
    kitty = (await as(db, maya, (q) => q(`select public.create_kitty($1, 'Pot', $2) as id`, [trip, maya]))).rows[0].id;
    await as(db, maya, (q) => q('select public.kitty_add_cash($1, $2, 1000)', [kitty, sam]));
    expect(await cash()).toBe(1000);
  });

  it('two payouts that together exceed the cash: one goes through', async () => {
    const [a, b] = await race(
      { who: maya, sql: payout, params: [kitty, sam, 600] },
      { who: maya, sql: payout, params: [kitty, lee, 600] },
    );
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('rejected');
    expect(String((b as PromiseRejectedResult).reason)).toMatch(/that much cash/);
    expect(await cash()).toBe(400);
  });

  it('paying out exactly what is left empties the kitty', async () => {
    await as(db, maya, (q) => q(payout, [kitty, lee, 400]));
    expect(await cash()).toBe(0);
    await expect(as(db, maya, (q) => q(payout, [kitty, lee, 1]))).rejects.toThrow(/that much cash/);
  });

  it('rejects zero, negative, huge and missing amounts', async () => {
    await as(db, maya, (q) => q('select public.kitty_add_cash($1, $2, 500)', [kitty, lee]));
    for (const amount of [0, -5, null]) {
      await expect(as(db, maya, (q) => q(payout, [kitty, sam, amount]))).rejects.toThrow(/Enter an amount/);
      await expect(as(db, maya, (q) => q('select public.kitty_add_cash($1, $2, $3)', [kitty, sam, amount]))).rejects.toThrow(/Enter an amount/);
    }
    await expect(as(db, maya, (q) => q(payout, [kitty, sam, '9000000000000000000']))).rejects.toThrow(/that much cash/);
    await expect(as(db, maya, (q) => q('select public.kitty_add_cash($1, $2, $3)', [kitty, sam, '9000000000000000000']))).rejects.toThrow(/too large/);
  });

  it('only the holder pays out, and only to someone in the trip', async () => {
    await expect(as(db, sam, (q) => q(payout, [kitty, lee, 10]))).rejects.toThrow(/Only the person holding/);
    await expect(as(db, maya, (q) => q(payout, [kitty, stranger, 10]))).rejects.toThrow(/someone else in the trip/);
    await expect(as(db, maya, (q) => q(payout, [kitty, maya, 10]))).rejects.toThrow(/someone else in the trip/);
    await expect(as(db, stranger, (q) => q(payout, [kitty, sam, 10]))).rejects.toThrow(/Kitty not found/);
  });

  it('a retried payout (same client id) is recorded once', async () => {
    const client = '11111111-1111-4111-8111-111111111111';
    const sql = 'select public.kitty_payout($1, $2, 100, null, $3) as id';
    const first = await as(db, maya, (q) => q(sql, [kitty, sam, client]));
    const again = await as(db, maya, (q) => q(sql, [kitty, sam, client]));
    expect(again.rows[0].id).toBe(first.rows[0].id);
    expect(await cash()).toBe(400);
    // Same client id for a different payout is refused.
    await expect(as(db, maya, (q) => q('select public.kitty_payout($1, $2, 50, null, $3)', [kitty, lee, client]))).rejects.toThrow(/already used/);
    const add = '22222222-2222-4222-8222-222222222222';
    const a1 = await as(db, sam, (q) => q('select public.kitty_add_cash($1, $2, 300, null, $3) as id', [kitty, sam, add]));
    const a2 = await as(db, sam, (q) => q('select public.kitty_add_cash($1, $2, 300, null, $3) as id', [kitty, sam, add]));
    expect(a2.rows[0].id).toBe(a1.rows[0].id);
    expect(await cash()).toBe(700);
  });

  it('cash that has been given back can’t be “un-put-in”', async () => {
    // Sam's 300 is still waiting for Maya to confirm; Maya pays all 700 out.
    await as(db, maya, (q) => q(payout, [kitty, lee, 700]));
    await expect(
      as(db, sam, (q) => q(`delete from public.settlements where kitty_id = $1 and from_user = $2 and status = 'paid'`, [kitty, sam])),
    ).rejects.toThrow(/already been spent/);
    await as(db, maya, (q) => q('select public.kitty_add_cash($1, $2, 1000)', [kitty, lee]));
  });

  it('a handover and a payout at the same time: the payout from the old holder fails', async () => {
    const [a, b] = await race(
      { who: maya, sql: 'select public.kitty_handover($1, $2)', params: [kitty, sam] },
      { who: maya, sql: payout, params: [kitty, lee, 500] },
    );
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('rejected');
    expect(String((b as PromiseRejectedResult).reason)).toMatch(/Only the person holding/);
    const h = await db.query(`select amount_base_minor::int as a from public.settlements where kitty_id = $1 and kitty_role = 'handover'`, [kitty]);
    expect(h.rows).toEqual([{ a: 1000 }]);
  });

  it('a closed kitty is frozen', async () => {
    await as(db, sam, (q) => q('select public.close_kitty($1)', [kitty]));
    await expect(as(db, sam, (q) => q(payout, [kitty, lee, 10]))).rejects.toThrow(/closed/);
    await expect(as(db, sam, (q) => q('select public.kitty_add_cash($1, $2, 10)', [kitty, lee]))).rejects.toThrow(/closed/);
    await expect(as(db, sam, (q) => q('select public.kitty_handover($1, $2)', [kitty, lee]))).rejects.toThrow(/closed/);
  });

  it('a trip with kitty records can still be deleted', async () => {
    const t = await createTrip(db, lee, [sam], 'Short trip');
    const k = (await as(db, lee, (q) => q(`select public.create_kitty($1, 'K', $2) as id`, [t, lee]))).rows[0].id;
    await as(db, lee, (q) => q('select public.kitty_add_cash($1, $2, 100)', [k, sam]));
    await as(db, lee, (q) => q('select public.kitty_handover($1, $2)', [k, sam]));
    await as(db, lee, (q) => q('delete from public.trips where id = $1', [t]));
    expect((await db.query('select count(*)::int as n from public.trips where id = $1', [t])).rows[0].n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('storage', () => {
  const put = (who: string | null, bucket: string, name: string) =>
    as(db, who, (q) => q('insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, name]));
  const count = (who: string | null, bucket: string) =>
    as(db, who, (q) => q('select count(*)::int as n from storage.objects where bucket_id = $1', [bucket])).then((r) => r.rows[0].n);

  it('buckets have size and type limits; receipts and photos are private', async () => {
    const { rows } = await db.query('select id, public, file_size_limit::int as max, allowed_mime_types as types from storage.buckets order by id');
    const images = ['image/jpeg', 'image/png', 'image/webp'];
    expect(rows).toEqual([
      { id: 'avatars', public: true, max: 2 * 1024 * 1024, types: images },
      { id: 'receipts', public: false, max: 8 * 1024 * 1024, types: images },
      { id: 'trip-photos', public: false, max: 8 * 1024 * 1024, types: images },
    ]);
  });

  it('members upload images into their trip’s folder only', async () => {
    await put(sam, 'receipts', `${trip}/abc123.jpg`);
    await put(sam, 'trip-photos', `${trip}/p1.webp`);
    for (const bad of [`${trip}/x.svg`, `${trip}/x.html`, `${trip}/a/b.jpg`, `${trip}/.jpg`, 'abc.jpg']) {
      await expect(put(sam, 'receipts', bad)).rejects.toThrow(/row-level security/);
    }
    await expect(put(stranger, 'receipts', `${trip}/s.jpg`)).rejects.toThrow(/row-level security/);
    await expect(put(null, 'receipts', `${trip}/s.jpg`)).rejects.toThrow(/row-level security/);
  });

  it('nobody outside the trip can read receipts', async () => {
    expect(await count(sam, 'receipts')).toBe(1);
    expect(await count(stranger, 'receipts')).toBe(0);
    expect(await count(null, 'receipts')).toBe(0);
  });

  it('avatars: you can’t overwrite or delete someone else’s', async () => {
    await put(maya, 'avatars', `${maya}/me.jpg`);
    await expect(put(sam, 'avatars', `${maya}/me.jpg`)).rejects.toThrow(/row-level security/);
    await expect(put(sam, 'avatars', `${sam}/me.svg`)).rejects.toThrow(/row-level security/);
    const upd = await as(db, sam, (q) => q(`update storage.objects set name = $1 where bucket_id = 'avatars' and name = $2`, [`${sam}/x.jpg`, `${maya}/me.jpg`]));
    expect(upd.rowCount).toBe(0);
    const del = await as(db, sam, (q) => q(`delete from storage.objects where bucket_id = 'avatars' and name = $1`, [`${maya}/me.jpg`]));
    expect(del.rowCount).toBe(0);
  });

  it('limits how fast one person can upload', async () => {
    const before = (await db.query('select count(*)::int as n from storage.objects where owner = $1', [lee])).rows[0].n;
    for (let i = before; i < 30; i++) await put(lee, 'trip-photos', `${trip}/burst${i}.jpg`);
    await expect(put(lee, 'trip-photos', `${trip}/one-too-many.jpg`)).rejects.toThrow(/row-level security/);
  });

  it('someone removed from the trip loses access at once', async () => {
    const t = await createTrip(db, maya, [stranger], 'Removal');
    await put(stranger, 'receipts', `${t}/mine.jpg`);
    await as(db, stranger, (q) =>
      q(`insert into public.member_locations (trip_id, user_id, lat, lng) values ($1, $2, 38.7, -9.1)`, [t, stranger]),
    );
    await as(db, maya, (q) => q('delete from public.trip_members where trip_id = $1 and user_id = $2', [t, stranger]));
    expect(await count(stranger, 'receipts')).toBe(0);
    await expect(put(stranger, 'receipts', `${t}/again.jpg`)).rejects.toThrow(/row-level security/);
    // Their last position went with them, and they no longer see anyone's.
    expect((await db.query('select count(*)::int as n from public.member_locations where trip_id = $1', [t])).rows[0].n).toBe(0);
    // A bill they queued offline before being removed is refused when it syncs.
    const queued = {
      client_id: '33333333-3333-4333-8333-333333333333',
      trip_id: t,
      paid_by: stranger,
      title: 'Queued offline',
      currency: 'EUR',
      split_mode: 'equal',
      total_minor: 1000,
      total_base_minor: 1000,
      shares: [{ user_id: stranger, amount_minor: 1000, amount_base_minor: 1000 }],
    };
    await expect(as(db, stranger, (q) => q('select public.save_bill($1)', [JSON.stringify(queued)]))).rejects.toThrow(/not in this trip/);
  });
});

// ---------------------------------------------------------------------------
describe('location privacy', () => {
  let t: string;
  const share = (who: string | null, trip: string) =>
    as(db, who, (q) =>
      q(
        `insert into public.member_locations (trip_id, user_id, lat, lng) values ($1, $2, 38.7, -9.1)
         on conflict (trip_id, user_id) do update set lat = excluded.lat`,
        [trip, who ?? maya],
      ),
    );
  const visible = (who: string, trip: string) =>
    as(db, who, (q) => q('select user_id from public.member_locations where trip_id = $1', [trip])).then((r) => r.rows.length);

  beforeAll(async () => {
    t = await createTrip(db, maya, [sam], 'Porto');
  });

  it('signed-out visitors can’t share or read locations', async () => {
    await expect(share(null, t)).rejects.toThrow(/permission denied/);
    await expect(as(db, null, (q) => q('select * from public.member_locations'))).rejects.toThrow(/permission denied/);
  });

  it('members see each other; others see nothing', async () => {
    await share(maya, t);
    await share(sam, t);
    expect(await visible(sam, t)).toBe(2);
    expect(await visible(stranger, t)).toBe(0);
    await expect(share(stranger, t)).rejects.toThrow(/row-level security/);
  });

  it('pausing stops updates and hides the dot', async () => {
    await as(db, sam, (q) => q('update public.trip_members set location_sharing = false where trip_id = $1 and user_id = $2', [t, sam]));
    expect(await visible(maya, t)).toBe(1);
    await expect(share(sam, t)).rejects.toThrow(/row-level security/);
  });

  it('a trip past its end date shows no positions, even before the clean-up job runs', async () => {
    await db.query(`update public.trips set ends_on = current_date - 3 where id = $1`, [t]);
    expect(await visible(maya, t)).toBe(0);
    await db.query(`update public.trips set ends_on = null where id = $1`, [t]);
    expect(await visible(maya, t)).toBe(1);
  });

  it('ending the trip deletes the positions straight away', async () => {
    await as(db, maya, (q) => q('update public.trips set ended_at = now() where id = $1', [t]));
    expect((await db.query('select count(*)::int as n from public.member_locations where trip_id = $1', [t])).rows[0].n).toBe(0);
  });
});
