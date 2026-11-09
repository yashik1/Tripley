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

export type PlaceKind = 'stay' | 'airport' | 'meetup' | 'food' | 'sight' | 'memory' | 'other';

export type MapPlace = {
  id: string;
  name: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
  radiusM: number;
  /** Arrival alerts on: the zone is drawn on the map. */
  alerts: boolean;
  /** Overrides the kind's emoji (e.g. 🗓️ for a stop from the plan). */
  emoji?: string;
};

export const PLACE_KINDS: { kind: PlaceKind; emoji: string; label: string; alertsByDefault: boolean }[] = [
  { kind: 'stay', emoji: '🏨', label: 'Where we stay', alertsByDefault: true },
  { kind: 'airport', emoji: '✈️', label: 'Airport / station', alertsByDefault: true },
  { kind: 'meetup', emoji: '📍', label: 'Meeting point', alertsByDefault: true },
  { kind: 'food', emoji: '🍽️', label: 'Food & drink', alertsByDefault: false },
  { kind: 'sight', emoji: '⭐', label: 'Must see', alertsByDefault: false },
  { kind: 'memory', emoji: '📸', label: 'Memory', alertsByDefault: false },
  { kind: 'other', emoji: '🔖', label: 'Other', alertsByDefault: false },
];

export const placeEmoji = (kind: PlaceKind) => PLACE_KINDS.find((k) => k.kind === kind)?.emoji ?? '🔖';

export type TripMapProps = {
  people: MapPerson[];
  places?: MapPlace[];
  focusId?: string | null;
  onSelect?: (id: string) => void;
  onPlacePress?: (id: string) => void;
  /** While true, tapping the map picks a spot (for pinning a place). */
  picking?: boolean;
  onPick?: (lat: number, lng: number) => void;
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
  // Show at least ~200 m around a single person or people standing together,
  // centred on them, so friends a street apart don't end up on one spot.
  const min = 0.002;
  if (e - w < min) {
    const c = (w + e) / 2;
    w = c - min / 2;
    e = c + min / 2;
  }
  if (n - s < min) {
    const c = (s + n) / 2;
    s = c - min / 2;
    n = c + min / 2;
  }
  return [w, s, e, n];
}
