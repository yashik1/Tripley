/**
 * The split engine. Pure functions, no I/O, all amounts in integer minor units.
 *
 * Itemized mode: each item's price is divided between the people who had it
 * (by weight), then tax / service / tip / discount are divided in proportion
 * to each person's item subtotal. Equal mode: the total is divided evenly.
 *
 * Every division uses the largest-remainder method so that the parts always
 * add up to exactly the whole. Nobody is ever a cent short or over.
 */

export type ItemShare = { userId: string; weight: number };

export type SplitItem = {
  name: string;
  lineTotalMinor: number;
  shares: ItemShare[];
};

export type Extras = {
  taxMinor?: number;
  serviceMinor?: number;
  tipMinor?: number;
  discountMinor?: number;
};

export type ItemizedSplitInput = Extras & {
  mode: 'itemized';
  items: SplitItem[];
};

export type EqualSplitInput = {
  mode: 'equal';
  totalMinor: number;
  participants: string[];
};

export type SplitInput = ItemizedSplitInput | EqualSplitInput;

export type PersonShare = {
  userId: string;
  itemsMinor: number;
  extrasMinor: number;
  totalMinor: number;
};

export type SplitIssue =
  | { kind: 'no-items' }
  | { kind: 'no-participants' }
  | { kind: 'unassigned-item'; index: number; name: string }
  | { kind: 'negative-total' }
  | { kind: 'invalid-amount'; index: number; name: string };

export type SplitResult = {
  ok: boolean;
  issues: SplitIssue[];
  subtotalMinor: number;
  extrasMinor: number;
  totalMinor: number;
  shares: PersonShare[];
};

/**
 * Divide `total` into parts proportional to `weights`, using the largest-remainder
 * method. The result always sums to `total`. Ties go to the earlier index, so the
 * output is deterministic. Negative totals (e.g. a discount) are supported.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total)) throw new Error('allocate: total must be an integer');
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) {
    throw new Error('allocate: weights must be non-negative integers');
  }
  return allocateBig(total, weights.map((w) => BigInt(w)));
}

/** Same as `allocate`, with BigInt weights (used for exact fractional shares). */
export function allocateBig(total: number, weights: bigint[]): number[] {
  if (weights.length === 0) {
    if (total === 0) return [];
    throw new Error('allocate: no weights to allocate to');
  }
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) {
    if (total === 0) return weights.map(() => 0);
    // No basis for proportion: fall back to equal parts.
    return allocateBig(total, weights.map(() => 1n));
  }
  // Exact integer arithmetic so huge amounts (e.g. IDR, VND) never drift.
  const sign = total < 0 ? -1 : 1;
  const abs = BigInt(Math.abs(total));
  const floors: bigint[] = [];
  const remainders: bigint[] = [];
  for (const w of weights) {
    const scaled = abs * w;
    floors.push(scaled / sum);
    remainders.push(scaled % sum);
  }
  let leftover = Number(abs - floors.reduce((a, b) => a + b, 0n));
  const order = weights
    .map((w, i) => ({ i, rem: remainders[i], w }))
    .filter((e) => e.w > 0n)
    .sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  const result = floors.map((f) => Number(f));
  for (let k = 0; leftover > 0; k = (k + 1) % order.length) {
    result[order[k].i] += 1;
    leftover -= 1;
  }
  return result.map((x) => (x === 0 ? 0 : x * sign));
}

// Precision used to carry each person's exact (fractional) item share into the
// final allocation, so rounding happens once over the whole bill.
const SHARE_PRECISION = 1_000_000_000n;

function netExtras(e: Extras): number {
  return (e.taxMinor ?? 0) + (e.serviceMinor ?? 0) + (e.tipMinor ?? 0) - (e.discountMinor ?? 0);
}

export function computeSplit(input: SplitInput): SplitResult {
  if (input.mode === 'equal') return computeEqual(input);
  return computeItemized(input);
}

