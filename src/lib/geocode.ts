/**
 * Address and place search, so places in Tripley are real ones that can be
 * found on a map. Uses a Photon server (OpenStreetMap data): the free public
 * one at photon.komoot.io by default, or your own via EXPO_PUBLIC_GEOCODER_URL.
 *
 * Only the words typed into a search box (and, to rank nearby results first,
 * a rough map point such as the trip's destination) are sent. Never anyone's
 * live location.
 */

export type GeoResult = {
  /** OpenStreetMap id, e.g. "N123456". */
  id: string;
  /** "Time Out Market", or the street and number for an address. */
  name: string;
  /** One line: "Av. 24 de Julho 49, 1200-479 Lisboa, Portugal". */
  address: string;
  lat: number;
  lng: number;
  /** OpenStreetMap category, e.g. "amenity:restaurant", "place:city". */
  category: string;
  /** "Lisbon, Portugal": for a city or country, the short form used as a trip destination. */
  short: string;
  /** "Portugal" and "PT", when the result has a country. */
  country?: string;
  countryCode?: string;
};

export type SearchScope = 'any' | 'area';

export const GEOCODER_ATTRIBUTION = 'Search by Photon · © OpenStreetMap contributors';

const DEFAULT_URL = 'https://photon.komoot.io';

export function geocoderBaseUrl(raw: string | undefined = process.env.EXPO_PUBLIC_GEOCODER_URL): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+/.test(value) ? value : DEFAULT_URL;
}

// Countries that write the house number before the street.
const NUMBER_FIRST = new Set(['US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'IN', 'PH', 'SG', 'ZA', 'MY', 'LK', 'NG', 'KE', 'FR']);

type PhotonProps = {
  osm_type?: string;
  osm_id?: number;
  osm_key?: string;
  osm_value?: string;
  type?: string;
  name?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  locality?: string;
  district?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
  countrycode?: string;
};
type PhotonFeature = { geometry?: { type?: string; coordinates?: unknown }; properties?: PhotonProps };

const clean = (s: string | undefined) => (typeof s === 'string' ? s.trim() : '');

function streetLine(p: PhotonProps): string {
  const street = clean(p.street);
  const number = clean(p.housenumber);
  if (!street) return number;
  if (!number) return street;
  return NUMBER_FIRST.has(clean(p.countrycode).toUpperCase()) ? `${number} ${street}` : `${street} ${number}`;
}

/** Turn one Photon result into ours, or null if it has no usable point or name. */
export function toResult(feature: PhotonFeature): GeoResult | null {
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lng, lat] = coords.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const p = feature.properties ?? {};
  const street = streetLine(p);
  const name = clean(p.name) || street;
  if (!name) return null;

  const town = clean(p.city) || clean(p.locality) || clean(p.district) || clean(p.county);
  const placeLine = [clean(p.postcode), town].filter(Boolean).join(' ');
  const parts = [name, street !== name ? street : '', placeLine, clean(p.state), clean(p.country)];
  // No repeats (a city's name is also its "city"), no empty bits.
  const seen = new Set<string>();
  const address = parts
    .filter((x) => {
      const key = x.toLowerCase();
      if (!x || seen.has(key) || [...seen].some((s) => s.endsWith(` ${key}`))) return false;
      seen.add(key);
      return true;
    })
    .join(', ');
  const short = [name, clean(p.country)].filter((x, i, a) => x && a.indexOf(x) === i).join(', ');

  return {
    id: `${clean(p.osm_type) || 'X'}${p.osm_id ?? `${lat},${lng}`}`,
    name,
    address,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    category: [clean(p.osm_key), clean(p.osm_value)].filter(Boolean).join(':'),
    short,
    ...(clean(p.country) ? { country: clean(p.country) } : {}),
    ...(/^[A-Za-z]{2}$/.test(clean(p.countrycode)) ? { countryCode: clean(p.countrycode).toUpperCase() } : {}),
  };
}

export function searchUrl(query: string, opts: { near?: { lat: number; lng: number } | null; scope?: SearchScope; limit?: number; base?: string } = {}): string {
  const params = new URLSearchParams({ q: query.trim(), limit: String(opts.limit ?? 6) });
  if (opts.near) {
    params.set('lat', opts.near.lat.toFixed(3));
    params.set('lon', opts.near.lng.toFixed(3));
  }
  // A trip destination is a town, region or country, not a street.
  if (opts.scope === 'area') for (const layer of ['city', 'locality', 'district', 'county', 'state', 'country']) params.append('layer', layer);
  return `${opts.base ?? geocoderBaseUrl()}/api/?${params.toString()}`;
}

export class GeocoderUnavailable extends Error {
  constructor() {
    super('Address search isn’t available right now. You can still type the address.');
  }
}

/** Search for places by name or address. Results nearest `near` come first. */
export async function searchPlaces(
  query: string,
  opts: { near?: { lat: number; lng: number } | null; scope?: SearchScope; limit?: number; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<GeoResult[]> {
  if (query.trim().length < 3) return [];
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(searchUrl(query, opts), { signal: opts.signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    throw new GeocoderUnavailable();
  }
  if (!res.ok) throw new GeocoderUnavailable();
  const body = (await res.json().catch(() => null)) as { features?: PhotonFeature[] } | null;
  const results: GeoResult[] = [];
  const seen = new Set<string>();
  for (const f of body?.features ?? []) {
    const r = toResult(f);
    if (!r) continue;
    const key = r.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(r);
  }
  return results;
}

/** A sensible kind of pin for a search result's OpenStreetMap category. */
export function pinKindFor(category: string): 'stay' | 'airport' | 'food' | 'sight' | 'other' {
  const [key, value = ''] = category.split(':');
  if (key === 'tourism' && ['hotel', 'hostel', 'guest_house', 'apartment', 'motel', 'camp_site', 'chalet'].includes(value)) return 'stay';
  if (key === 'aeroway' || (key === 'railway' && ['station', 'halt'].includes(value)) || (key === 'amenity' && ['bus_station', 'ferry_terminal'].includes(value))) return 'airport';
  if (key === 'amenity' && ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court', 'ice_cream', 'biergarten'].includes(value)) return 'food';
  if (key === 'shop' && ['bakery', 'pastry', 'confectionery', 'deli'].includes(value)) return 'food';
  if (key === 'tourism' || key === 'historic' || key === 'leisure' || key === 'natural') return 'sight';
  return 'other';
}

/** The middle of a set of points, for ranking nearby results first. */
export function centreOf(points: { lat: number; lng: number }[]): { lat: number; lng: number } | null {
  const ok = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!ok.length) return null;
  return { lat: ok.reduce((a, p) => a + p.lat, 0) / ok.length, lng: ok.reduce((a, p) => a + p.lng, 0) / ok.length };
}
