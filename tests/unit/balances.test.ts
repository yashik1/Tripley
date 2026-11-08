import { describe, expect, it } from 'vitest';
import {
  computePairBalances,
  netPerMember,
  summarizeForUser,
  type SettlementRow,
  type ShareRow,
} from '../../src/lib/balances';

// Maya paid dinner (3000) shared by maya/sam/lee; Sam paid taxi (900) shared by all three.
const shares: ShareRow[] = [
  { billId: 'dinner', billTitle: 'Dinner', paidBy: 'maya', userId: 'maya', amountBaseMinor: 1000 },
  { billId: 'dinner', billTitle: 'Dinner', paidBy: 'maya', userId: 'sam', amountBaseMinor: 1000 },
  { billId: 'dinner', billTitle: 'Dinner', paidBy: 'maya', userId: 'lee', amountBaseMinor: 1000 },
  { billId: 'taxi', billTitle: 'Taxi', paidBy: 'sam', userId: 'maya', amountBaseMinor: 300 },
  { billId: 'taxi', billTitle: 'Taxi', paidBy: 'sam', userId: 'sam', amountBaseMinor: 300 },
  { billId: 'taxi', billTitle: 'Taxi', paidBy: 'sam', userId: 'lee', amountBaseMinor: 300 },
];

describe('computePairBalances', () => {
  it('nets debts between each pair', () => {
    const pairs = computePairBalances(shares, []);
    const find = (from: string, to: string) => pairs.find((p) => p.from === from && p.to === to);
    expect(find('sam', 'maya')?.amountMinor).toBe(700); // 1000 - 300
    expect(find('lee', 'maya')?.amountMinor).toBe(1000);
    expect(find('lee', 'sam')?.amountMinor).toBe(300);
    expect(pairs).toHaveLength(3);
  });

  it('shows a per-bill breakdown from the debtor point of view', () => {
    const pair = computePairBalances(shares, []).find((p) => p.from === 'sam' && p.to === 'maya')!;
    expect(pair.breakdown).toEqual([
      { kind: 'bill', id: 'dinner', title: 'Dinner', amountMinor: 1000 },
      { kind: 'bill', id: 'taxi', title: 'Taxi', amountMinor: -300 },
    ]);
  });

  it('settlements reduce the balance; disputed ones do not', () => {
    const settlements: SettlementRow[] = [
      { id: 's1', fromUser: 'sam', toUser: 'maya', amountBaseMinor: 700, status: 'paid' },
      { id: 's2', fromUser: 'lee', toUser: 'maya', amountBaseMinor: 1000, status: 'disputed' },
    ];
    const pairs = computePairBalances(shares, settlements);
    expect(pairs.find((p) => p.from === 'sam' && p.to === 'maya')).toBeUndefined();
    expect(pairs.find((p) => p.from === 'lee' && p.to === 'maya')?.amountMinor).toBe(1000);
  });

  it('overpaying flips the direction', () => {
    const pairs = computePairBalances(shares, [
      { id: 's1', fromUser: 'lee', toUser: 'sam', amountBaseMinor: 500, status: 'confirmed' },
    ]);
    expect(pairs.find((p) => p.from === 'sam' && p.to === 'lee')?.amountMinor).toBe(200);
  });
});

describe('summaries', () => {
  it('summarizes for one user and nets to zero across the group', () => {
    const pairs = computePairBalances(shares, []);
    const maya = summarizeForUser(pairs, 'maya');
    expect(maya.owes).toHaveLength(0);
    expect(maya.netMinor).toBe(1700);
    const lee = summarizeForUser(pairs, 'lee');
    expect(lee.netMinor).toBe(-1300);
    const net = netPerMember(shares, []);
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0);
    expect(net.get('maya')).toBe(1700);
  });
});
