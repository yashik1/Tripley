export type MapPerson = {
  id: string;
  name: string;
  initials: string;
  color: string;
  lat: number;
  lng: number;
  /** e.g. "2 min ago" */
  ago: string;
  stale: boolean;
  isMe: boolean;
};

export type TripMapProps = {
  people: MapPerson[];
  focusId?: string | null;
  onSelect?: (id: string) => void;
  /** Change this number to re-fit the map around everyone. */
  fitToken?: number;
};

export type Bounds = [west: number, south: number, east: number, north: number];

export function boundsOf(people: { lat: number; lng: number }[]): Bounds | null {
  if (people.length === 0) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of people) {
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  // Give a single person (or people standing together) some breathing room.
  const pad = 0.005;
  if (e - w < pad) { w -= pad; e += pad; }
  if (n - s < pad) { s -= pad; n += pad; }
  return [w, s, e, n];
}
