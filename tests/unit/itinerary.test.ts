import { describe, expect, it } from 'vitest';

import { defaultDay, findConflicts, parseTime, planDays, rsvpSummary, stopsForMap, suggestFreeSlot, timeRange } from '../../src/lib/itinerary';
import type { ItineraryItem } from '../../src/lib/types';

const item = (id: string, day: string, starts_at: string | null, ends_at: string | null = null, extra: Partial<ItineraryItem> = {}): ItineraryItem => ({
  id,
  trip_id: 't',
  day,
  position: 0,
  title: id,
  starts_at,
  ends_at,
  place_name: null,
  address: null,
  lat: null,
  lng: null,
  notes: null,
  created_by: 'u',
  updated_by: null,
  created_at: '',
  updated_at: '',
  ...extra,
});

describe('parseTime', () => {
  it('understands the ways people type times', () => {
    expect(parseTime('9:30')).toBe('09:30');
    expect(parseTime('09.30')).toBe('09:30');
    expect(parseTime('930')).toBe('09:30');
    expect(parseTime('21h15')).toBe('21:15');
    expect(parseTime('9')).toBe('09:00');
    expect(parseTime('7pm')).toBe('19:00');
    expect(parseTime('12am')).toBe('00:00');
    expect(parseTime('12:30 pm')).toBe('12:30');
    expect(parseTime('  ')).toBeNull();
  });
  it('rejects things that aren’t times', () => {
    for (const bad of ['25:00', '9:75', 'noon', '13pm', '1:2']) expect(parseTime(bad)).toBeUndefined();
  });
  it('formats ranges', () => {
    expect(timeRange({ starts_at: '09:00:00', ends_at: '10:30:00' })).toBe('09:00 – 10:30');
    expect(timeRange({ starts_at: '09:00:00', ends_at: null })).toBe('09:00');
    expect(timeRange({ starts_at: null, ends_at: null })).toBeNull();
  });
});

describe('planDays', () => {
  const trip = { starts_on: '2026-12-01', ends_on: '2026-12-03' };
  it('lists every trip day, numbered, with today marked', () => {
    const days = planDays(trip, [item('a', '2026-12-02', null), item('b', '2026-12-02', null)], '2026-12-02');
    expect(days.map((d) => [d.day, d.label, d.count])).toEqual([
      ['2026-12-01', 'Day 1', 0],
      ['2026-12-02', 'Today', 2],
      ['2026-12-03', 'Day 3', 0],
    ]);
  });
  it('without dates: the coming week, plus any other day with stops', () => {
    const week = planDays({ starts_on: null, ends_on: null }, [], '2026-12-02');
    expect(week.map((d) => d.day)).toEqual(['2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06', '2026-12-07', '2026-12-08']);
    expect(week[0].label).toBe('Today');
    const withPast = planDays({ starts_on: null, ends_on: null }, [item('a', '2026-11-20', null)], '2026-12-02');
    expect(withPast[0].day).toBe('2026-11-20');
    expect(withPast).toHaveLength(8);
  });
  it('caps very long trips', () => {
    expect(planDays({ starts_on: '2026-01-01', ends_on: '2026-12-31' }, [], '2025-01-01')).toHaveLength(31);
  });
  it('opens on today, else the next day with stops', () => {
    const days = planDays(trip, [item('a', '2026-12-03', null)], '2026-11-20');
    expect(defaultDay(days, '2026-11-20')).toBe('2026-12-03');
    expect(defaultDay(planDays(trip, [], '2026-12-02'), '2026-12-02')).toBe('2026-12-02');
  });
});

describe('findConflicts', () => {
  it('flags overlapping stops on the same day only', () => {
    const c = findConflicts([
      item('museum', 'd1', '10:00:00', '12:00:00'),
      item('lunch', 'd1', '11:30:00', '13:00:00'),
      item('walk', 'd1', '13:00:00', '14:00:00'), // starts as lunch ends: fine
      item('other-day', 'd2', '11:00:00', '12:00:00'),
      item('untimed', 'd1', null),
    ]);
    expect(Object.fromEntries(c)).toEqual({ museum: ['lunch'], lunch: ['museum'] });
  });
  it('a stop with only a start time clashes with anything running then', () => {
    const c = findConflicts([item('tour', 'd1', '10:00:00', '12:00:00'), item('call', 'd1', '11:00:00'), item('coffee', 'd1', '12:00:00')]);
    expect(c.get('call')).toEqual(['tour']);
    expect(c.has('coffee')).toBe(false);
    expect(findConflicts([item('a', 'd1', '09:00:00'), item('b', 'd1', '09:00:00')]).get('a')).toEqual(['b']);
  });
});

describe('RSVPs and the map', () => {
  it('summarises who’s going', () => {
    const r = rsvpSummary(
      [
        { item_id: 'x', user_id: 'me', status: 'going' },
        { item_id: 'x', user_id: 'sam', status: 'maybe' },
        { item_id: 'y', user_id: 'lee', status: 'going' },
      ],
      'x',
      'me',
    );
    expect(r).toEqual({ mine: 'going', going: ['me'], maybe: ['sam'], notGoing: [] });
  });
  it('shows the next day’s located stops on the map', () => {
    const at = { lat: 1, lng: 2 };
    const items = [item('past', '2026-12-01', null, null, at), item('soon', '2026-12-03', null, null, at), item('nowhere', '2026-12-03', null), item('later', '2026-12-04', null, null, at)];
    expect(stopsForMap(items, '2026-12-02').map((i) => i.id)).toEqual(['soon']);
    expect(stopsForMap(items, '2026-12-09').map((i) => i.id)).toEqual(['later']);
    expect(stopsForMap([item('nowhere', 'd', null)], 'd')).toEqual([]);
  });
});

describe('a free time for a clashing stop', () => {
  const day = '2026-12-02';
  const stop = (id: string, starts_at: string | null, ends_at: string | null = null) => ({ id, day, title: id, starts_at, ends_at });

  it('moves it to the first gap after, keeping its length', () => {
    const museum = stop('museum', '10:00', '12:00');
    const lunch = stop('lunch', '11:30', '12:30');
    expect(suggestFreeSlot(lunch, [museum, lunch])).toEqual({ starts_at: '12:00', ends_at: '13:00' });
  });

  it('skips other stops in the way, and uses a gap before when there’s none after', () => {
    const a = stop('a', '12:00', '13:00');
    const b = stop('b', '13:00', '22:30');
    const late = stop('late', '12:30', '13:30');
    expect(suggestFreeSlot(late, [a, b, late])).toEqual({ starts_at: '11:00', ends_at: '12:00' });
  });

  it('a stop with only a start time moves to the next free quarter hour', () => {
    const tour = stop('tour', '15:00', '16:00');
    const coffee = stop('coffee', '15:20');
    expect(suggestFreeSlot(coffee, [tour, coffee])).toEqual({ starts_at: '16:00', ends_at: null });
  });

  it('no room that day: no suggestion', () => {
    const allDay = stop('all', '07:00', '23:00');
    const x = stop('x', '09:00', '10:00');
    expect(suggestFreeSlot(x, [allDay, x])).toBeNull();
    expect(suggestFreeSlot(stop('untimed', null), [allDay])).toBeNull();
  });
});
