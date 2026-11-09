import { describe, expect, it } from 'vitest';

import {
  arrowAngle,
  bearingDegrees,
  compassPoint,
  compassWord,
  describeOffset,
  distanceMeters,
  formatMeters,
  insideZone,
  nearbyPeople,
} from '../../src/lib/geo';

const banff = { lat: 51.1784, lng: -115.5708 };

describe('distance and bearing', () => {
  it('measures short distances in metres', () => {
    const north100 = { lat: banff.lat + 100 / 111_195, lng: banff.lng };
    expect(distanceMeters(banff, north100)).toBeCloseTo(100, 0);
    expect(distanceMeters(banff, banff)).toBe(0);
  });

  it('finds the compass direction', () => {
    expect(bearingDegrees(banff, { lat: banff.lat + 0.01, lng: banff.lng })).toBeCloseTo(0, 1);
    expect(bearingDegrees(banff, { lat: banff.lat, lng: banff.lng + 0.01 })).toBeCloseTo(90, 0);
    expect(bearingDegrees(banff, { lat: banff.lat - 0.01, lng: banff.lng })).toBeCloseTo(180, 1);
    expect(bearingDegrees(banff, { lat: banff.lat, lng: banff.lng - 0.01 })).toBeCloseTo(270, 0);
  });

  it('names eight compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(44)).toBe('NE');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(-90)).toBe('W');
    expect(compassWord(135)).toBe('south-east');
  });
});

describe('describing where a friend is', () => {
  it('formats distances sensibly', () => {
    expect(formatMeters(7.4)).toBe('7 m');
    expect(formatMeters(123)).toBe('120 m');
    expect(formatMeters(1430)).toBe('1.4 km');
    expect(formatMeters(12_600)).toBe('13 km');
  });

  it('says "120 m east" or "right here"', () => {
    const east = { lat: banff.lat, lng: banff.lng + 120 / (111_195 * Math.cos((banff.lat * Math.PI) / 180)) };
    expect(describeOffset(banff, east)).toBe('120 m east');
    expect(describeOffset(banff, { lat: banff.lat + 0.00005, lng: banff.lng })).toBe('right here');
  });

  it('turns the arrow by the way the phone faces', () => {
    expect(arrowAngle(90, null)).toBe(90);
    expect(arrowAngle(90, 90)).toBe(0);
    expect(arrowAngle(10, 350)).toBe(20);
    expect(arrowAngle(350, 10)).toBe(340);
  });
});

describe('who was nearby', () => {
  const now = Date.parse('2026-11-08T20:00:00Z');
  const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  const people = [
    { userId: 'me', lat: banff.lat, lng: banff.lng, updatedAt: at(1) },
    { userId: 'maya', lat: banff.lat + 0.0005, lng: banff.lng, updatedAt: at(5) }, // ~56 m
    { userId: 'sam', lat: banff.lat + 0.01, lng: banff.lng, updatedAt: at(2) }, // ~1.1 km
    { userId: 'lee', lat: banff.lat, lng: banff.lng + 0.0005, updatedAt: at(90) }, // close but stale
  ];

  it('picks people within the radius whose dot is fresh', () => {
    expect(nearbyPeople(banff, people, { now })).toEqual(['me', 'maya']);
    expect(nearbyPeople(banff, people, { now, maxAgeMs: 2 * 60 * 60_000 })).toEqual(['me', 'maya', 'lee']);
    expect(nearbyPeople(banff, people, { now, radiusM: 2000 })).toEqual(['me', 'maya', 'sam']);
  });

  it('counts a zone as entered with a little GPS slack', () => {
    const zone = { ...banff, radiusM: 100 };
    const p = { lat: banff.lat + 120 / 111_195, lng: banff.lng };
    expect(insideZone(p, zone)).toBe(false);
    expect(insideZone({ ...p, accuracyM: 30 }, zone)).toBe(true);
    expect(insideZone({ ...p, accuracyM: 5000 }, { ...zone, radiusM: 50 })).toBe(false);
  });
});
