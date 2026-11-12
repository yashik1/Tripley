import { describe, expect, it } from 'vitest';

import { categoryOf, closingLabel, pollIsOpen, pollResults, rankSuggestions } from '../../src/lib/group-decisions';
import type { Poll, Suggestion } from '../../src/lib/types';

const NOW = Date.parse('2026-11-10T12:00:00Z');

const poll = (votes: [string, string][], extra: Partial<Poll> = {}): Poll => ({
  id: 'p',
  trip_id: 't',
  created_by: 'me',
  question: 'Where should we eat?',
  allow_change: true,
  multiple: false,
  closes_at: null,
  closed_at: null,
  created_at: '',
  updated_at: null,
  poll_options: [
    { id: 'b', label: 'Pizza', position: 1 },
    { id: 'a', label: 'Taberna', position: 0 },
    { id: 'c', label: 'Ramen', position: 2 },
  ],
  poll_votes: votes.map(([user_id, option_id]) => ({ user_id, option_id })),
  ...extra,
});

describe('pollResults', () => {
  it('counts votes per option in order, with percentages and the leader', () => {
    const r = pollResults(poll([['me', 'a'], ['sam', 'a'], ['lee', 'c']]), 'me', NOW);
    expect(r.total).toBe(3);
    expect(r.myVote).toBe('a');
    expect(r.options.map((o) => [o.label, o.count, o.percent, o.mine, o.leading])).toEqual([
      ['Taberna', 2, 67, true, true],
      ['Pizza', 0, 0, false, false],
      ['Ramen', 1, 33, false, false],
    ]);
  });
  it('no votes: nobody leads', () => {
    expect(pollResults(poll([]), 'me', NOW).options.every((o) => !o.leading && o.percent === 0)).toBe(true);
  });
  it('more than one choice: counts people, so percentages can add up past 100', () => {
    const r = pollResults(poll([['me', 'a'], ['me', 'c'], ['sam', 'a']], { multiple: true }), 'me', NOW);
    expect(r.total).toBe(2);
    expect(r.myVotes).toEqual(['a', 'c']);
    expect(r.myVote).toBe('a');
    expect(r.options.map((o) => [o.label, o.count, o.percent, o.mine])).toEqual([
      ['Taberna', 2, 100, true],
      ['Pizza', 0, 0, false],
      ['Ramen', 1, 50, true],
    ]);
  });
  it('ties share the lead', () => {
    expect(pollResults(poll([['x', 'a'], ['y', 'b']]), 'me', NOW).options.filter((o) => o.leading).map((o) => o.label)).toEqual(['Taberna', 'Pizza']);
  });
});

describe('closing', () => {
  it('open until closed or past its time', () => {
    expect(pollIsOpen(poll([]), NOW)).toBe(true);
    expect(pollIsOpen(poll([], { closed_at: '2026-11-10T11:00:00Z' }), NOW)).toBe(false);
    expect(pollIsOpen(poll([], { closes_at: '2026-11-10T11:59:00Z' }), NOW)).toBe(false);
  });
  it('says when it closes', () => {
    expect(closingLabel(poll([], { closes_at: '2026-11-10T12:40:00Z' }), NOW)).toBe('Closes in 40 min');
    expect(closingLabel(poll([], { closes_at: '2026-11-10T15:00:00Z' }), NOW)).toBe('Closes in 3 h');
    expect(closingLabel(poll([], { closes_at: '2026-11-13T12:00:00Z' }), NOW)).toBe('Closes in 3 days');
    expect(closingLabel(poll([]), NOW)).toBeNull();
    expect(closingLabel(poll([], { closed_at: '2026-11-10T11:00:00Z' }), NOW)).toBe('Closed');
  });
});

describe('suggestions', () => {
  const s = (id: string, votes: number, created: string, planned = false) =>
    ({ id, created_at: created, itinerary_item_id: planned ? 'x' : null, suggestion_votes: Array.from({ length: votes }, (_, i) => ({ user_id: `u${i}` })) }) as Suggestion;
  it('most votes first, newest breaks ties, planned ones last', () => {
    const list = [s('old', 2, '2026-11-01'), s('new', 2, '2026-11-05'), s('top', 4, '2026-11-02'), s('done', 9, '2026-11-03', true), s('none', 0, '2026-11-09')];
    expect(rankSuggestions(list).map((x) => x.id)).toEqual(['top', 'new', 'old', 'none', 'done']);
  });
  it('knows its categories', () => {
    expect(categoryOf('beach').emoji).toBe('🏖️');
    expect(categoryOf('unknown').key).toBe('other');
  });
});

describe('ranked polls', () => {
  const opts = ['Sintra', 'Belém', 'Cascais'].map((label, position) => ({ id: label, label, position, suggestion_id: null, itinerary_item_id: null }));
  const poll = (votes: [string, string, number][]) =>
    ({
      id: 'p',
      trip_id: 't',
      question: 'Where first?',
      created_by: 'ana',
      closes_at: null,
      closed_at: null,
      allow_change: true,
      multiple: false,
      ranked: true,
      created_at: '2026-11-01',
      updated_at: null,
      poll_options: opts,
      poll_votes: votes.map(([user_id, option_id, rank]) => ({ user_id, option_id, rank })),
    }) as unknown as Parameters<typeof pollResults>[0];

  it('scores a Borda count: first choice 3 points of 3, second 2, third 1', () => {
    const r = pollResults(
      poll([
        ['ana', 'Belém', 1], ['ana', 'Sintra', 2], ['ana', 'Cascais', 3],
        ['ben', 'Sintra', 1], ['ben', 'Cascais', 2],
        ['cleo', 'Sintra', 1],
      ]),
      'ana',
    );
    expect(r.total).toBe(3);
    expect(r.options.map((o) => [o.label, o.points, o.count, o.leading])).toEqual([
      ['Sintra', 2 + 3 + 3, 2, true],
      ['Belém', 3, 1, false],
      ['Cascais', 1 + 2, 0, false],
    ]);
    expect(r.myVotes).toEqual(['Belém', 'Sintra', 'Cascais']);
    expect(r.options.find((o) => o.label === 'Belém')?.myRank).toBe(1);
    expect(r.options[0].percent).toBe(100);
  });

  it('no rankings yet: nobody leads', () => {
    const r = pollResults(poll([]), 'ana');
    expect(r.options.every((o) => !o.leading && o.points === 0)).toBe(true);
    expect(r.myVote).toBeNull();
  });
});
