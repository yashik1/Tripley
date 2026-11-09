/**
 * Cash kitty: a pot of physical cash one person holds for the group.
 *
 * It rides on the normal ledger, so balances stay right without special cases:
 * - putting cash in = a payment from you to the holder (kitty role "contribution")
 * - spending from it = a bill paid by the holder (bills.kitty_id)
 * - handing it over = a payment from the old holder to the new one ("handover")
 * - giving cash back = a payment from the holder to someone ("payout")
 * Here we only work out how much cash should be in the pot and who put in what.
 */

export type KittyRole = 'contribution' | 'handover' | 'payout';

export type KittyTransfer = {
  id: string;
  kitty_id: string | null;
  kitty_role: KittyRole | null;
  from_user: string;
  to_user: string;
  amount_base_minor: number;
  status: 'paid' | 'confirmed' | 'disputed';
  created_at: string;
};

export type KittyBill = {
  id: string;
  kitty_id: string | null;
  title: string;
  paid_by: string;
  total_base_minor: number;
  created_at: string;
};

/** Cash the holder put in from their own pocket. */
export type KittyOwnCashRow = { id: string; kitty_id: string; user_id: string; amount_base_minor: number; created_at: string };

export type KittyEntry =
  | { kind: 'contribution'; id: string; userId: string; amountMinor: number; at: string; pending: boolean }
  | { kind: 'spend'; id: string; title: string; userId: string; amountMinor: number; at: string }
  | { kind: 'handover'; id: string; from: string; to: string; amountMinor: number; at: string }
  | { kind: 'payout'; id: string; userId: string; amountMinor: number; at: string; pending: boolean };

export type KittySummary = {
  cashMinor: number;
  contributedMinor: number;
  spentMinor: number;
  paidOutMinor: number;
  pendingMinor: number;
  byContributor: { userId: string; minor: number }[];
  entries: KittyEntry[];
};

export function kittySummary(
  kittyId: string,
  transfers: KittyTransfer[],
  bills: KittyBill[],
  ownCash: KittyOwnCashRow[] = [],
): KittySummary {
  const entries: KittyEntry[] = [];
  let contributed = 0;
  let spent = 0;
  let paidOut = 0;
  let pending = 0;
  const by = new Map<string, number>();

  for (const t of transfers) {
    if (t.kitty_id !== kittyId || t.status === 'disputed') continue;
    const isPending = t.status === 'paid';
    if (t.kitty_role === 'contribution') {
      contributed += t.amount_base_minor;
      if (isPending) pending += t.amount_base_minor;
      by.set(t.from_user, (by.get(t.from_user) ?? 0) + t.amount_base_minor);
      entries.push({ kind: 'contribution', id: t.id, userId: t.from_user, amountMinor: t.amount_base_minor, at: t.created_at, pending: isPending });
    } else if (t.kitty_role === 'payout') {
      paidOut += t.amount_base_minor;
      entries.push({ kind: 'payout', id: t.id, userId: t.to_user, amountMinor: t.amount_base_minor, at: t.created_at, pending: isPending });
    } else if (t.kitty_role === 'handover') {
      entries.push({ kind: 'handover', id: t.id, from: t.from_user, to: t.to_user, amountMinor: t.amount_base_minor, at: t.created_at });
    }
  }
  for (const o of ownCash) {
    if (o.kitty_id !== kittyId) continue;
    contributed += o.amount_base_minor;
    by.set(o.user_id, (by.get(o.user_id) ?? 0) + o.amount_base_minor);
    entries.push({ kind: 'contribution', id: o.id, userId: o.user_id, amountMinor: o.amount_base_minor, at: o.created_at, pending: false });
  }
  for (const b of bills) {
    if (b.kitty_id !== kittyId) continue;
    spent += b.total_base_minor;
    entries.push({ kind: 'spend', id: b.id, title: b.title, userId: b.paid_by, amountMinor: b.total_base_minor, at: b.created_at });
  }
  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return {
    cashMinor: contributed - spent - paidOut,
    contributedMinor: contributed,
    spentMinor: spent,
    paidOutMinor: paidOut,
    pendingMinor: pending,
    byContributor: [...by.entries()].map(([userId, minor]) => ({ userId, minor })).sort((a, b) => b.minor - a.minor),
    entries,
  };
}
