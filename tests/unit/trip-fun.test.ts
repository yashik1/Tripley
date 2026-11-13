import { describe, expect, it } from 'vitest';

import {
  awardHeadline,
  awardResults,
  buildTimeline,
  cleanMusicLink,
  enabledFeatures,
  flagEmoji,
  linkHost,
  milestones,
  nextMilestone,
  passportStats,
  scrapbookDays,
  splitDestination,
  tripsToStamp,
} from '../../src/lib/trip-fun';
import type { FeedPost, FunEntry, ItineraryItem, PassportStamp, TripMemory } from '../../src/lib/types';

// Timestamps at local noon, so the local day is the same in every time zone.
const at = (day: string, time = '12:00') => new Date(`${day}T${time}:00`).toISOString();

const post = (id: string, day: string, extra: Partial<FeedPost> = {}): FeedPost => ({
  id,
  trip_id: 't',
  author_id: 'ana',
  kind: 'photos',
  body: null,
  place_name: null,
  lat: null,
  lng: null,
  event: null,
  created_at: at(day),
  post_photos: [],
  post_reactions: [],
  post_comments: [],
  ...extra,
});
const entry = (id: string, kind: FunEntry['kind'], day: string, extra: Partial<FunEntry> = {}): FunEntry => ({
  id,
  trip_id: 't',
  kind,
  title: id,
  details: '',
  created_by: 'ben',
  assigned_to: null,
  is_complete: false,
  completed_by: null,
  completed_at: null,
  created_at: at(day, '15:00'),
  food_kind: kind === 'food' ? 'dish' : null,
  place_name: null,
  photo_path: null,
  link_url: null,
  ...extra,
});
const memory = (id: string, day: string, photos: string[] = []): TripMemory => ({
  id,
  trip_id: 't',
  created_by: 'cleo',
  caption: id,
  description: null,
  happened_on: day,
  photo_paths: photos,
  created_at: at('2026-12-20'),
  updated_at: at('2026-12-20'),
});
const plan = (id: string, day: string, starts: string | null): ItineraryItem =>
  ({ id, trip_id: 't', day, position: 0, title: id, starts_at: starts, ends_at: null, place_name: null, address: null, lat: null, lng: null, notes: null }) as ItineraryItem;
const stamp = (place: string, country: string | null, code: string | null, trip: string | null = null): PassportStamp => ({
  id: place,
  user_id: 'me',
  trip_id: trip,
  place,
  country,
  country_code: code,
  lat: null,
  lng: null,
  visited_on: '2026-12-01',
  note: null,
  created_at: at('2026-12-01'),
});

describe('the hub', () => {
  it('shows the chosen seven until the catalogue says otherwise, and hides what it turns off', () => {
    expect(enabledFeatures(undefined)).toEqual(['travel_scrapbook', 'travel_passport', 'scavenger_hunt', 'trip_awards', 'trip_soundtrack', 'food_explorer', 'living_timeline']);
    const catalogue = ['travel_scrapbook', 'trip_awards', 'adventure_wheel', 'secret_missions'].map((k) => ({
      feature_key: k,
      title: k,
      enabled: k !== 'adventure_wheel' && k !== 'secret_missions',
      minimum_plan: 'free' as const,
    }));
    expect(enabledFeatures(catalogue)).toEqual(['travel_scrapbook', 'trip_awards']);
  });
});

