import { describe, expect, it } from 'vitest';

import { DEFAULT_SECTIONS, recapText, type RecapData } from '../../src/lib/recap';

const data: RecapData = {
  name: 'Lisbon long weekend',
  destination: 'Lisbon, Portugal',
  dates: 'Dec 3 – Dec 6',
  days: 4,
  people: ['Ana', 'Ben', 'Cleo'],
  highlights: ['Tile museum (3 going)'],
  places: ['Time Out Market'],
  decisions: [{ question: 'Where should we eat?', winner: 'Pizza' }],
  photoCount: 12,
  postCount: 30,
  totalSpent: '€640.00',
};

describe('recapText', () => {
  it('includes the chosen sections', () => {
    const text = recapText(data, DEFAULT_SECTIONS);
    expect(text).toContain('✈️ Lisbon long weekend · Lisbon, Portugal');
    expect(text).toContain('🗓️ Dec 3 – Dec 6 (4 days)');
    expect(text).toContain('• Where should we eat? → Pizza');
    expect(text).toContain('📸 12 photos and 30 posts shared');
  });
  it('leaves out what wasn’t chosen; spending only if asked, and only the group total', () => {
    const text = recapText(data, ['dates']);
    expect(text).not.toContain('Ana');
    expect(text).not.toContain('Time Out Market');
    expect(text).not.toContain('€640.00');
    expect(recapText(data, [...DEFAULT_SECTIONS, 'spend'])).toContain('💸 €640.00 spent together');
  });
});
