/**
 * The shared plan: days, times and clashes. Pure functions (no I/O) so they can
 * be unit tested.
 */
import type { ItineraryItem, ItineraryRsvp, RsvpStatus } from './types';

export const RSVP_OPTIONS: { value: RsvpStatus; label: string }[] = [
  { value: 'going', label: 'Going' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'not_going', label: 'Not going' },
];

/** "9:30", "09:30", "930", "9.30", "9" -> "09:30" / "09:00"; null when blank; undefined when not a time. */
export function parseTime(input: string): string | null | undefined {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm)?$/.exec(s);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (m[3]) {
    if (h < 1 || h > 12) return undefined;
    h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
  }
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** "13:05:00" -> "13:05" */
export const shortTime = (t: string | null) => (t ? t.slice(0, 5) : null);

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function timeRange(item: Pick<ItineraryItem, 'starts_at' | 'ends_at'>): string | null {
  const a = shortTime(item.starts_at);
  const b = shortTime(item.ends_at);
  if (!a) return null;
  return b ? `${a} – ${b}` : a;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type PlanDay = { day: string; label: string; count: number };

/**
 * The days to show as tabs: every day of the trip when it has dates (capped
 * at 31), or the coming week when it hasn't, plus any other day that has
 * stops, in order. "Today" is marked.
 */
export function planDays(
  trip: { starts_on: string | null; ends_on: string | null },
  items: Pick<ItineraryItem, 'day'>[],
  today: string,
): PlanDay[] {
  const set = new Set<string>(items.map((i) => i.day));
  if (trip.starts_on) {
    const end = trip.ends_on && trip.ends_on >= trip.starts_on ? trip.ends_on : trip.starts_on;
    for (let d = trip.starts_on, n = 0; d <= end && n < 31; d = addDays(d, 1), n++) set.add(d);
  } else {
    for (let d = today, n = 0; n < 7; d = addDays(d, 1), n++) set.add(d);
  }
  const days = [...set].sort();
  return days.map((day) => {
    const n = trip.starts_on ? Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${trip.starts_on}T12:00:00Z`)) / 86_400_000) + 1 : null;
    const label = day === today ? 'Today' : n != null && n >= 1 ? `Day ${n}` : new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
    return { day, label, count: items.filter((i) => i.day === day).length };
  });
}

/** The day to open on: today if it's a plan day, else the next day with stops, else the first day. */
export function defaultDay(days: PlanDay[], today: string): string {
  if (days.some((d) => d.day === today)) return today;
  return days.find((d) => d.day >= today && d.count > 0)?.day ?? days.find((d) => d.count > 0)?.day ?? days[0]?.day ?? today;
}

/**
 * Stops whose times overlap on the same day: item id -> titles it clashes
 * with. A stop with only a start time counts as starting then (it clashes if
 * another stop is running at that moment, or starts at the same time).
 */
export function findConflicts(items: Pick<ItineraryItem, 'id' | 'day' | 'title' | 'starts_at' | 'ends_at'>[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const timed = items.filter((i) => i.starts_at);
  for (let a = 0; a < timed.length; a++) {
    for (let b = a + 1; b < timed.length; b++) {
      const x = timed[a];
      const y = timed[b];
      if (x.day !== y.day) continue;
      const xs = minutes(x.starts_at!);
      const ys = minutes(y.starts_at!);
      const xe = x.ends_at ? minutes(x.ends_at) : xs;
      const ye = y.ends_at ? minutes(y.ends_at) : ys;
      const overlap = xs === ys || (xs < ye && ys < xe) || (x.ends_at == null && xs > ys && xs < ye) || (y.ends_at == null && ys > xs && ys < xe);
      if (!overlap) continue;
      out.set(x.id, [...(out.get(x.id) ?? []), y.title]);
      out.set(y.id, [...(out.get(y.id) ?? []), x.title]);
    }
  }
  return out;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * A time to move a clashing stop to, on the same day: the first gap after it
 * (or else the last one before it) that fits its length, on the quarter hour,
 * between 07:00 and 23:00, clashing with nothing (findConflicts' rules).
 * Null when there's no room that day.
 */
export function suggestFreeSlot(
  item: Pick<ItineraryItem, 'id' | 'day' | 'title' | 'starts_at' | 'ends_at'>,
  sameDay: Pick<ItineraryItem, 'id' | 'day' | 'title' | 'starts_at' | 'ends_at'>[],
): { starts_at: string; ends_at: string | null } | null {
  if (!item.starts_at) return null;
  const start = minutes(item.starts_at);
  const length = item.ends_at ? Math.max(15, minutes(item.ends_at) - start) : 0;
  const others = sameDay.filter((o) => o.id !== item.id && o.day === item.day && o.starts_at);
  const fits = (s: number) => {
    const moved = { ...item, starts_at: hhmm(s), ends_at: item.ends_at ? hhmm(s + length) : null };
    return !findConflicts([moved, ...others]).has(item.id);
  };
  const earliest = 7 * 60;
  const latest = 23 * 60 - Math.max(length, 15);
  for (let s = Math.ceil((start + 1) / 15) * 15; s <= latest; s += 15) {
    if (fits(s)) return { starts_at: hhmm(s), ends_at: item.ends_at ? hhmm(s + length) : null };
  }
  for (let s = Math.floor((start - 1) / 15) * 15; s >= earliest; s -= 15) {
    if (fits(s)) return { starts_at: hhmm(s), ends_at: item.ends_at ? hhmm(s + length) : null };
  }
  return null;
}

/** Who answered what for one stop. */
export function rsvpSummary(rsvps: ItineraryRsvp[], itemId: string, me: string) {
  const mine = rsvps.find((r) => r.item_id === itemId && r.user_id === me)?.status ?? null;
  const by = (s: RsvpStatus) => rsvps.filter((r) => r.item_id === itemId && r.status === s).map((r) => r.user_id);
  return { mine, going: by('going'), maybe: by('maybe'), notGoing: by('not_going') };
}

/** Stops for the map: the plan day shown (or the next one with stops), only those with a map point. */
export function stopsForMap(items: ItineraryItem[], today: string): ItineraryItem[] {
  const located = items.filter((i) => i.lat != null && i.lng != null);
  if (located.length === 0) return [];
  const days = [...new Set(located.map((i) => i.day))].sort();
  const day = days.find((d) => d >= today) ?? days[days.length - 1];
  return located.filter((i) => i.day === day);
}
