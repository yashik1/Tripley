/**
 * The weather for a trip's dates at its destination, from Open-Meteo (no key,
 * no personal data: only the destination's map point and the dates are sent).
 * Within the next 15 days it's the forecast; further out, the same dates last
 * year, as a guide. Open-Meteo's free API is for non-commercial use: before
 * charging for Pro, set EXPO_PUBLIC_WEATHER_URL / EXPO_PUBLIC_WEATHER_ARCHIVE_URL
 * to their paid endpoints (see README).
 */
export const WEATHER_URL = (process.env.EXPO_PUBLIC_WEATHER_URL || 'https://api.open-meteo.com').replace(/\/+$/, '');
export const WEATHER_ARCHIVE_URL = (process.env.EXPO_PUBLIC_WEATHER_ARCHIVE_URL || 'https://archive-api.open-meteo.com').replace(/\/+$/, '');

export type TripWeather = {
  source: 'forecast' | 'last-year';
  days: number;
  minC: number;
  maxC: number;
  rainyDays: number;
};

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const shiftYear = (day: string, by: number) => `${Number(day.slice(0, 4)) + by}${day.slice(4)}`.replace(/-02-29$/, '-02-28');

/** Which request to make for these dates, given today; null when the trip is over. */
export function weatherRequest(lat: number, lng: number, start: string, end: string, today: string): { url: string; source: TripWeather['source'] } | null {
  if (end < today) return null;
  const from = start < today ? today : start;
  const days = Math.round((Date.parse(end) - Date.parse(from)) / DAY) + 1;
  const to = iso(Date.parse(from) + (Math.min(days, 16) - 1) * DAY);
  const daily = 'daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto';
  const at = `latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}`;
  if (Date.parse(to) <= Date.parse(today) + 15 * DAY) {
    return { source: 'forecast', url: `${WEATHER_URL}/v1/forecast?${at}&${daily}&start_date=${from}&end_date=${to}` };
  }
  return {
    source: 'last-year',
    url: `${WEATHER_ARCHIVE_URL}/v1/archive?${at}&${daily}&start_date=${shiftYear(from, -1)}&end_date=${shiftYear(to, -1)}`,
  };
}

type Daily = { daily?: { temperature_2m_max?: (number | null)[]; temperature_2m_min?: (number | null)[]; precipitation_sum?: (number | null)[] } };

/** Sums up Open-Meteo's daily answer; null when it has no usable days. */
export function summarize(body: Daily, source: TripWeather['source']): TripWeather | null {
  const max = (body.daily?.temperature_2m_max ?? []).filter((x): x is number => typeof x === 'number');
  const min = (body.daily?.temperature_2m_min ?? []).filter((x): x is number => typeof x === 'number');
  const rain = (body.daily?.precipitation_sum ?? []).filter((x): x is number => typeof x === 'number');
  if (!max.length || !min.length) return null;
  return {
    source,
    days: Math.max(max.length, min.length),
    minC: Math.round(Math.min(...min)),
    maxC: Math.round(Math.max(...max)),
    rainyDays: rain.filter((mm) => mm >= 1).length,
  };
}

export async function fetchTripWeather(lat: number, lng: number, start: string, end: string, today: string): Promise<TripWeather | null> {
  const req = weatherRequest(lat, lng, start, end, today);
  if (!req) return null;
  const res = await fetch(req.url);
  if (!res.ok) throw new Error(`Weather ${res.status}`);
  return summarize((await res.json()) as Daily, req.source);
}

export function describeWeather(w: TripWeather): string {
  const range = `${w.minC}–${w.maxC} °C`;
  const rain = w.rainyDays ? `rain on ${w.rainyDays} of ${w.days} ${w.days === 1 ? 'day' : 'days'}` : 'little rain';
  return w.source === 'forecast' ? `Forecast: ${range}, ${rain}.` : `Last year on these dates: ${range}, ${rain}.`;
}
