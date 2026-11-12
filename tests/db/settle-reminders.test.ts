/**
 * Settle-up reminders (migration 20261123000000_settle_up_reminders).
 *
 * Run: npm run test:db   (needs the postgresql-16 server binaries)
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { netPerMember } from '../../src/lib/balances';
import { as, createTrip, createUser, startDb } from './helpers';

let db: Client;
let ana: string, ben: string, cleo: string;
let trip: string;

const dinner = (payer: string, people: string[], each: number) =>
  JSON.stringify({
    trip_id: trip,
    paid_by: payer,
    title: 'Dinner',
    currency: 'EUR',
    split_mode: 'itemized',
    total_minor: each * people.length,
    total_base_minor: each * people.length,
    items: [{ name: 'Menu', line_total_minor: each * people.length, shares: people.map((user_id) => ({ user_id, weight: 1 })) }],
    shares: people.map((user_id) => ({ user_id, amount_minor: each, amount_base_minor: each })),
  });
const reminders = async (user?: string) =>
  (await db.query(`select count(*)::int as n from public.notifications where kind = 'settlement_reminder' and trip_id = $1 ${user ? 'and user_id = $2' : ''}`, user ? [trip, user] : [trip])).rows[0].n;
const daily = async () => (await db.query('select public.send_settle_up_reminders() as n')).rows[0].n;

beforeAll(async () => {
  db = await startDb('tripley_settle_reminders');
  ana = await createUser(db, 'Ana');
  ben = await createUser(db, 'Ben');
  cleo = await createUser(db, 'Cleo');
  trip = await createTrip(db, ana, [ben, cleo], 'Lisbon');
  // Ana pays 3 × €100; Ben pays Cleo and himself 2 × €20; Ben pays Ana back €100; a disputed payment doesn't count.
  await as(db, ana, (q) => q('select public.save_bill($1)', [dinner(ana, [ana, ben, cleo], 100_00)]));
  await as(db, ben, (q) => q('select public.save_bill($1)', [dinner(ben, [ben, cleo], 20_00)]));
  await db.query(`insert into public.settlements (trip_id, from_user, to_user, amount_base_minor, status) values ($1, $2, $3, 10000, 'confirmed')`, [trip, ben, ana]);
  await db.query(`insert into public.settlements (trip_id, from_user, to_user, amount_base_minor, status) values ($1, $2, $3, 5000, 'disputed')`, [trip, cleo, ana]);
});

afterAll(async () => {
  await db?.end();
});

describe('settle-up reminders', () => {
  it('works out balances exactly as the app does', async () => {
    const sql = new Map((await db.query('select user_id, net_minor::int as n from public.trip_net_balances($1)', [trip])).rows.map((r) => [r.user_id, r.n]));
    const shares = (await db.query('select s.bill_id, s.user_id, s.amount_base_minor::int as a, b.paid_by from public.bill_shares s join public.bills b on b.id = s.bill_id where b.trip_id = $1', [trip])).rows;
    const settlements = (await db.query('select id, from_user, to_user, amount_base_minor::int as a, status from public.settlements where trip_id = $1', [trip])).rows;
    const app = netPerMember(
      shares.map((s) => ({ billId: s.bill_id, userId: s.user_id, amountBaseMinor: s.a, paidBy: s.paid_by, title: 'Dinner' })),
      settlements.map((s) => ({ id: s.id, fromUser: s.from_user, toUser: s.to_user, amountBaseMinor: s.a, status: s.status })) as never,
    );
    expect(Object.fromEntries(sql)).toEqual(Object.fromEntries(app));
    // Ana is owed 100, Ben is owed 20 - 100 + 100 = 20, Cleo owes 120.
    expect(Object.fromEntries(sql)).toEqual({ [ana]: 100_00, [ben]: 20_00, [cleo]: -120_00 });
  });

  it('someone who is owed money nudges whoever owes, once a day', async () => {
    await expect(as(db, cleo, (q) => q('select public.remind_to_settle($1)', [trip]))).rejects.toThrow(/Only someone who is owed/);
    const sent = (await as(db, ben, (q) => q('select public.remind_to_settle($1) as n', [trip]))).rows[0].n;
    expect(sent).toBe(1);
    expect(await reminders(cleo)).toBe(1);
    await expect(as(db, ana, (q) => q('select public.remind_to_settle($1)', [trip]))).rejects.toThrow(/today/);
    await expect(as(db, ana, (q) => q('select public.send_settle_up_reminders()'))).rejects.toThrow(/permission denied/);
  });

  it('after the trip, whoever still owes is reminded weekly, three times at most', async () => {
    expect(await daily()).toBe(0); // the trip hasn't ended
    await db.query(`update public.trips set starts_on = current_date - 10, ends_on = current_date - 3 where id = $1`, [trip]);
    expect(await daily()).toBe(0); // Cleo was nudged today
    await db.query(`update public.notifications set created_at = created_at - interval '8 days' where kind = 'settlement_reminder'`);
    expect(await daily()).toBe(1);
    expect(await daily()).toBe(0); // not again this week
    await db.query(`update public.notifications set created_at = created_at - interval '8 days' where kind = 'settlement_reminder'`);
    expect(await daily()).toBe(1);
    await db.query(`update public.notifications set created_at = created_at - interval '8 days' where kind = 'settlement_reminder'`);
    expect(await daily()).toBe(0); // three reminders on this trip: that's enough
    expect(await reminders(cleo)).toBe(3);
    expect(await reminders(ana)).toBe(0);
  });

  it('once Cleo pays, nobody is reminded', async () => {
    await db.query(`delete from public.notifications where kind = 'settlement_reminder'`);
    await db.query(`insert into public.settlements (trip_id, from_user, to_user, amount_base_minor, status) values ($1, $2, $3, 10000, 'paid'), ($1, $2, $4, 2000, 'paid')`, [trip, cleo, ana, ben]);
    expect(await daily()).toBe(0);
  });
});
