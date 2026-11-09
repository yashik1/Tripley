import { describe, expect, it } from 'vitest';

import { eventEmoji, eventText, reactionCounts } from '../../src/lib/feed';
import { REACTIONS } from '../../src/lib/types';

describe('automatic posts', () => {
  it('say what happened', () => {
    expect(eventText({ type: 'trip_started' }, 'Ana')).toBe('Ana started the trip');
    expect(eventText({ type: 'member_joined' }, 'Ben')).toBe('Ben joined the trip 👋');
    expect(eventText({ type: 'place_pinned', place_kind: 'food', label: 'Time Out Market' }, 'Cleo')).toBe('Cleo found a great place to eat: Time Out Market');
    expect(eventText({ type: 'place_pinned', place_kind: 'stay', label: 'Casa' }, 'Ana')).toBe("Ana pinned where you're staying: Casa");
    expect(eventText({ type: 'stop_added', label: 'Tram 28' }, 'Ana')).toBe('Ana added "Tram 28" to the plan');
    expect(eventText({ type: 'bill_added', label: 'Dinner' }, 'Ben')).toBe('Ben added a bill: Dinner');
    expect(eventText({ type: 'something_new' }, 'Ana')).toBe('Ana updated the trip');
    expect(eventEmoji({ type: 'bill_added' })).toBe('🧾');
  });
});

describe('reactionCounts', () => {
  it('counts each emoji in order and marks mine', () => {
    const r = reactionCounts(
      [
        { user_id: 'a', emoji: '🔥' },
        { user_id: 'me', emoji: '❤️' },
        { user_id: 'b', emoji: '❤️' },
      ],
      'me',
      REACTIONS,
    );
    expect(r).toEqual([
      { emoji: '❤️', count: 2, mine: true },
      { emoji: '🔥', count: 1, mine: false },
    ]);
  });
});
