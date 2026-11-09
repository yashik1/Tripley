/**
 * Where a trip stands (planning, upcoming, on now, completed), the countdown,
 * which trip the dashboard features, real planning progress, and reminders.
 * Pure functions (no I/O) so they're unit tested; everything is computed from
 * the person's actual trip data.
 */
import type { Trip, TripStats } from './types';

const DAY = 86_400_000;
const at = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const daysBetween = (a: string, b: string) => Math.round((at(b) - at(a)) / DAY);

export type TripStatusKind = 'planning' | 'upcoming' | 'ongoing' | 'completed';
export type TripStatus = { kind: TripStatusKind; label: string; countdown: string | null; daysToGo: number | null };

type Dated = Pick<Trip, 'starts_on' | 'ends_on' | 'ended_at'>;

function isOver(trip: Dated, today: string): boolean {
  // Same rule as the server: ended, or a day past the end date (time zones).
  return !!trip.ended_at || (!!trip.ends_on && daysBetween(trip.ends_on, today) > 1);
}

export function tripStatus(trip: Dated, today: string): TripStatus {
  if (isOver(trip, today)) {
    return { kind: 'completed', label: 'Completed', countdown: null, daysToGo: null };
  }
  if (!trip.starts_on) {
    return { kind: 'planning', label: 'Planning', countdown: null, daysToGo: null };
  }
  const toGo = daysBetween(today, trip.starts_on);
  if (toGo > 0) {
    return {
      kind: 'upcoming',
      label: 'Upcoming',
      countdown: toGo === 1 ? 'Tomorrow' : `In ${toGo} days`,
      daysToGo: toGo,
    };
  }
  const day = -toGo + 1;
  const total = trip.ends_on ? daysBetween(trip.starts_on, trip.ends_on) + 1 : null;
  return {
    kind: 'ongoing',
    label: 'On now',
    countdown: total && day <= total ? `Day ${day} of ${total}` : total ? 'Last day' : `Day ${day}`,
    daysToGo: 0,
  };
}

/** The trip to put first: the one happening now, else the next to start, else the newest still being planned. */
export function featuredTrip<T extends Dated & { created_at: string }>(trips: T[], today: string): T | null {
  const live = trips.filter((t) => !isOver(t, today));
  const rank = (t: T) => {
    const s = tripStatus(t, today);
    if (s.kind === 'ongoing') return [0, 0];
    if (s.kind === 'upcoming') return [1, s.daysToGo ?? 0];
    return [2, -Date.parse(t.created_at)];
  };
  return [...live].sort((a, b) => {
    const [x1, x2] = rank(a);
    const [y1, y2] = rank(b);
    return x1 - y1 || x2 - y2;
  })[0] ?? null;
}

export type PlanningStep = { key: string; label: string; done: boolean };

/** Planning progress from real data. Extra steps (e.g. packing) are added when known. */
export function planningSteps(
  trip: Pick<Trip, 'starts_on' | 'cover_path'>,
  stats: Partial<TripStats> | undefined,
  extra: PlanningStep[] = [],
): { steps: PlanningStep[]; done: number; percent: number } {
  const s = stats ?? {};
  const steps: PlanningStep[] = [
    { key: 'dates', label: 'Dates set', done: !!trip.starts_on },
    { key: 'friends', label: 'Friends joined', done: Number(s.members ?? 1) >= 2 },
    { key: 'stay', label: 'Stay pinned', done: !!s.stay_pinned },
    { key: 'plan', label: 'Plan started', done: Number(s.stops ?? 0) >= 1 },
    { key: 'cover', label: 'Cover photo', done: !!trip.cover_path },
    ...extra,
  ];
  const done = steps.filter((x) => x.done).length;
  return { steps, done, percent: Math.round((done / steps.length) * 100) };
}

/** Time-of-day greeting. */
export function greeting(hour: number): string {
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The code from an invite link or a typed code ("https://…/join/ab12cd34ef56", "AB12 CD34 EF56"). */
export function parseInviteCode(input: string): string | null {
  const s = input.trim();
  const fromLink = /\/join\/([0-9a-z]{6,32})(?:[/?#]|$)/i.exec(s);
  const raw = (fromLink ? fromLink[1] : s.replace(/[\s-]/g, '')).toLowerCase();
  return /^[0-9a-f]{12}$/.test(raw) ? raw : null;
}
