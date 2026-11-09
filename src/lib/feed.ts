/**
 * Words and numbers for the activity feed: what an automatic post says, and
 * reaction counts. Pure functions so they can be unit tested.
 */
import type { FeedPost } from './types';

/** "Ana pinned where you're staying: Casa Lisboa" etc. for automatic posts. */
export function eventText(event: FeedPost['event'], actor: string): string {
  if (!event) return '';
  const label = typeof event.label === 'string' ? event.label : '';
  switch (event.type) {
    case 'trip_started':
      return `${actor} started the trip`;
    case 'member_joined':
      return `${actor} joined the trip 👋`;
    case 'place_pinned':
      switch (event.place_kind) {
        case 'stay':
          return `${actor} pinned where you're staying: ${label}`;
        case 'food':
          return `${actor} found a great place to eat: ${label}`;
        case 'sight':
          return `${actor} added a must-see: ${label}`;
        case 'meetup':
          return `${actor} set a meeting point: ${label}`;
        default:
          return `${actor} pinned ${label}`;
      }
    case 'stop_added':
      return `${actor} added "${label}" to the plan`;
    case 'bill_added':
      return `${actor} added a bill: ${label}`;
    case 'suggestion_added':
      return `${actor} suggested ${label} for the bucket list`;
    case 'poll_created':
      return `${actor} started a poll: ${label}`;
    default:
      return `${actor} updated the trip`;
  }
}

/** An emoji for each automatic post. */
export function eventEmoji(event: FeedPost['event']): string {
  switch (event?.type) {
    case 'trip_started':
      return '✈️';
    case 'member_joined':
      return '👋';
    case 'place_pinned':
      return event.place_kind === 'food' ? '🍽️' : event.place_kind === 'stay' ? '🏨' : '📍';
    case 'stop_added':
      return '🗓️';
    case 'bill_added':
      return '🧾';
    case 'suggestion_added':
      return '💡';
    case 'poll_created':
      return '📊';
    default:
      return '✨';
  }
}

/** Reaction counts in a fixed order, with whether I picked each. */
export function reactionCounts(reactions: { user_id: string; emoji: string }[], me: string, emojis: readonly string[]) {
  return emojis
    .map((emoji) => {
      const by = reactions.filter((r) => r.emoji === emoji);
      return { emoji, count: by.length, mine: by.some((r) => r.user_id === me) };
    })
    .filter((r) => r.count > 0);
}
