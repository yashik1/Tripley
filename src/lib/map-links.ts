import { Platform } from 'react-native';

/** Turn-by-turn directions in the phone's maps app (or Google Maps on the web). */
export function directionsUrl(lat: number, lng: number): string {
  return Platform.OS === 'ios'
    ? `http://maps.apple.com/?daddr=${lat},${lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/** Most stops one walking-directions link carries: start, 9 stops in between, end. */
export const ROUTE_LINK_MAX_STOPS = 11;

/**
 * Walking directions through several stops in order, in Google Maps (the app
 * when installed, else the website). Apple Maps links can't carry stops in
 * between. Long days are cut to the first stops that fit.
 */
export function routeUrl(points: { lat: number; lng: number }[]): string | null {
  const fit = points.slice(0, ROUTE_LINK_MAX_STOPS).map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`);
  if (fit.length < 2) return null;
  const params = new URLSearchParams({ api: '1', origin: fit[0], destination: fit[fit.length - 1], travelmode: 'walking' });
  if (fit.length > 2) params.set('waypoints', fit.slice(1, -1).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Look up an address in the phone's maps app (or Google Maps on the web). */
export function searchUrl(address: string): string {
  const q = encodeURIComponent(address);
  return Platform.OS === 'ios' ? `http://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
