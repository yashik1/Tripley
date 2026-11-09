import { describe, expect, it } from 'vitest';

import { netPerMember } from '../../src/lib/balances';
import { kittySummary, type KittyBill, type KittyTransfer } from '../../src/lib/kitty';

const K = 'kitty-1';
let n = 0;
const at = () => new Date(Date.UTC(2026, 10, 8, 10, n++)).toISOString();
const transfer = (p: Partial<KittyTransfer> & Pick<KittyTransfer, 'from_user' | 'to_user' | 'amount_base_minor' | 'kitty_role'>): KittyTransfer => ({
  id: `t${n}`,
  kitty_id: K,
  status: 'confirmed',
  created_at: at(),
  ...p,
});
const bill = (p: Pick<KittyBill, 'paid_by' | 'total_base_minor' | 'title'>): KittyBill => ({ id: `b${n}`, kitty_id: K, created_at: at(), ...p });

describe('kittySummary', () => {
  const transfers = [
    transfer({ from_user: 'ana', to_user: 'sam', amount_base_minor: 100_000, kitty_role: 'contribution' }),
    transfer({ from_user: 'ben', to_user: 'sam', amount_base_minor: 100_000, kitty_role: 'contribution', status: 'paid' }),
    transfer({ from_user: 'cat', to_user: 'sam', amount_base_minor: 50_000, kitty_role: 'contribution', status: 'disputed' }),
    transfer({ from_user: 'sam', to_user: 'maya', amount_base_minor: 200_000, kitty_role: 'handover' }),
    transfer({ from_user: 'maya', to_user: 'ana', amount_base_minor: 10_000, kitty_role: 'payout' }),
    // a normal payment, not part of the kitty
    transfer({ from_user: 'ben', to_user: 'ana', amount_base_minor: 999, kitty_role: null as never, kitty_id: null }),
  ];
  const bills = [
    bill({ paid_by: 'sam', total_base_minor: 60_000, title: 'Taxi' }),
    bill({ paid_by: 'maya', total_base_minor: 90_000, title: 'Dinner' }),
    { ...bill({ paid_by: 'ben', total_base_minor: 5_000, title: 'Not from kitty' }), kitty_id: null },
  ];

  it('works out the cash that should be in the pot', () => {
    const s = kittySummary(K, transfers, bills);
    expect(s.contributedMinor).toBe(200_000); // disputed one ignored
    expect(s.spentMinor).toBe(150_000);
    expect(s.paidOutMinor).toBe(10_000);
    expect(s.cashMinor).toBe(40_000); // handovers move the pot, they don't change it
    expect(s.pendingMinor).toBe(100_000);
    expect(s.byContributor).toEqual([
      { userId: 'ana', minor: 100_000 },
      { userId: 'ben', minor: 100_000 },
    ]);
  });

  it('counts cash the holder put in from their own pocket', () => {
    const own = [{ id: 'o1', kitty_id: K, user_id: 'sam', amount_base_minor: 20_000, created_at: at() }];
    const s = kittySummary(K, transfers, bills, own);
    expect(s.cashMinor).toBe(60_000);
    expect(s.byContributor.find((c) => c.userId === 'sam')?.minor).toBe(20_000);
    expect(s.entries[0]).toMatchObject({ kind: 'contribution', userId: 'sam', pending: false });
  });

  it('lists the history newest first', () => {
    const s = kittySummary(K, transfers, bills);
    expect(s.entries.map((e) => e.kind)).toEqual(['spend', 'spend', 'payout', 'handover', 'contribution', 'contribution']);
  });
});

describe('the kitty keeps balances right through the normal ledger', () => {
  it('leftover cash comes back to the people who put it in', () => {
    // Ana and Ben each put 1,000 in Sam's kitty; Sam hands it to Maya;
    // Maya pays a 1,500 dinner for Ana and Ben from it.
    const shares = [
      { billId: 'd', paidBy: 'maya', userId: 'ana', amountBaseMinor: 750 },
      { billId: 'd', paidBy: 'maya', userId: 'ben', amountBaseMinor: 750 },
    ];
    const settlements = [
      { id: '1', fromUser: 'ana', toUser: 'sam', amountBaseMinor: 1000, status: 'confirmed' as const },
      { id: '2', fromUser: 'ben', toUser: 'sam', amountBaseMinor: 1000, status: 'confirmed' as const },
      { id: '3', fromUser: 'sam', toUser: 'maya', amountBaseMinor: 2000, status: 'confirmed' as const },
    ];
    const net = netPerMember(shares, settlements);
    expect(net.get('ana')).toBe(250);
    expect(net.get('ben')).toBe(250);
    expect(net.get('sam') ?? 0).toBe(0);
    expect(net.get('maya')).toBe(-500); // she holds the 500 left over and owes it back
  });
});
