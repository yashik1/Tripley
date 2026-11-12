import { describe, expect, it } from 'vitest';

import { addDays, answered, bestDates, calendarWeeks, dayCounts, windowDays } from '../../src/lib/date-coordination';
import type { Availability } from '../../src/lib/types';

const yes = (user_id: string, ...days: string[]): Availability[] => days.map((day) => ({ user_id, day, status: 'yes' as const }));
const maybe = (user_id: string, ...days: string[]): Availability[] => days.map((day) => ({ user_id, day, status: 'maybe' as const }));
const range = (from: string, n: number) => windowDays(from, addDays(from, n - 1));

describe('bestDates', () => {
  const window = { start: '2027-03-01', end: '2027-03-14' };

  it('finds the stretch everyone can make', () => {
    const answers = [...yes('ana', ...range('2027-03-01', 14)), ...yes('ben', ...range('2027-03-05', 5)), ...yes('cleo', ...range('2027-03-04', 6))];
    const [best] = bestDates(answers, ['ana', 'ben', 'cleo'], window.start, window.end, 4);
    expect(best).toMatchObject({ start: '2027-03-05', end: '2027-03-08', everyDay: ['ana', 'ben', 'cleo'], missing: [] });
  });

  it('when nobody overlaps fully, the most people first, and says who can’t', () => {
    const answers = [...yes('ana', ...range('2027-03-01', 5)), ...yes('ben', ...range('2027-03-02', 4)), ...yes('cleo', ...range('2027-03-10', 4))];
    const [best, next] = bestDates(answers, ['ana', 'ben', 'cleo'], window.start, window.end, 3);
    expect(best).toMatchObject({ everyDay: ['ana', 'ben'], missing: ['cleo'] });
    expect(next).toMatchObject({ start: '2027-03-10', everyDay: ['cleo'] });
  });

  it('“maybe” counts half, and stretches don’t repeat each other', () => {
    const answers = [...yes('ana', ...range('2027-03-01', 14)), ...maybe('ben', ...range('2027-03-01', 3)), ...yes('ben', ...range('2027-03-08', 3))];
    const options = bestDates(answers, ['ana', 'ben'], window.start, window.end, 3);
    expect(options[0]).toMatchObject({ start: '2027-03-08', everyDay: ['ana', 'ben'] });
    expect(options[1]).toMatchObject({ start: '2027-03-01', maybe: ['ben'] });
    for (let i = 1; i < options.length; i++) {
      expect(options.slice(0, i).some((p) => options[i].start <= p.end && p.start <= options[i].end)).toBe(false);
    }
  });

  it('people who haven’t answered count as missing; nothing offered if nobody can', () => {
    expect(bestDates([], ['ana'], window.start, window.end, 2)).toEqual([]);
    const [best] = bestDates(yes('ana', '2027-03-01', '2027-03-02'), ['ana', 'ben'], window.start, window.end, 2);
    expect(best.missing).toEqual(['ben']);
  });

  it('a trip longer than the window has no options', () => {
    expect(bestDates(yes('ana', ...range('2027-03-01', 14)), ['ana'], window.start, window.end, 15)).toEqual([]);
  });
});

describe('helpers', () => {
  it('counts, who answered, and calendar weeks starting on Monday', () => {
    const answers = [...yes('ana', '2027-03-01'), ...maybe('ben', '2027-03-01')];
    expect(dayCounts(answers).get('2027-03-01')).toEqual({ yes: 1, maybe: 1 });
    expect([...answered(answers)].sort()).toEqual(['ana', 'ben']);
    // 3 March 2027 is a Wednesday.
    const weeks = calendarWeeks(windowDays('2027-03-03', '2027-03-09'));
    expect(weeks[0]).toEqual([null, null, '2027-03-03', '2027-03-04', '2027-03-05', '2027-03-06', '2027-03-07']);
    expect(weeks[1]).toEqual(['2027-03-08', '2027-03-09', null, null, null, null, null]);
  });
});
