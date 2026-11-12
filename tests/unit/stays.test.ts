import { describe, expect, it } from 'vitest';

import { decodePrefill, encodePrefill, roomsWithGuests, stayItems, stayShares, withoutBed } from '../../src/lib/stays';

const rooms = [
  { id: 'big', name: 'Big room', beds: 2, size_weight: 1.5, position: 0 },
  { id: 'small', name: 'Small room', beds: 1, size_weight: 1, position: 1 },
  { id: 'empty', name: 'Box room', beds: 1, size_weight: 0.75, position: 2 },
];
const guests = [
  { room_id: 'big', user_id: 'ana' },
  { room_id: 'big', user_id: 'ben' },
  { room_id: 'small', user_id: 'cleo' },
];

describe('rooms', () => {
  it('lists rooms in order with their people, and who has no bed', () => {
    expect(roomsWithGuests(rooms, guests).map((r) => [r.name, r.people])).toEqual([
      ['Big room', ['ana', 'ben']],
      ['Small room', ['cleo']],
      ['Box room', []],
    ]);
    expect(withoutBed(['ana', 'ben', 'cleo', 'dan'], guests)).toEqual(['dan']);
  });
});

describe('splitting a stay', () => {
  it('by room: the bigger room carries more and the couple shares it', () => {
    const items = stayItems(500_00, rooms, guests, 'room');
    expect(items).toEqual([
      { name: 'Big room', minor: 300_00, people: ['ana', 'ben'] },
      { name: 'Small room', minor: 200_00, people: ['cleo'] },
    ]);
    const shares = Object.fromEntries(stayShares(items).map((s) => [s.userId, s.totalMinor]));
    expect(shares).toEqual({ ana: 150_00, ben: 150_00, cleo: 200_00 });
  });

  it('by person: each pays by their room’s size', () => {
    const items = stayItems(400_00, rooms, guests, 'person');
    // Weights 1.5 + 1.5 + 1 = 4: 150 each in the big room, 100 in the small.
    const shares = Object.fromEntries(stayShares(items).map((s) => [s.userId, s.totalMinor]));
    expect(shares).toEqual({ ana: 150_00, ben: 150_00, cleo: 100_00 });
  });

  it('always adds up to the total, to the cent', () => {
    for (const total of [1, 99, 100_01, 333_33, 1_234_567]) {
      for (const by of ['room', 'person'] as const) {
        const items = stayItems(total, rooms, guests, by);
        expect(items.reduce((s, it) => s + it.minor, 0)).toBe(total);
        expect(stayShares(items).reduce((s, x) => s + x.totalMinor, 0)).toBe(total);
      }
    }
  });

  it('nothing to split when nobody has a bed or the total is zero', () => {
    expect(stayItems(100, rooms, [], 'room')).toEqual([]);
    expect(stayItems(0, rooms, guests, 'room')).toEqual([]);
  });
});

describe('bill pre-fill', () => {
  it('round-trips, and drops people who aren’t on the trip and bad amounts', () => {
    const raw = encodePrefill({
      title: 'Alfama flat',
      stayId: '0f8fad5b-d9cb-469f-a165-70867728950e',
      items: [
        { name: 'Big room', minor: 300_00, people: ['ana', 'ben', 'mallory'] },
        { name: 'Bad', minor: -5, people: ['ana'] },
        { name: 'Nobody', minor: 10, people: ['mallory'] },
      ],
    });
    expect(decodePrefill(raw, ['ana', 'ben', 'cleo'])).toEqual({
      title: 'Alfama flat',
      stayId: '0f8fad5b-d9cb-469f-a165-70867728950e',
      items: [{ name: 'Big room', minor: 300_00, people: ['ana', 'ben'] }],
    });
    expect(decodePrefill('not json', ['ana'])).toBeNull();
    expect(decodePrefill(undefined, ['ana'])).toBeNull();
  });
});
