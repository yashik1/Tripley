/**
 * Travel passport badges. The server works out which ones a person has earned
 * (user_achievements); this file only describes them.
 */
export type Badge = { key: string; emoji: string; title: string; description: string; condition: string; color: 'teal' | 'coral' | 'yellow' | 'sky' };

export const BADGES: Badge[] = [
  { key: 'first_trip', emoji: '🎒', title: 'First Trip', description: 'The start of something great.', condition: 'Join or start your first trip', color: 'teal' },
  { key: 'group_planner', emoji: '🧭', title: 'Group Planner', description: 'You bring people together.', condition: 'Organize a trip that 3 or more people join', color: 'sky' },
  { key: 'food_explorer', emoji: '🍜', title: 'Food Explorer', description: 'Always finding the good stuff.', condition: 'Pin or suggest 5 places to eat', color: 'coral' },
  { key: 'adventure_seeker', emoji: '🥾', title: 'Adventure Seeker', description: 'Up for anything.', condition: 'Suggest 3 hikes, beaches or experiences', color: 'yellow' },
  { key: 'memory_maker', emoji: '📸', title: 'Memory Maker', description: 'The group’s photographer.', condition: 'Share 10 photos in trip feeds', color: 'coral' },
  { key: 'itinerary_pro', emoji: '🗓️', title: 'Itinerary Pro', description: 'Plans that actually happen.', condition: 'Add 10 plans to itineraries', color: 'teal' },
  { key: 'globetrotter', emoji: '🌍', title: 'Globetrotter', description: 'A seasoned traveller.', condition: 'Finish 3 trips', color: 'sky' },
  { key: 'team_spirit', emoji: '🙌', title: 'Team Spirit', description: 'Cheering everyone on.', condition: 'React to or comment on 20 friends’ posts', color: 'yellow' },
  { key: 'decision_maker', emoji: '🗳️', title: 'Decision Maker', description: 'No more “I don’t mind”.', condition: 'Start 3 polls that people vote in', color: 'teal' },
];

export type EarnedBadge = Badge & { earnedAt: string | null };

/** Every badge, earned ones first (oldest first), then the rest in order. */
export function passport(earned: { key: string; earned_at: string }[]): EarnedBadge[] {
  const at = new Map(earned.map((e) => [e.key, e.earned_at]));
  const list = BADGES.map((b) => ({ ...b, earnedAt: at.get(b.key) ?? null }));
  return [
    ...list.filter((b) => b.earnedAt).sort((a, b) => Date.parse(a.earnedAt!) - Date.parse(b.earnedAt!)),
    ...list.filter((b) => !b.earnedAt),
  ];
}
