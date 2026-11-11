/**
 * The best order for a day's stops: the shortest walk that still keeps booked
 * times in time order. Pure functions, no I/O.
 *
 * - Distances are straight lines between map points (no paid routing
 *   service), so walking times are estimates: straight-line distance × 1.3
 *   for streets, at 4.8 km/h.
 * - Stops with a start time keep their time order; stops without one can go
 *   anywhere between them. Being late for a booked stop (not enough time to
 *   walk there) counts against an order, like 150 m of extra walking per
 *   minute late, so sights are fitted where there's time for them.
 * - Stops with no map point can't be routed, so they keep their place in the
 *   list and the others are ordered around them.
 * - Up to 8 movable stops the order is the best possible (every order is
 *   tried); above that, a good order is found by moving stops one at a time
 *   and reversing stretches until nothing gets shorter.
 */
import { distanceMeters, type LatLng } from './geo';
import type { ItineraryItem } from './types';

export type RouteStop = Pick<ItineraryItem, 'id' | 'title' | 'starts_at' | 'ends_at' | 'lat' | 'lng'>;
export type RouteStart = { label: string; lat: number; lng: number } | null;

/** Streets aren't straight: a rough factor from straight-line to walking distance. */
export const STREET_FACTOR = 1.3;
export const WALK_KMH = 4.8;

const located = (s: RouteStop): s is RouteStop & { lat: number; lng: number } => s.lat != null && s.lng != null;
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Walking minutes for a straight-line distance in metres. */
export function walkMinutes(meters: number): number {
  return Math.round(((meters * STREET_FACTOR) / 1000 / WALK_KMH) * 60);
}

/** Total straight-line length of visiting `points` in order, from `start` and (if `back`) back to it. */
export function pathLength(points: LatLng[], start: LatLng | null, back: boolean): number {
  let total = 0;
  let prev = start;
  for (const p of points) {
    if (prev) total += distanceMeters(prev, p);
    prev = p;
  }
  if (start && back && points.length) total += distanceMeters(points[points.length - 1], start);
  return total;
}

/** Timed stops (by index into `stops`) must stay in this order. */
function timedOrderOk(order: number[], stops: RouteStop[]): boolean {
  let last = -1;
  for (const i of order) {
    const t = stops[i].starts_at;
    if (!t) continue;
    const m = minutesOf(t);
    if (m < last) return false;
    last = m;
  }
  return true;
}

function permutations(n: number, visit: (p: number[]) => void) {
  const p = [...Array(n).keys()];
  const c = new Array(n).fill(0);
  visit(p);
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      const j = i % 2 ? c[i] : 0;
      [p[j], p[i]] = [p[i], p[j]];
      visit(p);
      c[i] += 1;
      i = 0;
    } else {
      c[i] = 0;
      i += 1;
    }
  }
}

/** Metres of walking one minute late for a booking is worth avoiding. */
const LATE_METERS_PER_MINUTE = 150;

/** Minutes late, summed over the booked stops, walking `ordered` as listed. */
export function lateMinutes(ordered: RouteStop[]): number {
  return tightConnections(ordered).reduce((sum, c) => sum + (c.walkMinutes - c.gapMinutes), 0);
}

/** Best order (indexes into `stops`, all of which have map points). */
function bestOrder(stops: (RouteStop & LatLng)[], start: LatLng | null, back: boolean): number[] {
  const n = stops.length;
  const len = (order: number[]) => {
    const ordered = order.map((i) => stops[i]);
    return pathLength(ordered, start, back) + LATE_METERS_PER_MINUTE * lateMinutes(ordered);
  };
  // Start from the time order, with untimed stops where they were.
  const timed = stops.map((s, i) => ({ s, i })).filter((x) => x.s.starts_at).sort((a, b) => minutesOf(a.s.starts_at!) - minutesOf(b.s.starts_at!));
  let k = 0;
  let best = stops.map((s, i) => (s.starts_at ? timed[k++].i : i));
  let bestLen = len(best);

  if (n <= 8) {
    permutations(n, (p) => {
      if (!timedOrderOk(p, stops)) return;
      const l = len(p);
      if (l < bestLen - 1e-6) {
        bestLen = l;
        best = [...p];
      }
    });
    return best;
  }

  // Larger days: improve until no single move or reversal helps.
  let improved = true;
  for (let round = 0; improved && round < 200; round++) {
    improved = false;
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        if (a === b) continue;
        const moved = [...best];
        const [x] = moved.splice(a, 1);
        moved.splice(b, 0, x);
        if (timedOrderOk(moved, stops)) {
          const l = len(moved);
          if (l < bestLen - 1e-6) {
            best = moved;
            bestLen = l;
            improved = true;
          }
        }
        if (b > a) {
          const flipped = [...best.slice(0, a), ...best.slice(a, b + 1).reverse(), ...best.slice(b + 1)];
          if (timedOrderOk(flipped, stops)) {
            const l = len(flipped);
            if (l < bestLen - 1e-6) {
              best = flipped;
              bestLen = l;
              improved = true;
            }
          }
        }
      }
    }
  }
  return best;
}