function computeEqual(input: EqualSplitInput): SplitResult {
  const participants = [...new Set(input.participants)];
  const issues: SplitIssue[] = [];
  if (participants.length === 0) issues.push({ kind: 'no-participants' });
  if (input.totalMinor < 0) issues.push({ kind: 'negative-total' });
  if (issues.length > 0) {
    return { ok: false, issues, subtotalMinor: input.totalMinor, extrasMinor: 0, totalMinor: input.totalMinor, shares: [] };
  }
  const parts = allocate(input.totalMinor, participants.map(() => 1));
  return {
    ok: true,
    issues,
    subtotalMinor: input.totalMinor,
    extrasMinor: 0,
    totalMinor: input.totalMinor,
    shares: participants.map((userId, i) => ({
      userId,
      itemsMinor: parts[i],
      extrasMinor: 0,
      totalMinor: parts[i],
    })),
  };
}

function computeItemized(input: ItemizedSplitInput): SplitResult {
  const issues: SplitIssue[] = [];
  if (input.items.length === 0) issues.push({ kind: 'no-items' });

  const itemsByUser = new Map<string, number>();
  const exactByUser = new Map<string, bigint>();
  const order: string[] = [];
  let subtotal = 0;

  input.items.forEach((item, index) => {
    if (!Number.isInteger(item.lineTotalMinor) || item.lineTotalMinor < 0) {
      issues.push({ kind: 'invalid-amount', index, name: item.name });
      return;
    }
    subtotal += item.lineTotalMinor;
    const shares = item.shares.filter((s) => s.weight > 0);
    if (shares.length === 0) {
      if (item.lineTotalMinor > 0) issues.push({ kind: 'unassigned-item', index, name: item.name });
      return;
    }
    // Merge duplicate users on the same item.
    const merged = new Map<string, number>();
    for (const s of shares) merged.set(s.userId, (merged.get(s.userId) ?? 0) + s.weight);
    const users = [...merged.keys()];
    const weights = users.map((u) => merged.get(u)!);
    const weightSum = BigInt(weights.reduce((a, b) => a + b, 0));
    const parts = allocate(item.lineTotalMinor, weights);
    users.forEach((u, i) => {
      if (!itemsByUser.has(u)) {
        itemsByUser.set(u, 0);
        exactByUser.set(u, 0n);
        order.push(u);
      }
      itemsByUser.set(u, itemsByUser.get(u)! + parts[i]);
      const exact = (BigInt(item.lineTotalMinor) * BigInt(weights[i]) * SHARE_PRECISION) / weightSum;
      exactByUser.set(u, exactByUser.get(u)! + exact);
    });
  });

  const extras = netExtras(input);
  const total = subtotal + extras;
  if (total < 0) issues.push({ kind: 'negative-total' });

  // Each person's total is their exact fraction of the item subtotal applied to
  // the whole bill, rounded once. Items are shown rounded; extras take the rest.
  const userSubtotals = order.map((u) => itemsByUser.get(u)!);
  const totals =
    order.length > 0 && total >= 0 ? allocateBig(total, order.map((u) => exactByUser.get(u)!)) : [];

  const shares: PersonShare[] = order.map((userId, i) => ({
    userId,
    itemsMinor: userSubtotals[i],
    extrasMinor: (totals[i] ?? userSubtotals[i]) - userSubtotals[i],
    totalMinor: totals[i] ?? userSubtotals[i],
  }));

  return {
    ok: issues.length === 0,
    issues,
    subtotalMinor: subtotal,
    extrasMinor: extras,
    totalMinor: total,
    shares,
  };
}

/**
 * Convert each person's share into the trip's base currency so that the
 * converted parts add up exactly to the converted bill total.
 */
export function convertShares(
  shares: { userId: string; totalMinor: number }[],
  totalBaseMinor: number,
): { userId: string; amountBaseMinor: number }[] {
  const parts = allocate(
    totalBaseMinor,
    shares.map((s) => Math.max(0, s.totalMinor)),
  );
  return shares.map((s, i) => ({ userId: s.userId, amountBaseMinor: parts[i] }));
}

/** Human-readable description of a split problem for the bill editor. */
export function describeIssue(issue: SplitIssue): string {
  switch (issue.kind) {
    case 'no-items':
      return 'Add at least one item.';
    case 'no-participants':
      return 'Choose who is splitting this bill.';
    case 'unassigned-item':
      return `"${issue.name || `Item ${issue.index + 1}`}" isn't assigned to anyone yet.`;
    case 'negative-total':
      return 'The discount is bigger than the bill.';
    case 'invalid-amount':
      return `"${issue.name || `Item ${issue.index + 1}`}" has an invalid price.`;
  }
}
