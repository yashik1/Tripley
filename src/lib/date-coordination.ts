/**
 * Finding dates that work for the group: which stretches of `length` days
 * inside the window the most people can make. Pure functions, no I/O.
 */
import type { Availability } from './types';

const DAY = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

/** Every day from `start` to `end`, inclusive (at most 400). */
export function windowDays(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = toDate(start).getTime(), n = 0; t <= toDate(end).getTime() && n < 400; t += DAY, n++) out.push(toIso(new Date(t)));
  return out;
}

export function addDays(iso: string, n: number): string {
  return toIso(new Date(toDate(iso).getTime() + n * DAY));
}

/** For each day: how many can go, and how many maybe. */
export function dayCounts(answers: Availability[]): Map<string, { yes: number; maybe: number }> {
  const out = new Map<string, { yes: number; maybe: number }>();
  for (const a of answers) {
    const c = out.get(a.day) ?? { yes: 0, maybe: 0 };
    c[a.status] += 1;
    out.set(a.day, c);
  }
  return out;
}

export type DateOption = {
  start: string;
  end: string;
  /** People who can go on every day. */
  everyDay: string[];
  /** People who can go every day, but some only "maybe". */
  maybe: string[];
  /** People who can't make at least one of the days (or haven't answered). */
  missing: string[];
};

/**
 * The best stretches of `length` days: most people who can make every day
 * first (a "maybe" counts half), then fewest maybes, then earliest. Only
 * stretches at least one person can make are returned.
 */
export function bestDates(answers: Availability[], members: string[], start: string, end: string, length: number, limit = 3): DateOption[] {
  const status = new Map<string, 'yes' | 'maybe'>(answers.map((a) => [`${a.user_id}|${a.day}`, a.status]));
  const days = windowDays(start, end);
  const options: (DateOption & { score: number })[] = [];
  for (let i = 0; i + length <= days.length; i++) {
    const stretch = days.slice(i, i + length);
    const everyDay: string[] = [];
    const maybe: string[] = [];
    const missing: string[] = [];
    for (const m of members) {
      const s = stretch.map((d) => status.get(`${m}|${d}`));
      if (s.every((x) => x === 'yes')) everyDay.push(m);
      else if (s.every((x) => x === 'yes' || x === 'maybe')) maybe.push(m);
      else missing.push(m);
    }
    const score = everyDay.length + maybe.length / 2;
    if (score > 0) options.push({ start: stretch[0], end: stretch[stretch.length - 1], everyDay, maybe, missing, score });
  }
  options.sort((a, b) => b.score - a.score || a.maybe.length - b.maybe.length || a.start.localeCompare(b.start));
  // Don't offer three nearly identical stretches: skip ones overlapping a better one.
  const picked: (DateOption & { score: number })[] = [];
  for (const o of options) {
    if (picked.some((p) => o.start <= p.end && p.start <= o.end)) continue;
    picked.push(o);
    if (picked.length === limit) break;
  }
  return picked.map(({ score: _score, ...o }) => o);
}

/** Who has answered at all. */
export function answered(answers: Availability[]): Set<string> {
  return new Set(answers.map((a) => a.user_id));
}

/** Weeks for a calendar: rows of 7 (Monday first), with nulls before the first day and after the last. */
export function calendarWeeks(days: string[]): (string | null)[][] {
  if (!days.length) return [];
  const first = (toDate(days[0]).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array(first).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
