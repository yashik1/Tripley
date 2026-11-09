import { describe, expect, it } from 'vitest';

import { BADGES, passport } from '../../src/lib/passport';

describe('passport', () => {
  it('lists earned badges first (oldest first), then the rest', () => {
    const list = passport([
      { key: 'food_explorer', earned_at: '2026-11-08T10:00:00Z' },
      { key: 'first_trip', earned_at: '2026-11-01T10:00:00Z' },
      { key: 'not_a_badge', earned_at: '2026-11-02T10:00:00Z' },
    ]);
    expect(list.slice(0, 2).map((b) => b.key)).toEqual(['first_trip', 'food_explorer']);
    expect(list.slice(2).every((b) => b.earnedAt === null)).toBe(true);
    expect(list).toHaveLength(BADGES.length);
  });

  it('every badge says exactly how to earn it', () => {
    for (const b of BADGES) expect(b.condition.length).toBeGreaterThan(10);
  });
});
