import { describe, expect, it } from 'vitest';

import { featuredTrip, greeting, parseInviteCode, planningSteps, tripStatus } from '../../src/lib/trip-status';

const trip = (starts_on: string | null, ends_on: string | null, extra: Record<string, unknown> = {}) => ({
  starts_on,
  ends_on,
  ended_at: null as string | null,
  created_at: '2026-11-01T00:00:00Z',
  cover_path: null as string | null,
  ...extra,
});

describe('tripStatus', () => {
  const today = '2026-11-10';
  it('counts down to an upcoming trip', () => {
    expect(tripStatus(trip('2026-12-04', '2026-12-08'), today)).toEqual({ kind: 'upcoming', label: 'Upcoming', countdown: 'In 24 days', daysToGo: 24 });
    expect(tripStatus(trip('2026-11-11', null), today).countdown).toBe('Tomorrow');
  });
  it('shows the day of a trip that’s on now', () => {
    expect(tripStatus(trip('2026-11-09', '2026-11-12'), today).countdown).toBe('Day 2 of 4');
    expect(tripStatus(trip('2026-11-10', null), today)).toMatchObject({ kind: 'ongoing', countdown: 'Day 1' });
    expect(tripStatus(trip('2026-11-05', '2026-11-09'), today)).toMatchObject({ kind: 'ongoing', countdown: 'Last day' });
  });
  it('planning without dates; completed when ended or past its end', () => {
    expect(tripStatus(trip(null, null), today).kind).toBe('planning');
    expect(tripStatus(trip('2026-10-01', '2026-10-05'), today).kind).toBe('completed');
    expect(tripStatus(trip(null, null, { ended_at: '2026-11-01T00:00:00Z' }), today).kind).toBe('completed');
  });
});

describe('featuredTrip', () => {
  const today = '2026-11-10';
  it('prefers the trip on now, then the next one, then the newest being planned', () => {
    const later = { ...trip('2026-12-20', null), id: 'later' };
    const soon = { ...trip('2026-11-20', null), id: 'soon' };
    const now = { ...trip('2026-11-09', '2026-11-12'), id: 'now' };
    const idea = { ...trip(null, null, { created_at: '2026-11-08T00:00:00Z' }), id: 'idea' };
    const past = { ...trip('2026-10-01', '2026-10-02'), id: 'past' };
    expect(featuredTrip([later, soon, now, idea, past], today)?.id).toBe('now');
    expect(featuredTrip([later, soon, idea, past], today)?.id).toBe('soon');
    expect(featuredTrip([idea, { ...trip(null, null), id: 'older' }, past], today)?.id).toBe('idea');
    expect(featuredTrip([past], today)).toBeNull();
  });
});

describe('planningSteps', () => {
  it('measures progress from real data', () => {
    const p = planningSteps({ starts_on: '2026-12-01', cover_path: null }, { members: 3, stay_pinned: true, stops: 0 });
    expect(p.steps.filter((s) => s.done).map((s) => s.key)).toEqual(['dates', 'friends', 'stay']);
    expect(p).toMatchObject({ done: 3, percent: 60 });
    expect(planningSteps({ starts_on: null, cover_path: null }, undefined).percent).toBe(0);
    const withPacking = planningSteps({ starts_on: null, cover_path: null }, {}, [{ key: 'packing', label: 'Packed', done: true }]);
    expect(withPacking).toMatchObject({ done: 1, percent: 17 });
  });
});

describe('small helpers', () => {
  it('greets by time of day', () => {
    expect(greeting(8)).toBe('Good morning');
    expect(greeting(14)).toBe('Good afternoon');
    expect(greeting(21)).toBe('Good evening');
  });
  it('reads invite codes from links or typed codes', () => {
    expect(parseInviteCode('https://tripley.app/join/ab12cd34ef56')).toBe('ab12cd34ef56');
    expect(parseInviteCode('https://x.up.railway.app/join/AB12CD34EF56?ref=wa')).toBe('ab12cd34ef56');
    expect(parseInviteCode(' AB12 CD34 EF56 ')).toBe('ab12cd34ef56');
    expect(parseInviteCode('ab12-cd34-ef56')).toBe('ab12cd34ef56');
    expect(parseInviteCode('hello')).toBeNull();
    expect(parseInviteCode('https://evil.example/join/../../x')).toBeNull();
  });
});
