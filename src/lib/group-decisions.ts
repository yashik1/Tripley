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
  /** How many people voted (in a more-than-one poll, someone can pick several options). */
  total: number;
  /** Your first pick, or null. */
  myVote: string | null;
  /** All your picks. */
  myVotes: string[];
  options: {
    id: string;
    label: string;
    count: number;
    percent: number;
    mine: boolean;
    leading: boolean;
    /** Ranked polls: Borda points (first choice of n options scores n, then n−1…) and your place for it. */
    points?: number;
    myRank?: number | null;
  }[];
};

export function pollResults(poll: Poll, me: string, now = Date.now()): PollResult {
  if (poll.ranked) return rankedResults(poll, me, now);
  const options = [...poll.poll_options].sort((a, b) => a.position - b.position);
  // Percentages are of people who voted, so a more-than-one poll can add up past 100%.
  const total = new Set(poll.poll_votes.map((v) => v.user_id)).size;
  const counts = options.map((o) => poll.poll_votes.filter((v) => v.option_id === o.id).length);
  const top = Math.max(0, ...counts);
  const mine = new Set(poll.poll_votes.filter((v) => v.user_id === me).map((v) => v.option_id));
  const myVotes = options.filter((o) => mine.has(o.id)).map((o) => o.id);
  return {
    open: pollIsOpen(poll, now),
    total,
    myVote: myVotes[0] ?? null,
    myVotes,
    options: options.map((o, i) => ({
      id: o.id,
      label: o.label,
      count: counts[i],
      percent: total ? Math.round((counts[i] / total) * 100) : 0,
      mine: mine.has(o.id),
      leading: top > 0 && counts[i] === top,
    })),
  };
}

/**
 * Ranked polls, Borda count: with n options, each person's first choice scores
 * n points, the second n−1, and so on; options they left out score nothing.
 * count is how many people put it first; bars are relative to the leader.
 */
function rankedResults(poll: Poll, me: string, now: number): PollResult {
  const options = [...poll.poll_options].sort((a, b) => a.position - b.position);
  const n = options.length;
  const byVoter = new Map<string, { option_id: string; rank: number }[]>();
  for (const v of poll.poll_votes) {
    const list = byVoter.get(v.user_id) ?? [];
    list.push({ option_id: v.option_id, rank: v.rank ?? 99 });
    byVoter.set(v.user_id, list);
  }
  const points = new Map<string, number>();
  const firsts = new Map<string, number>();
  for (const list of byVoter.values()) {
    [...list]
      .sort((a, b) => a.rank - b.rank)
      .forEach((v, i) => {
        points.set(v.option_id, (points.get(v.option_id) ?? 0) + Math.max(0, n - i));
        if (i === 0) firsts.set(v.option_id, (firsts.get(v.option_id) ?? 0) + 1);
      });
  }
  const top = Math.max(0, ...options.map((o) => points.get(o.id) ?? 0));
  const mine = [...(byVoter.get(me) ?? [])].sort((a, b) => a.rank - b.rank).map((v) => v.option_id);
  return {
    open: pollIsOpen(poll, now),
    total: byVoter.size,
    myVote: mine[0] ?? null,
    myVotes: mine,
    options: options.map((o) => {
      const p = points.get(o.id) ?? 0;
      const place = mine.indexOf(o.id);
      return {
        id: o.id,
        label: o.label,
        count: firsts.get(o.id) ?? 0,
        percent: top ? Math.round((p / top) * 100) : 0,
        mine: place >= 0,
        leading: top > 0 && p === top,
        points: p,
        myRank: place >= 0 ? place + 1 : null,
      };
    }),
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
