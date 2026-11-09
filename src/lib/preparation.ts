/**
 * Getting ready for a trip: a starter packing list, challenge ideas and
 * progress numbers. Pure, so it can be unit tested.
 */
import type { PlanningStep } from './trip-status';
import type { TripStats, TripTask } from './types';

/** Common things people forget; added only when someone taps "add common items". */
export const PACKING_STARTERS = [
  'Passport or ID',
  'Phone charger',
  'Travel adapter',
  'Medication',
  'Toothbrush',
  'Sunscreen',
  'Comfortable shoes',
  'Reusable water bottle',
  'Headphones',
  'Copies of bookings',
];

/** Light-hearted challenge ideas. None needs anyone's location or personal details. */
export const CHALLENGE_IDEAS = [
  { emoji: '🍽️', title: 'Find the best local food', description: 'Post your favourite bite of the trip.' },
  { emoji: '💎', title: 'Discover a hidden gem', description: 'A spot the guidebooks missed.' },
  { emoji: '📸', title: 'Take the best group photo', description: 'Everyone in it, everyone smiling.' },
  { emoji: '🎭', title: 'Try a local experience', description: 'A class, a festival, a tradition.' },
  { emoji: '🗺️', title: 'Visit somewhere new', description: 'A place none of you has been before.' },
];

/** Packing items you haven't added yet (case-insensitive). */
export function missingStarters(items: Pick<TripTask, 'title'>[]): string[] {
  const have = new Set(items.map((i) => i.title.trim().toLowerCase()));
  return PACKING_STARTERS.filter((s) => !have.has(s.toLowerCase()));
}

export function progress(tasks: Pick<TripTask, 'done'>[]): { done: number; total: number; percent: number } {
  const done = tasks.filter((t) => t.done).length;
  return { done, total: tasks.length, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
}

/** The packing step for planning progress: done once you've packed everything on your list. */
export function packingStep(stats: Partial<TripStats> | undefined): PlanningStep {
  const total = Number(stats?.packing_total ?? 0);
  const done = Number(stats?.packing_done ?? 0);
  return { key: 'packing', label: 'Packed', done: total > 0 && done >= total };
}