describe('Trip Awards', () => {
  const votes = [
    { award_key: 'food_scout', nominee_id: 'ana' },
    { award_key: 'food_scout', nominee_id: 'ana' },
    { award_key: 'food_scout', nominee_id: 'ben' },
    { award_key: 'photo_pro', nominee_id: 'ben' },
    { award_key: 'photo_pro', nominee_id: 'cleo' },
  ];
  const results = awardResults(votes, ['cleo', 'ben', 'ana']);
  const name = (id: string) => id[0].toUpperCase() + id.slice(1);

  it('counts votes and finds the leader, or a tie (in member order)', () => {
    const food = results.find((r) => r.key === 'food_scout')!;
    expect(food).toMatchObject({ total: 3, top: 2, leaders: ['ana'], counts: { ana: 2, ben: 1 } });
    expect(results.find((r) => r.key === 'photo_pro')!.leaders).toEqual(['cleo', 'ben']);
    expect(results.find((r) => r.key === 'early_bird')).toMatchObject({ total: 0, leaders: [] });
    expect(results).toHaveLength(8);
  });

  it('says who is leading, who won once the trip is over, and ties', () => {
    const [food, photo, , , , , early] = results;
    expect(awardHeadline(food, false, name)).toBe('Leading: Ana · 2 votes');
    expect(awardHeadline(food, true, name)).toBe('Winner: Ana · 2 votes');
    expect(awardHeadline(photo, true, name)).toBe('Tie: Cleo & Ben · 1 vote each');
    expect(awardHeadline(early, true, name)).toBe('No votes yet');
  });
});

describe('Trip Soundtrack links', () => {
  it('keeps https links, upgrades http, adds https to a bare link, and allows none', () => {
    expect(cleanMusicLink('https://open.spotify.com/track/abc?si=1')).toEqual({ url: 'https://open.spotify.com/track/abc?si=1', error: null });
    expect(cleanMusicLink('http://music.apple.com/pt/album/x').url).toBe('https://music.apple.com/pt/album/x');
    expect(cleanMusicLink('  youtu.be/dQw4w9WgXcQ ').url).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(cleanMusicLink('   ')).toEqual({ url: null, error: null });
  });

  it('refuses anything that isn’t a web link', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'not a link', 'https://', `https://example.com/${'a'.repeat(500)}`]) {
      expect(cleanMusicLink(bad).error, bad).toBeTruthy();
    }
  });

  it('shows where a link goes', () => {
    expect(linkHost('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
    expect(linkHost('https://open.spotify.com/track/1')).toBe('open.spotify.com');
  });
});

describe('Living Trip Timeline', () => {
  const input = {
    trip: { starts_on: '2026-12-01', ends_on: '2026-12-03' },
    plans: [plan('Castle', '2026-12-02', '10:00:00'), plan('Dinner', '2026-12-01', '20:30:00'), plan('Free day', '2026-12-03', null)],
    posts: [
      post('photos', '2026-12-02', { body: 'View!', post_photos: [{ path: 't/b.jpg', position: 1 }, { path: 't/a.jpg', position: 0 }] }),
      post('bill', '2026-12-02', { kind: 'event', event: { type: 'bill_added', label: 'Dinner' } }),
      post('joined', '2026-12-01', { kind: 'event', event: { type: 'member_joined' } }),
    ],
    entries: [entry('Nata', 'food', '2026-12-02', { place_name: 'Manteigaria' }), entry('Fado', 'soundtrack', '2026-12-03')],
    memories: [memory('Sunset', '2026-12-02', ['t/s.jpg'])],
    eventLabel: () => 'Ben joined the trip',
  };

  it('puts everything in order, a day at a time, from the first day to the last', () => {
    const days = buildTimeline(input);
    expect(days.map((d) => d.day)).toEqual(['2026-12-01', '2026-12-02', '2026-12-03']);
    expect(days[0].items.map((i) => i.title)).toEqual(['The trip begins', 'Ben joined the trip', 'Dinner']);
    expect(days[1].items.map((i) => i.title)).toEqual(['Castle', 'View!', 'Nata', 'Sunset']);
    expect(days[2].items.map((i) => i.title)).toEqual(['Fado', 'Free day', 'Last day of the trip']);
  });

  it('skips feed events that repeat other things (like bills), and keeps photos and details', () => {
    const all = buildTimeline(input).flatMap((d) => d.items);
    expect(all.some((i) => i.ref === 'bill')).toBe(false);
    expect(all.find((i) => i.ref === 'photos')?.photo).toBe('t/a.jpg');
    expect(all.find((i) => i.ref === 'Nata')).toMatchObject({ kind: 'food', emoji: '🍽️', detail: 'Manteigaria', by: 'ben' });
  });

  it('filters by kind', () => {
    const only = (f: Parameters<typeof buildTimeline>[1]) => buildTimeline(input, f).flatMap((d) => d.items.map((i) => i.kind));
    expect(new Set(only('plans'))).toEqual(new Set(['start', 'plan', 'end']));
    expect(only('songs')).toEqual(['song']);
    expect(only('memories')).toEqual(['memory']);
  });
});

