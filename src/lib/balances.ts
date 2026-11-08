/**
 * Who owes whom, netted per pair of people, in the trip's base currency.
 *
 * For each pair (A, B):
 *   net = A's shares on bills B paid - B's shares on bills A paid
 *         - settlements A->B + settlements B->A        (disputed ones don't count)
 * A positive net means A owes B.
 */

export type ShareRow = {
  billId: string;
  billTitle?: string;
  paidBy: string;
  userId: string;
  amountBaseMinor: number;
};

export type SettlementStatus = 'paid' | 'confirmed' | 'disputed';

export type SettlementRow = {
  id: string;
  fromUser: string;
  toUser: string;
  amountBaseMinor: number;
  status: SettlementStatus;
};

export type BreakdownLine = {
  kind: 'bill' | 'settlement';
  id: string;
  title?: string;
  /** Positive: increases what `from` owes `to`. Negative: reduces it. */
  amountMinor: number;
};

export type PairBalance = {
  /** The person who owes. */
  from: string;
  /** The person who is owed. */
  to: string;
  amountMinor: number;
  breakdown: BreakdownLine[];
};

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Net balances for every pair of people with a non-zero balance. */
export function computePairBalances(
  shares: ShareRow[],
  settlements: SettlementRow[],
): PairBalance[] {
  // Signed amount per unordered pair: positive means the lexicographically
  // smaller id ("lo") owes the larger id ("hi").
  const net = new Map<string, { lo: string; hi: string; amount: number; lines: BreakdownLine[] }>();

  const add = (debtor: string, creditor: string, amount: number, line: Omit<BreakdownLine, 'amountMinor'>) => {
    if (debtor === creditor || amount === 0) return;
    const k = key(debtor, creditor);
    const lo = debtor < creditor ? debtor : creditor;
    const hi = debtor < creditor ? creditor : debtor;
    const entry = net.get(k) ?? { lo, hi, amount: 0, lines: [] };
    const signed = debtor === lo ? amount : -amount;
    entry.amount += signed;
    entry.lines.push({ ...line, amountMinor: signed });
    net.set(k, entry);
  };

  for (const s of shares) {
    add(s.userId, s.paidBy, s.amountBaseMinor, { kind: 'bill', id: s.billId, title: s.billTitle });
  }
  for (const st of settlements) {
    if (st.status === 'disputed') continue;
    // Paying someone reduces what you owe them.
    add(st.fromUser, st.toUser, -st.amountBaseMinor, { kind: 'settlement', id: st.id });
  }

  const result: PairBalance[] = [];
  for (const entry of net.values()) {
    if (entry.amount === 0) continue;
    const loOwes = entry.amount > 0;
    result.push({
      from: loOwes ? entry.lo : entry.hi,
      to: loOwes ? entry.hi : entry.lo,
      amountMinor: Math.abs(entry.amount),
      // Re-express each line from the debtor's point of view.
      breakdown: entry.lines.map((l) => ({ ...l, amountMinor: loOwes ? l.amountMinor : -l.amountMinor })),
    });
  }
  return result.sort((a, b) => b.amountMinor - a.amountMinor);
}

export type UserSummary = {
  /** People this user owes. */
  owes: PairBalance[];
  /** People who owe this user. */
  owed: PairBalance[];
  /** Positive: others owe this user overall. Negative: this user owes overall. */
  netMinor: number;
};

export function summarizeForUser(pairs: PairBalance[], userId: string): UserSummary {
  const owes = pairs.filter((p) => p.from === userId);
  const owed = pairs.filter((p) => p.to === userId);
  const netMinor =
    owed.reduce((a, p) => a + p.amountMinor, 0) - owes.reduce((a, p) => a + p.amountMinor, 0);
  return { owes, owed, netMinor };
}

/** Net position of every member (positive = is owed money). Sums to zero. */
export function netPerMember(shares: ShareRow[], settlements: SettlementRow[]): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (u: string, v: number) => out.set(u, (out.get(u) ?? 0) + v);
  for (const s of shares) {
    if (s.userId === s.paidBy) continue;
    bump(s.paidBy, s.amountBaseMinor);
    bump(s.userId, -s.amountBaseMinor);
  }
  for (const st of settlements) {
    if (st.status === 'disputed') continue;
    bump(st.fromUser, st.amountBaseMinor);
    bump(st.toUser, -st.amountBaseMinor);
  }
  return out;
}

/** Total each person spent on the trip (their own shares), for the trip summary. */
export function spendPerMember(shares: ShareRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of shares) out.set(s.userId, (out.get(s.userId) ?? 0) + s.amountBaseMinor);
  return out;
}
