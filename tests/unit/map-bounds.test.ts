import { describe, expect, it } from 'vitest';

import { boundsOf } from '../../src/components/TripMap.types';

describe('boundsOf', () => {
  it('is null with nobody on the map', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('centres a ~200 m window on one person', () => {
    const [w, s, e, n] = boundsOf([{ lat: 51.1784, lng: -115.5708 }])!;
    expect(e - w).toBeCloseTo(0.002, 9);
    expect(n - s).toBeCloseTo(0.002, 9);
    expect((w + e) / 2).toBeCloseTo(-115.5708, 9);
    expect((s + n) / 2).toBeCloseTo(51.1784, 9);
  });

  it('keeps friends a street apart inside the window, not padded far beyond it', () => {
    const people = [
      { lat: 51.1784, lng: -115.5708 },
      { lat: 51.1792, lng: -115.5703 },
    ];
    const [w, s, e, n] = boundsOf(people)!;
    expect(n - s).toBeCloseTo(0.002, 9);
    expect(e - w).toBeCloseTo(0.002, 9);
    for (const p of people) {
      expect(p.lat).toBeGreaterThan(s);
      expect(p.lat).toBeLessThan(n);
      expect(p.lng).toBeGreaterThan(w);
      expect(p.lng).toBeLessThan(e);
    }
  });

  it('uses the exact extent when people are spread out', () => {
    expect(boundsOf([{ lat: 15.55, lng: 73.75 }, { lat: 15.6, lng: 73.9 }])).toEqual([73.75, 15.55, 73.9, 15.6]);
  });
});
