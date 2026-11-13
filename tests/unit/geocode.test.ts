import { describe, expect, it, vi } from 'vitest';

import { centreOf, geocoderBaseUrl, GeocoderUnavailable, pinKindFor, searchPlaces, searchUrl, toResult } from '../../src/lib/geocode';

// Shaped like Photon's documented GeoJSON (komoot/photon docs/api-v1.md).
const market = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-9.1458, 38.7071] },
  properties: {
    osm_type: 'W',
    osm_id: 123,
    osm_key: 'amenity',
    osm_value: 'food_court',
    name: 'Time Out Market',
    street: 'Avenida 24 de Julho',
    housenumber: '49',
    postcode: '1200-479',
    city: 'Lisboa',
    country: 'Portugal',
    countrycode: 'PT',
  },
};
const city = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-9.1365919, 38.7077507] },
  properties: { osm_type: 'R', osm_id: 5400890, osm_key: 'place', osm_value: 'city', name: 'Lisbon', city: 'Lisbon', state: 'Lisbon', country: 'Portugal', countrycode: 'PT' },
};
const house = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-73.9857, 40.7484] },
  properties: { osm_type: 'N', osm_id: 7, street: '5th Avenue', housenumber: '350', postcode: '10118', city: 'New York', state: 'New York', country: 'United States', countrycode: 'US' },
};

describe('toResult', () => {
  it('a named place: its name, a one-line address and its map point', () => {
    expect(toResult(market)).toEqual({
      id: 'W123',
      name: 'Time Out Market',
      address: 'Time Out Market, Avenida 24 de Julho 49, 1200-479 Lisboa, Portugal',
      lat: 38.7071,
      lng: -9.1458,
      category: 'amenity:food_court',
      short: 'Time Out Market, Portugal',
      country: 'Portugal',
      countryCode: 'PT',
    });
  });

  it('a city doesn’t repeat itself, and its short form is a trip destination', () => {
    const r = toResult(city)!;
    expect(r.address).toBe('Lisbon, Portugal');
    expect(r.short).toBe('Lisbon, Portugal');
  });

  it('an address without a name is named by its street; number first where that’s the custom', () => {
    const r = toResult(house)!;
    expect(r.name).toBe('350 5th Avenue');
    expect(r.address).toBe('350 5th Avenue, 10118 New York, United States');
  });

  it('skips results with no usable point or name', () => {
    expect(toResult({ geometry: { coordinates: [200, 10] }, properties: { name: 'x' } })).toBeNull();
    expect(toResult({ geometry: { coordinates: ['a'] }, properties: { name: 'x' } })).toBeNull();
    expect(toResult({ geometry: { coordinates: [1, 2] }, properties: {} })).toBeNull();
  });
});

describe('searchUrl', () => {
  it('sends only the words, a rounded area to look near, and a result limit', () => {
    const u = new URL(searchUrl(' time out market ', { near: { lat: 38.70712345, lng: -9.14581234 }, base: 'https://geo.test' }));
    expect(u.origin + u.pathname).toBe('https://geo.test/api/');
    expect(u.searchParams.get('q')).toBe('time out market');
    expect(u.searchParams.get('lat')).toBe('38.707');
    expect(u.searchParams.get('lon')).toBe('-9.146');
    expect(u.searchParams.get('limit')).toBe('6');
  });

  it('a destination search only asks for towns, regions and countries', () => {
    const u = new URL(searchUrl('lisb', { scope: 'area', base: 'https://geo.test' }));
    expect(u.searchParams.getAll('layer')).toEqual(['city', 'locality', 'district', 'county', 'state', 'country']);
    expect(u.searchParams.get('lat')).toBeNull();
  });

  it('uses the configured server, or the public Photon one', () => {
    expect(geocoderBaseUrl('https://geo.example.com/')).toBe('https://geo.example.com');
    expect(geocoderBaseUrl('')).toBe('https://photon.komoot.io');
    expect(geocoderBaseUrl('not a url')).toBe('https://photon.komoot.io');
  });
});

describe('searchPlaces', () => {
  const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

  it('needs at least 3 characters before asking anyone', async () => {
    const f = reply({ features: [] });
    expect(await searchPlaces('ab', { fetchImpl: f })).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('returns usable results once each', async () => {
    const f = reply({ features: [market, market, city, { geometry: {}, properties: {} }] });
    const r = await searchPlaces('lisbon', { fetchImpl: f });
    expect(r.map((x) => x.name)).toEqual(['Time Out Market', 'Lisbon']);
  });

  it('an unreachable or failing server says search isn’t available', async () => {
    await expect(searchPlaces('lisbon', { fetchImpl: reply({}, false) })).rejects.toBeInstanceOf(GeocoderUnavailable);
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(searchPlaces('lisbon', { fetchImpl: offline })).rejects.toThrow(/isn’t available right now/);
  });
});

describe('pinKindFor and centreOf', () => {
  it('guesses a pin kind from the place’s category', () => {
    expect(pinKindFor('tourism:hotel')).toBe('stay');
    expect(pinKindFor('aeroway:aerodrome')).toBe('airport');
    expect(pinKindFor('railway:station')).toBe('airport');
    expect(pinKindFor('amenity:restaurant')).toBe('food');
    expect(pinKindFor('tourism:museum')).toBe('sight');
    expect(pinKindFor('highway:residential')).toBe('other');
  });

  it('the middle of some points, or null', () => {
    expect(centreOf([])).toBeNull();
    expect(centreOf([{ lat: 10, lng: 20 }, { lat: 20, lng: 40 }])).toEqual({ lat: 15, lng: 30 });
  });
});
