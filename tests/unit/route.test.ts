import { describe, expect, it } from 'vitest';

import { formatDistance, formatMinutes, pathLength, planRoute, tightConnections, walkMinutes, type RouteStop } from '../../src/lib/route';

// Points along one street in Lisbon, about 1 km apart west to east.
const W = { lat: 38.71, lng: -9.16 };
const M = { lat: 38.71, lng: -9.1485 };
const E = { lat: 38.71, lng: -9.137 };
const FAR_E = { lat: 38.71, lng: -9.1255 };

const stop = (id: string, at: { lat: number; lng: number } | null, starts_at: string | null = null, ends_at: string | null = null): RouteStop => ({
  id,
  title: id,
  starts_at,
  ends_at,
  lat: at?.lat ?? null,
  lng: at?.lng ?? null,
});

describe('planRoute', () => {
  it('a zig-zag day gets a straight walk', () => {
    // West, East, Middle, Far east: walking back and forth.
    const r = planRoute([stop('w', W), stop('e', E), stop('m', M), stop('fe', FAR_E)], null, false);
    expect(r.suggestedIds).toEqual(['w', 'm', 'e', 'fe']);
    expect(r.suggestedMeters).toBeLessThan(r.currentMeters);
    expect(r.better).toBe(true);
  });

  it('starts from the stay when there is one', () => {
    const hotel = { label: 'Hotel', ...FAR_E };
    const r = planRoute([stop('w', W), stop('m', M), stop('e', E)], hotel, false);
    // From the far east: east first, then middle, then west.
    expect(r.suggestedIds).toEqual(['e', 'm', 'w']);
  });

  it('a round trip counts the walk back to the stay', () => {
    const hotel = { label: 'Hotel', ...W };
    const open = planRoute([stop('e', E), stop('m', M)], hotel, false);
    const round = planRoute([stop('e', E), stop('m', M)], hotel, true);
    expect(round.suggestedMeters).toBeGreaterThan(open.suggestedMeters);
    expect(open.suggestedIds).toEqual(['m', 'e']);
  });

  it('booked times keep their order; free stops fit around them', () => {
    // The 10:00 booking is far west, the 15:00 one far east. A free stop in the middle goes between them.
    const r = planRoute([stop('lunch', M), stop('museum', W, '10:00'), stop('show', FAR_E, '15:00')], null, false);
    expect(r.suggestedIds).toEqual(['museum', 'lunch', 'show']);
  });

  it('fits sights where there’s time for them, even if it walks a little further', () => {
    // Museum until 12:00 in the west, lunch at 12:30 in the far east (about 50 min on foot).
    // Visiting the viewpoint and castle on the way would make lunch later still, so they go after it.
    const r = planRoute(
      [stop('viewpoint', { lat: 38.716, lng: -9.1485 }), stop('museum', W, '10:00', '12:00'), stop('castle', { lat: 38.716, lng: -9.137 }), stop('lunch', FAR_E, '12:30')],
      { label: 'Hotel', ...W },
      true,
    );
    expect(r.suggestedIds).toEqual(['museum', 'lunch', 'castle', 'viewpoint']);
    expect(r.suggestedLate).toBeLessThan(r.currentLate);
  });

  it('never puts a later booking before an earlier one, even if it’s shorter', () => {
    const r = planRoute([stop('late', W, '18:00'), stop('early', FAR_E, '09:00'), stop('mid', E)], { label: 'Hotel', ...W }, false);
    expect(r.suggestedIds.indexOf('early')).toBeLessThan(r.suggestedIds.indexOf('late'));
  });

  it('stops without a map point keep their place', () => {
    const r = planRoute([stop('w', W), stop('call', null), stop('e', E), stop('m', M)], null, false);
    expect(r.suggestedIds[1]).toBe('call');
    expect(r.suggestedIds.filter((x) => x !== 'call')).toEqual(['w', 'm', 'e']);
    expect(r.routed).toBe(3);
  });

  it('an already good order isn’t “improved”', () => {
    const r = planRoute([stop('w', W), stop('m', M), stop('e', E)], null, false);
    expect(r.suggestedIds).toEqual(['w', 'm', 'e']);
    expect(r.better).toBe(false);
  });

  it('small savings aren’t worth bothering anyone with', () => {
    // Two nearly identical orders: a few metres apart.
    const a = { lat: 38.71, lng: -9.16 };
    const b = { lat: 38.71001, lng: -9.1601 };
    const r = planRoute([stop('a', a), stop('far', E), stop('b', b)], null, false);
    expect(r.suggestedMeters).toBeLessThan(r.currentMeters);
    const tiny = planRoute([stop('a', a), stop('b', b), stop('far', E)], null, false);
    expect(tiny.better).toBe(false);
  });

  it('big days (more than 8 stops) still get a sensible order', () => {
    const line = Array.from({ length: 12 }, (_, i) => ({ lat: 38.71, lng: -9.2 + i * 0.01 }));
    const shuffled = [5, 0, 11, 3, 8, 1, 10, 6, 2, 9, 4, 7].map((i) => stop(`s${i}`, line[i]));
    const r = planRoute(shuffled, null, false);
    const order = r.suggestedIds.map((x) => Number(x.slice(1)));
    const ascending = order.every((v, i) => i === 0 || v > order[i - 1]);
    const descending = order.every((v, i) => i === 0 || v < order[i - 1]);
    expect(ascending || descending).toBe(true);
    expect(r.better).toBe(true);
  });

  it('nothing to route with fewer than two placed stops', () => {
    const r = planRoute([stop('w', W), stop('x', null)], null, false);
    expect(r.suggestedIds).toEqual(['w', 'x']);
    expect(r.better).toBe(false);
  });
});