export type RoutePlan = {
  /** How many stops have a map point (only these are routed). */
  routed: number;
  /** Stop ids in the current order, and in the suggested order (stops with no map point keep their place). */
  currentIds: string[];
  suggestedIds: string[];
  /** Straight-line metres in the current and suggested order (from and back to the start, when there is one). */
  currentMeters: number;
  suggestedMeters: number;
  /** Minutes late for booked stops, summed, in each order. */
  currentLate: number;
  suggestedLate: number;
  /** Worth suggesting: at least 10% and 300 m shorter, or at least 10 minutes less late. */
  better: boolean;
};

/** The day's route now, and the best order for it. `stops` must be in the day's current order. */
export function planRoute(stops: RouteStop[], start: RouteStart, back = true): RoutePlan {
  const slots: number[] = [];
  const movable: (RouteStop & LatLng)[] = [];
  stops.forEach((s, i) => {
    if (located(s)) {
      slots.push(i);
      movable.push(s);
    }
  });
  const from = start ? { lat: start.lat, lng: start.lng } : null;
  const currentMeters = pathLength(movable, from, back);
  const order = movable.length >= 2 ? bestOrder(movable, from, back) : movable.map((_, i) => i);
  const suggested = [...stops];
  order.forEach((m, k) => {
    suggested[slots[k]] = movable[m];
  });
  const suggestedMeters = pathLength(order.map((i) => movable[i]), from, back);
  const currentLate = lateMinutes(movable);
  const suggestedLate = lateMinutes(order.map((i) => movable[i]));
  const saved = currentMeters - suggestedMeters;
  const changed = order.some((m, k) => m !== k);
  return {
    routed: movable.length,
    currentIds: stops.map((s) => s.id),
    suggestedIds: suggested.map((s) => s.id),
    currentMeters,
    suggestedMeters,
    currentLate,
    suggestedLate,
    better: changed && ((saved >= 300 && saved >= currentMeters * 0.1) || currentLate - suggestedLate >= 10),
  };
}

export type TightConnection = { fromTitle: string; toTitle: string; via: number; walkMinutes: number; gapMinutes: number };

/**
 * Booked stops (in this order) you can't walk between in time: "Tile museum
 * ends 12:00, lunch is at 12:15, about 35 min on foot". The walk goes through
 * any untimed stops planned in between (`via`), without counting time spent
 * there. Only stops with map points are checked.
 */
export function tightConnections(stops: RouteStop[]): TightConnection[] {
  const out: TightConnection[] = [];
  const route = stops.filter(located);
  let prev = -1; // index in `route` of the last timed stop
  for (let i = 0; i < route.length; i++) {
    if (!route[i].starts_at) continue;
    if (prev >= 0) {
      const a = route[prev];
      const b = route[i];
      const gap = minutesOf(b.starts_at!) - minutesOf(a.ends_at ?? a.starts_at!);
      let meters = 0;
      for (let k = prev + 1; k <= i; k++) meters += distanceMeters(route[k - 1], route[k]);
      const walk = walkMinutes(meters);
      if (gap >= 0 && walk > gap) out.push({ fromTitle: a.title, toTitle: b.title, via: i - prev - 1, walkMinutes: walk, gapMinutes: gap });
    }
    prev = i;
  }
  return out;
}

/** "1.8 km", "650 m" */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

/** "25 min", "1 h 35 min" */
export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
