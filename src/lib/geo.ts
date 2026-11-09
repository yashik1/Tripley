/** Distances and directions between people on a trip. No app imports, so it's unit-testable. */

export type LatLng = { lat: number; lng: number };

const R = 6_371_008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from `from` to `to`, 0–360° (0 = north, 90 = east). */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const φ1 = rad(from.lat);
  const φ2 = rad(to.lat);
  const Δλ = rad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type CompassPoint = (typeof POINTS)[number];
const WORDS: Record<CompassPoint, string> = {
  N: 'north',
  NE: 'north-east',
  E: 'east',
  SE: 'south-east',
  S: 'south',
  SW: 'south-west',
  W: 'west',
  NW: 'north-west',
};

export function compassPoint(bearing: number): CompassPoint {
  const i = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return POINTS[i];
}

export function compassWord(bearing: number): string {
  return WORDS[compassPoint(bearing)];
}

/** "8 m", "120 m", "1.4 km", "12 km". */
export function formatMeters(m: number): string {
  if (m < 10) return `${Math.max(0, Math.round(m))} m`;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

/** "120 m north-east", or "right here" when very close. */
export function describeOffset(from: LatLng, to: LatLng): string {
  const d = distanceMeters(from, to);
  if (d < 15) return 'right here';
  return `${formatMeters(d)} ${compassWord(bearingDegrees(from, to))}`;
}

/**
 * Angle to draw an arrow pointing at a target: the bearing to it, minus which
 * way the phone is facing (if known). 0 = straight ahead / up.
 */
export function arrowAngle(bearing: number, heading: number | null | undefined): number {
  const h = heading == null || !Number.isFinite(heading) ? 0 : heading;
  return (((bearing - h) % 360) + 360) % 360;
}

export type Positioned = LatLng & { userId: string; updatedAt: string };

/**
 * People within `radiusM` of `center` whose position is recent enough to trust.
 * Used to suggest who shared a bill ("who was at the beach shack").
 */
export function nearbyPeople(
  center: LatLng,
  people: Positioned[],
  { radiusM = 150, maxAgeMs = 30 * 60_000, now = Date.now() }: { radiusM?: number; maxAgeMs?: number; now?: number } = {},
): string[] {
  return people
    .filter((p) => now - Date.parse(p.updatedAt) <= maxAgeMs && distanceMeters(center, p) <= radiusM)
    .map((p) => p.userId);
}

/** Inside a circular zone, with a little slack for GPS accuracy (capped). */
export function insideZone(point: LatLng & { accuracyM?: number | null }, zone: LatLng & { radiusM: number }): boolean {
  const slack = Math.min(Math.max(point.accuracyM ?? 0, 0), 50);
  return distanceMeters(point, zone) <= zone.radiusM + slack;
}

/** A circle drawn as a polygon ring ([lng, lat] pairs), for showing an arrival zone. */
export function circleRing(center: LatLng, radiusM: number, steps = 48): [number, number][] {
  const ring: [number, number][] = [];
  const latR = radiusM / 111_195;
  const lngR = radiusM / (111_195 * Math.max(Math.cos(rad(center.lat)), 1e-6));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([center.lng + lngR * Math.cos(a), center.lat + latR * Math.sin(a)]);
  }
  return ring;
}
