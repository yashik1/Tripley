import { describe, expect, it } from 'vitest';
import { allocate, computeSplit, convertShares } from '../../src/lib/split';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('allocate', () => {
  it('splits 100 three ways as 34/33/33', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
  it('respects weights', () => {
    expect(allocate(1000, [2, 1, 1])).toEqual([500, 250, 250]);
    expect(allocate(1001, [2, 1])).toEqual([667, 334]);
  });
  it('always sums exactly, for awkward numbers', () => {
    for (const total of [1, 7, 99, 100, 101, 12345, 999_999]) {
      for (const weights of [[1, 1, 1], [3, 7], [1, 2, 3, 4, 5, 6, 7], [13, 1, 1]]) {
        expect(sum(allocate(total, weights))).toBe(total);
      }
    }
  });
  it('handles negative totals (discounts)', () => {
    const parts = allocate(-100, [1, 1, 1]);
    expect(parts).toEqual([-34, -33, -33]);
    expect(sum(parts)).toBe(-100);
  });
  it('gives nothing to zero weights', () => {
    expect(allocate(100, [0, 1, 1])).toEqual([0, 50, 50]);
  });
  it('falls back to equal parts when all weights are zero', () => {
    expect(allocate(10, [0, 0])).toEqual([5, 5]);
  });
  it('stays exact for very large amounts (VND / IDR)', () => {
    const total = 9_007_199_254_740; // close to float precision limits once multiplied
    const parts = allocate(total, [123_456_789, 987_654_321, 555_555_555]);
    expect(sum(parts)).toBe(total);
  });
  it('rejects bad weights', () => {
    expect(() => allocate(100, [1.5, 1])).toThrow();
    expect(() => allocate(100, [-1, 2])).toThrow();
  });
});

describe('computeSplit itemized', () => {
  it('splits items and shares tax/tip proportionally', () => {
    const r = computeSplit({
      mode: 'itemized',
      items: [
        { name: 'Pizza', lineTotalMinor: 3000, shares: [{ userId: 'a', weight: 1 }, { userId: 'b', weight: 1 }, { userId: 'c', weight: 1 }] },
        { name: 'Beer', lineTotalMinor: 1200, shares: [{ userId: 'a', weight: 1 }] },
        { name: 'Salad', lineTotalMinor: 800, shares: [{ userId: 'b', weight: 1 }] },
      ],
      taxMinor: 500,
      tipMinor: 500,
    });
    expect(r.ok).toBe(true);
    expect(r.subtotalMinor).toBe(5000);
    expect(r.totalMinor).toBe(6000);
    const byUser = Object.fromEntries(r.shares.map((s) => [s.userId, s]));
    // a: 1000 + 1200 = 2200 (44%) -> extras 440
    expect(byUser.a.itemsMinor).toBe(2200);
    expect(byUser.a.extrasMinor).toBe(440);
    // b: 1000 + 800 = 1800 (36%) -> extras 360
    expect(byUser.b.totalMinor).toBe(2160);
    // c: 1000 (20%) -> extras 200
    expect(byUser.c.totalMinor).toBe(1200);
    expect(sum(r.shares.map((s) => s.totalMinor))).toBe(r.totalMinor);
  });

  it('applies discounts and service charge', () => {
    const r = computeSplit({
      mode: 'itemized',
      items: [
        { name: 'A', lineTotalMinor: 999, shares: [{ userId: 'x', weight: 1 }] },
        { name: 'B', lineTotalMinor: 1001, shares: [{ userId: 'y', weight: 1 }] },
      ],
      serviceMinor: 200,
      discountMinor: 333,
    });
    expect(r.totalMinor).toBe(2000 + 200 - 333);
    expect(sum(r.shares.map((s) => s.totalMinor))).toBe(r.totalMinor);
  });

  it('supports weights on a shared item (one person had two of three slices)', () => {
    const r = computeSplit({
      mode: 'itemized',
      items: [{ name: 'Cake', lineTotalMinor: 900, shares: [{ userId: 'a', weight: 2 }, { userId: 'b', weight: 1 }] }],
    });
    expect(r.shares).toEqual([
      { userId: 'a', itemsMinor: 600, extrasMinor: 0, totalMinor: 600 },
      { userId: 'b', itemsMinor: 300, extrasMinor: 0, totalMinor: 300 },
    ]);
  });

  it('merges duplicate assignees on one item', () => {
    const r = computeSplit({
      mode: 'itemized',
      items: [{ name: 'X', lineTotalMinor: 300, shares: [{ userId: 'a', weight: 1 }, { userId: 'a', weight: 1 }, { userId: 'b', weight: 1 }] }],
    });
    expect(r.shares.find((s) => s.userId === 'a')!.totalMinor).toBe(200);
  });

  it('reports unassigned items and missing items', () => {
    const r = computeSplit({
      mode: 'itemized',
      items: [
        { name: 'Fries', lineTotalMinor: 400, shares: [] },
        { name: 'Free water', lineTotalMinor: 0, shares: [] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([{ kind: 'unassigned-item', index: 0, name: 'Fries' }]);
    expect(computeSplit({ mode: 'itemized', items: [] }).issues[0].kind).toBe('no-items');
  });

  it('flags a discount bigger than the bill', () => {
    const r = computeSplit({
      mode: 'itemized',
      items: [{ name: 'A', lineTotalMinor: 100, shares: [{ userId: 'a', weight: 1 }] }],
      discountMinor: 500,
    });
    expect(r.issues.some((i) => i.kind === 'negative-total')).toBe(true);
  });

  it('works for zero-decimal currencies like JPY', () => {
    const r = computeSplit({
      mode: 'itemized',
      items: [{ name: 'Ramen', lineTotalMinor: 2500, shares: ['a', 'b', 'c'].map((userId) => ({ userId, weight: 1 })) }],
      taxMinor: 250,
    });
    expect(r.shares.map((s) => s.totalMinor)).toEqual([917, 917, 916]);
  });
});

describe('computeSplit equal', () => {
  it('splits a total evenly with exact remainder handling', () => {
    const r = computeSplit({ mode: 'equal', totalMinor: 1000, participants: ['a', 'b', 'c'] });
    expect(r.shares.map((s) => s.totalMinor)).toEqual([334, 333, 333]);
  });
  it('ignores duplicate participants', () => {
    const r = computeSplit({ mode: 'equal', totalMinor: 1000, participants: ['a', 'a', 'b'] });
    expect(r.shares.map((s) => s.totalMinor)).toEqual([500, 500]);
  });
  it('requires participants', () => {
    expect(computeSplit({ mode: 'equal', totalMinor: 1000, participants: [] }).ok).toBe(false);
  });
});

describe('convertShares', () => {
  it('keeps converted shares summing to the converted total', () => {
    const shares = [
      { userId: 'a', totalMinor: 3333 },
      { userId: 'b', totalMinor: 3333 },
      { userId: 'c', totalMinor: 3334 },
    ];
    const converted = convertShares(shares, 905_123); // e.g. EUR 100.00 -> INR 9051.23
    expect(sum(converted.map((c) => c.amountBaseMinor))).toBe(905_123);
  });
});

describe('computeSplit randomized invariants', () => {
  // Small deterministic PRNG so failures are reproducible.
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

  it('always sums exactly and is fair to within one minor unit', () => {
    const people = ['a', 'b', 'c', 'd', 'e'];
    for (let run = 0; run < 500; run++) {
      const items = Array.from({ length: int(1, 8) }, (_, i) => ({
        name: `i${i}`,
        lineTotalMinor: int(0, 50_000),
        shares: people.filter(() => rand() < 0.5).map((userId) => ({ userId, weight: int(1, 3) })),
      })).map((it) => (it.shares.length ? it : { ...it, shares: [{ userId: 'a', weight: 1 }] }));
      const subtotal = items.reduce((a, i) => a + i.lineTotalMinor, 0);
      const taxMinor = int(0, 5000);
      const tipMinor = int(0, 5000);
      const discountMinor = int(0, Math.min(subtotal, 3000));
      const r = computeSplit({ mode: 'itemized', items, taxMinor, tipMinor, discountMinor });
      expect(r.ok).toBe(r.totalMinor >= 0);
      if (!r.ok) continue;
      expect(sum(r.shares.map((s) => s.totalMinor))).toBe(r.totalMinor);
      if (subtotal === 0) continue;
      for (const s of r.shares) {
        // exact fair share = (person's exact item share / subtotal) * total
        const exactItems = items.reduce((acc, it) => {
          const w = it.shares.filter((x) => x.userId === s.userId).reduce((a, x) => a + x.weight, 0);
          const W = it.shares.reduce((a, x) => a + x.weight, 0);
          return acc + (it.lineTotalMinor * w) / W;
        }, 0);
        const fair = (exactItems / subtotal) * r.totalMinor;
        expect(Math.abs(s.totalMinor - fair)).toBeLessThan(1.0001);
      }
    }
  });
});
