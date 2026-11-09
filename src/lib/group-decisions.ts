/**
 * Bucket list and poll maths: categories, ranking by votes, poll results and
 * closing times. Pure functions so they can be unit tested.
 */
import type { Poll, Suggestion, SuggestionCategory } from './types';

export const CATEGORIES: { key: SuggestionCategory; emoji: string; label: string }[] = [
  { key: 'food', emoji: '🍽️', label: 'Food & drink' },
  { key: 'sight', emoji: '🏛️', label: 'Sights' },
  { key: 'beach', emoji: '🏖️', label: 'Beaches' },
  { key: 'hike', emoji: '🥾', label: 'Hikes' },
  { key: 'experience', emoji: '🎟️', label: 'Experiences' },
  { key: 'shopping', emoji: '🛍️', label: 'Shopping' },
  { key: 'nightlife', emoji: '🌙', label: 'Nightlife' },
  { key: 'other', emoji: '✨', label: 'Other' },
];

export const categoryOf = (key: string) => CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[CATEGORIES.length - 1];

/** Most votes first; ties go to the newest. Ideas already in the plan go last. */
export function rankSuggestions(list: Suggestion[]): Suggestion[] {
  return [...list].sort(
    (a, b) =>
      Number(!!a.itinerary_item_id) - Number(!!b.itinerary_item_id) ||
      b.suggestion_votes.length - a.suggestion_votes.length ||
      Date.parse(b.created_at) - Date.parse(a.created_at),
  );
}

export function pollIsOpen(poll: Pick<Poll, 'closed_at' | 'closes_at'>, now = Date.now()): boolean {
  return !poll.closed_at && (!poll.closes_at || Date.parse(poll.closes_at) > now);
}

export type PollResult = {
  open: boolean;
  total: number;
  myVote: string | null;
  options: { id: string; label: string; count: number; percent: number; mine: boolean; leading: boolean }[];
};

export function pollResults(poll: Poll, me: string, now = Date.now()): PollResult {
  const options = [...poll.poll_options].sort((a, b) => a.position - b.position);
  const total = poll.poll_votes.length;
  const counts = options.map((o) => poll.poll_votes.filter((v) => v.option_id === o.id).length);
  const top = Math.max(0, ...counts);
  const myVote = poll.poll_votes.find((v) => v.user_id === me)?.option_id ?? null;
  return {
    open: pollIsOpen(poll, now),
    total,
    myVote,
    options: options.map((o, i) => ({
      id: o.id,
      label: o.label,
      count: counts[i],
      percent: total ? Math.round((counts[i] / total) * 100) : 0,
      mine: myVote === o.id,
      leading: top > 0 && counts[i] === top,
    })),
  };
}

/** "Closes in 40 min", "Closes in 3 h", "Closes in 2 days", "Closed". */
export function closingLabel(poll: Pick<Poll, 'closed_at' | 'closes_at'>, now = Date.now()): string | null {
  if (!pollIsOpen(poll, now)) return 'Closed';
  if (!poll.closes_at) return null;
  const mins = Math.round((Date.parse(poll.closes_at) - now) / 60_000);
  if (mins < 60) return `Closes in ${Math.max(1, mins)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `Closes in ${hours} h`;
  return `Closes in ${Math.round(hours / 24)} days`;
}