describe('Digital Travel Scrapbook', () => {
  it('collects memories, photo posts and food photos by day; text-only posts stay in the feed', () => {
    const days = scrapbookDays(
      [memory('Sunset', '2026-12-02', ['t/s.jpg']), memory('Arrival', '2026-12-01')],
      [post('photos', '2026-12-02', { body: 'View!', post_photos: [{ path: 't/v.jpg', position: 0 }] }), post('words', '2026-12-01', { kind: 'update', body: 'Hi' })],
      [entry('Nata', 'food', '2026-12-02', { photo_path: 't/n.jpg' }), entry('No photo', 'food', '2026-12-02'), entry('Song', 'soundtrack', '2026-12-02')],
    );
    expect(days.map((d) => [d.day, d.entries.map((e) => e.source)])).toEqual([
      ['2026-12-01', ['memory']],
      ['2026-12-02', ['post', 'food', 'memory']],
    ]);
    expect(days[1].entries[1]).toMatchObject({ caption: '🍽️ Nata', photos: ['t/n.jpg'] });
  });
});

describe('My Travel Passport', () => {
  it('flags from country codes', () => {
    expect(flagEmoji('PT')).toBe('🇵🇹');
    expect(flagEmoji('jp')).toBe('🇯🇵');
    expect(flagEmoji(null)).toBe('🌍');
    expect(flagEmoji('XYZ')).toBe('🌍');
  });

  it('splits a destination into place and country', () => {
    expect(splitDestination('Lisbon, Portugal')).toEqual({ place: 'Lisbon', country: 'Portugal' });
    expect(splitDestination('Kyoto, Kyoto Prefecture, Japan')).toEqual({ place: 'Kyoto', country: 'Japan' });
    expect(splitDestination('Iceland')).toEqual({ place: 'Iceland', country: null });
  });

  it('counts countries, places, trips and days away', () => {
    const stamps = [stamp('Lisbon', 'Portugal', 'PT', 't1'), stamp('Porto', 'Portugal', 'PT'), stamp('Kyoto', 'Japan', null), stamp('Lisbon', 'Portugal', 'PT')];
    const stats = passportStats(stamps, [
      { id: 't1', starts_on: '2026-11-01', ends_on: '2026-11-07' },
      { id: 't2', starts_on: '2026-10-01', ends_on: '2026-10-03' },
      { id: 't3', starts_on: null, ends_on: null },
    ]);
    expect(stats).toEqual({ countries: 2, places: 3, trips: 3, daysAway: 10 });
  });

  it('milestones: reached ones, progress, and the closest one to go', () => {
    const stats = { countries: 2, places: 3, trips: 4, daysAway: 10 };
    const m = milestones(stats);
    expect(m.find((x) => x.key === 'first_stamp')).toMatchObject({ reached: true, progress: 100 });
    expect(m.find((x) => x.key === 'explorer')).toMatchObject({ reached: false, value: 2, progress: 67 });
    expect(nextMilestone(stats)?.key).toBe('frequent');
    expect(nextMilestone({ countries: 99, places: 99, trips: 99, daysAway: 99 })).toBeNull();
  });

  it('suggests trips with a destination that aren’t stamped yet', () => {
    const trips = [
      { id: 't1', destination: 'Lisbon, Portugal' },
      { id: 't2', destination: 'Kyoto, Japan' },
      { id: 't3', destination: null },
      { id: 't4', destination: '  ' },
    ];
    expect(tripsToStamp(trips, [stamp('Lisbon', 'Portugal', 'PT', 't1')]).map((t) => t.id)).toEqual(['t2']);
  });
});
