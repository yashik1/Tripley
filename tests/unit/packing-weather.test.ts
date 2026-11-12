import { describe, expect, it } from 'vitest';

import { packingSuggestions } from '../../src/lib/packing';
import { describeWeather, summarize, weatherRequest } from '../../src/lib/weather';

describe('trip weather', () => {
  it('asks for the forecast within 15 days, otherwise last year’s same dates', () => {
    const soon = weatherRequest(38.7223, -9.1393, '2026-11-20', '2026-11-23', '2026-11-12')!;
    expect(soon.source).toBe('forecast');
    expect(soon.url).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=38.722&longitude=-9.139&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&start_date=2026-11-20&end_date=2026-11-23',
    );
    const later = weatherRequest(38.7223, -9.1393, '2027-03-01', '2027-03-05', '2026-11-12')!;
    expect(later.source).toBe('last-year');
    expect(later.url).toContain('archive-api.open-meteo.com/v1/archive');
    expect(later.url).toContain('start_date=2026-03-01&end_date=2026-03-05');
  });

  it('a trip that already started asks from today; one that ended asks nothing', () => {
    expect(weatherRequest(1, 2, '2026-11-10', '2026-11-14', '2026-11-12')!.url).toContain('start_date=2026-11-12&end_date=2026-11-14');
    expect(weatherRequest(1, 2, '2026-11-01', '2026-11-05', '2026-11-12')).toBeNull();
  });

  it('sums up the days: coldest, warmest and rainy days', () => {
    const w = summarize({ daily: { temperature_2m_max: [16.4, 18.6, null], temperature_2m_min: [8.6, 9.2, 7.4], precipitation_sum: [0, 4.2, 1.0] } }, 'forecast')!;
    expect(w).toEqual({ source: 'forecast', days: 3, minC: 7, maxC: 19, rainyDays: 2 });
    expect(describeWeather(w)).toBe('Forecast: 7–19 °C, rain on 2 of 3 days.');
    expect(summarize({ daily: {} }, 'forecast')).toBeNull();
  });
});

describe('packing suggestions', () => {
  const cold = { source: 'forecast' as const, days: 4, minC: 1, maxC: 8, rainyDays: 2 };
  const hot = { source: 'last-year' as const, days: 4, minC: 21, maxC: 31, rainyDays: 0 };

  it('cold and wet: coat, gloves, umbrella; flying: passport and liquids bag', () => {
    const titles = packingSuggestions({ nights: 3, weather: cold, bookingKinds: ['flight'], existing: [] }).map((s) => s.title);
    expect(titles).toEqual([
      '4 sets of underwear and socks',
      'Phone charger',
      'Umbrella or rain jacket',
      'Warm coat',
      'Hat, gloves and scarf',
      'Passport or ID',
      'Liquids in a clear bag',
      'Headphones',
    ]);
  });

  it('hot: sun things and water; long trip: laundry; car hire: licence', () => {
    const titles = packingSuggestions({ nights: 9, weather: hot, bookingKinds: ['car'], existing: [] }).map((s) => s.title);
    expect(titles).toContain('8 sets of underwear and socks');
    expect(titles).toContain('Laundry bag');
    expect(titles).toContain('Sunscreen');
    expect(titles).toContain('Reusable water bottle');
    expect(titles).toContain('Driving licence');
    expect(titles).not.toContain('Umbrella or rain jacket');
  });

  it('doesn’t suggest what’s already on the list', () => {
    const titles = packingSuggestions({ nights: 3, weather: cold, bookingKinds: ['flight'], existing: ['Passport', 'umbrella', 'Phone charger (USB-C)', 'Winter coat'] }).map((s) => s.title);
    expect(titles).not.toContain('Passport or ID');
    expect(titles).not.toContain('Umbrella or rain jacket');
    expect(titles).not.toContain('Phone charger');
    expect(titles).not.toContain('Warm coat');
  });

  it('a rain jacket isn’t a warm coat', () => {
    const titles = packingSuggestions({ nights: 3, weather: cold, bookingKinds: [], existing: ['Umbrella or rain jacket'] }).map((s) => s.title);
    expect(titles).toContain('Warm coat');
    expect(titles).not.toContain('Umbrella or rain jacket');
  });

  it('no weather or dates: just the basics', () => {
    expect(packingSuggestions({ nights: null, weather: null, bookingKinds: [], existing: [] }).map((s) => s.title)).toEqual(['Phone charger']);
  });
});
