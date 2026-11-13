/**
 * Packing suggestions from the trip itself: how long it is, the weather at the
 * destination, and how you're getting there (bookings). Rules, not AI: free
 * for everyone, and they work offline once the weather is known.
 */
import { themeInfo } from './trip-themes';
import type { TripTheme } from './types';
import type { TripWeather } from './weather';

export type PackingSuggestion = { title: string; why: string };

const has = (list: string[], words: string[]) => list.some((t) => words.some((w) => t.toLowerCase().includes(w)));

export function packingSuggestions(input: {
  nights: number | null;
  weather: TripWeather | null;
  bookingKinds: string[];
  /** What's already on the list (anything similar isn't suggested again). */
  existing: string[];
  /** The trip's theme (beach, ski…): its own essentials come first. */
  theme?: TripTheme | null;
}): PackingSuggestion[] {
  const out: PackingSuggestion[] = [];
  const add = (title: string, why: string, already: string[] = [title.toLowerCase()]) => {
    if (!has(input.existing, already) && !out.some((x) => x.title === title)) out.push({ title, why });
  };
  const nights = input.nights;
  if (nights != null && nights > 0) {
    const sets = Math.min(nights + 1, 8);
    add(`${sets} sets of underwear and socks`, `${nights} ${nights === 1 ? 'night' : 'nights'} away${nights + 1 > 8 ? ', with a wash halfway' : ''}`, ['underwear', 'socks']);
    if (nights >= 7) add('Laundry bag', 'A week or more away', ['laundry']);
  }
  add('Phone charger', 'Every trip', ['charger']);
  const theme = themeInfo(input.theme);
  if (theme) for (const item of theme.packing) add(item.title, `${theme.label} trip`, item.match);
  const w = input.weather;
  if (w) {
    if (w.rainyDays > 0) add('Umbrella or rain jacket', `Rain on ${w.rainyDays} ${w.rainyDays === 1 ? 'day' : 'days'}`, ['umbrella', 'rain']);
    if (w.minC <= 3) {
      add('Warm coat', `Down to ${w.minC} °C`, ['coat', 'warm jacket', 'winter jacket', 'parka']);
      add('Hat, gloves and scarf', `Down to ${w.minC} °C`, ['gloves', 'scarf']);
    } else if (w.minC <= 10) {
      add('Warm jacket', `Down to ${w.minC} °C`, ['warm jacket', 'coat', 'fleece']);
    } else if (w.minC <= 16) {
      add('Light jumper', `Evenings around ${w.minC} °C`, ['jumper', 'sweater', 'hoodie']);
    }
    if (w.maxC >= 24) {
      add('Sunscreen', `Up to ${w.maxC} °C`, ['sunscreen', 'sun cream']);
      add('Sunglasses', `Up to ${w.maxC} °C`, ['sunglasses']);
      add('Sun hat', `Up to ${w.maxC} °C`, ['hat']);
    }
    if (w.maxC >= 28) add('Reusable water bottle', 'Hot days', ['water bottle', 'bottle']);
  }
  const kinds = new Set(input.bookingKinds);
  if (kinds.has('flight')) {
    add('Passport or ID', 'You’re flying', ['passport', ' id']);
    add('Liquids in a clear bag', 'Hand luggage rules', ['liquids']);
  }
  if (kinds.has('flight') || kinds.has('train') || kinds.has('bus') || kinds.has('ferry')) add('Headphones', 'For the journey', ['headphones', 'earphones']);
  if (kinds.has('car')) add('Driving licence', 'You’re hiring a car', ['licence', 'license']);
  return out;
}
