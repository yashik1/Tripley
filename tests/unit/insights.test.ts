import { describe, expect, it } from 'vitest';

import { lastSeenText, tripInsights } from '../../src/lib/insights';

const now = Date.parse('2026-11-12T12:00:00Z');
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

describe('organizer insights', () => {
  const result = tripInsights({
    members: [
      { user_id: 'ana', location_sharing: true, sharing_mode: 'live' },
      { user_id: 'ben', location_sharing: true, sharing_mode: 'saver' },
      { user_id: 'cleo', location_sharing: true, sharing_mode: 'live' },
      { user_id: 'dan', location_sharing: false, sharing_mode: 'live' },
    ],
    locations: [
      { user_id: 'ana', updated_at: ago(1) },
      { user_id: 'ben', updated_at: ago(12) },
      { user_id: 'cleo', updated_at: ago(95) },
      { user_id: 'dan', updated_at: ago(5) },
    ],
    net: new Map([
      ['ana', 50_00],
      ['ben', -30_00],
      ['cleo', -20_00],
    ]),
    openPolls: [{ voters: ['ana', 'ben'] }, { voters: ['ana'] }],
    upcomingStops: [{ id: 's1' }, { id: 's2' }],
    rsvps: [
      { item_id: 's1', user_id: 'ana' },
      { item_id: 's2', user_id: 'ana' },
      { item_id: 's1', user_id: 'ben' },
      { item_id: 'past', user_id: 'cleo' },
    ],
    datesOpen: true,
    datesAnswered: new Set(['ana', 'cleo']),
    now,
  });
  const by = Object.fromEntries(result.members.map((m) => [m.userId, m]));

  it('who is sharing, in which mode, and who has gone quiet', () => {
    expect([by.ana.sharing, by.ben.sharing, by.cleo.sharing, by.dan.sharing]).toEqual(['live', 'saver', 'stale', 'paused']);
    expect(by.cleo.lastSeenMin).toBe(95);
    expect(by.dan.lastSeenMin).toBeNull(); // paused: their last position isn't shown
    expect([result.sharingCount, result.staleCount]).toEqual([2, 1]);
  });

  it('who owes, and who answered what is open', () => {
    expect(result.owingCount).toBe(2);
    expect([by.ben.pollsVoted, by.ben.pollsOpen, by.ben.rsvpsAnswered, by.ben.rsvpsUpcoming, by.ben.datesAnswered]).toEqual([1, 2, 1, 2, false]);
    expect(by.cleo.rsvpsAnswered).toBe(0); // only upcoming plans count
    expect(result.allAnswered).toBe(false);
  });

  it('says how long ago, simply', () => {
    expect([lastSeenText(null), lastSeenText(1), lastSeenText(12), lastSeenText(95), lastSeenText(3000)]).toEqual([
      'no position yet',
      'just now',
      '12 min ago',
      '2 h ago',
      '2 days ago',
    ]);
  });
});