describe('tightConnections', () => {
  it('flags a booking you can’t walk to in time', () => {
    const t = tightConnections([stop('Tile museum', W, '10:00', '12:00'), stop('Lunch', FAR_E, '12:05')]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ fromTitle: 'Tile museum', toTitle: 'Lunch', gapMinutes: 5 });
    expect(t[0].walkMinutes).toBeGreaterThan(5);
  });

  it('counts the walk through sights planned in between', () => {
    const t = tightConnections([stop('Tile museum', W, '10:00', '12:00'), stop('Viewpoint', M), stop('Castle', E), stop('Lunch', FAR_E, '12:30')]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ fromTitle: 'Tile museum', toTitle: 'Lunch', via: 2, gapMinutes: 30 });
    expect(t[0].walkMinutes).toBe(walkMinutes(pathLength([W, M, E, FAR_E], null, false)));
  });

  it('plenty of time, untimed stops, or no map point: nothing to flag', () => {
    expect(tightConnections([stop('a', W, '10:00', '11:00'), stop('b', E, '14:00')])).toEqual([]);
    expect(tightConnections([stop('a', W), stop('b', FAR_E, '10:00')])).toEqual([]);
    expect(tightConnections([stop('a', null, '10:00'), stop('b', FAR_E, '10:05')])).toEqual([]);
  });
});

describe('numbers people read', () => {
  it('distance and time', () => {
    expect(formatDistance(640)).toBe('640 m');
    expect(formatDistance(1840)).toBe('1.8 km');
    expect(formatDistance(23_400)).toBe('23 km');
    expect(formatMinutes(25)).toBe('25 min');
    expect(formatMinutes(95)).toBe('1 h 35 min');
    expect(formatMinutes(120)).toBe('2 h');
  });

  it('walking time allows for streets not being straight', () => {
    expect(walkMinutes(1000)).toBe(16); // 1 km straight ≈ 1.3 km of streets at 4.8 km/h
  });

  it('a round trip adds the way back', () => {
    const one = pathLength([W, E], null, false);
    const round = pathLength([E], W, true);
    expect(Math.round(round)).toBe(Math.round(one * 2));
  });
});
