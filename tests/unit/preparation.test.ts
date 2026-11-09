import { describe, expect, it } from 'vitest';

import { CHALLENGE_IDEAS, missingStarters, PACKING_STARTERS, packingStep, progress } from '../../src/lib/preparation';
import { planningSteps } from '../../src/lib/trip-status';

describe('preparation', () => {
  it('suggests only the common items you have not added', () => {
    const missing = missingStarters([{ title: 'passport or id ' }, { title: 'Sunscreen' }, { title: 'Snacks' }]);
    expect(missing).not.toContain('Passport or ID');
    expect(missing).not.toContain('Sunscreen');
    expect(missing).toHaveLength(PACKING_STARTERS.length - 2);
  });

  it('counts progress', () => {
    expect(progress([{ done: true }, { done: false }, { done: true }])).toEqual({ done: 2, total: 3, percent: 67 });
    expect(progress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it('packing is done only when everything on your list is packed', () => {
    expect(packingStep({ packing_total: 0, packing_done: 0 }).done).toBe(false);
    expect(packingStep({ packing_total: 4, packing_done: 3 }).done).toBe(false);
    expect(packingStep({ packing_total: 4, packing_done: 4 }).done).toBe(true);
    const p = planningSteps({ starts_on: '2026-12-01', cover_path: null }, { members: 2 }, [packingStep({ packing_total: 1, packing_done: 1 })]);
    expect(p).toMatchObject({ done: 3, percent: 50 });
  });

  it('challenge ideas never ask for locations or personal details', () => {
    for (const c of CHALLENGE_IDEAS) expect(`${c.title} ${c.description}`).not.toMatch(/location|address|phone|share where/i);
  });
});
