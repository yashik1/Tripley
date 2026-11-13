/**
 * Trip themes: the organizer can give a trip a theme. It sets the trip's
 * colours (inside the trip) and cover art, and tailors the packing list, the
 * scavenger hunt and the bucket list. No React here, so it can be tested.
 */
import type { PaletteKey } from './palettes';
import type { SuggestionCategory, TripTheme } from './types';

export type ThemePacking = { title: string; /** Already on the list if any item mentions one of these. */ match: string[] };
export type ThemeChallenge = { emoji: string; title: string; description: string };
export type ThemeIdea = { name: string; category: SuggestionCategory };

export type TripThemeInfo = {
  key: TripTheme;
  emoji: string;
  label: string;
  /** "a beach trip", for "Ideas for a beach trip". */
  phrase: string;
  palette: PaletteKey;
  packing: ThemePacking[];
  challenges: ThemeChallenge[];
  ideas: ThemeIdea[];
};

export const TRIP_THEMES: TripThemeInfo[] = [
  {
    key: 'beach',
    emoji: '🏖️',
    label: 'Beach',
    phrase: 'a beach trip',
    palette: 'ocean',
    packing: [
      { title: 'Swimwear', match: ['swim', 'bikini', 'trunks'] },
      { title: 'Sunscreen', match: ['sunscreen', 'sun cream', 'spf'] },
      { title: 'Beach towel', match: ['beach towel'] },
      { title: 'Sunglasses', match: ['sunglasses'] },
      { title: 'Flip-flops', match: ['flip-flop', 'sandals'] },
      { title: 'After-sun lotion', match: ['after-sun', 'aloe'] },
    ],
    challenges: [
      { emoji: '🌅', title: 'Catch the best sunset', description: 'Everyone votes on whose sunset photo wins.' },
      { emoji: '🏰', title: 'Build a sandcastle together', description: 'Bonus points for a moat that holds water.' },
      { emoji: '🐚', title: 'Find the most beautiful shell', description: 'Photograph it, then leave it on the beach.' },
    ],
    ideas: [
      { name: 'Sunset boat trip', category: 'experience' },
      { name: 'Snorkelling', category: 'experience' },
      { name: 'Beach club day', category: 'beach' },
      { name: 'Seafood lunch by the water', category: 'food' },
    ],
  },
  {
    key: 'ski',
    emoji: '⛷️',
    label: 'Ski',
    phrase: 'a ski trip',
    palette: 'midnight',
    packing: [
      { title: 'Thermal base layers', match: ['thermal', 'base layer'] },
      { title: 'Ski socks', match: ['ski socks'] },
      { title: 'Ski gloves', match: ['gloves'] },
      { title: 'Goggles', match: ['goggles'] },
      { title: 'Lip balm with SPF', match: ['lip balm'] },
      { title: 'Hand warmers', match: ['hand warmer'] },
    ],
    challenges: [
      { emoji: '🚡', title: 'Make the first lift of the day', description: 'Proof: a photo from the first chair up.' },
      { emoji: '❄️', title: 'Group snow angel photo', description: 'Everyone in the snow at once.' },
      { emoji: '🫕', title: 'Find the best après-ski spot', description: 'Hot chocolate counts.' },
    ],
    ideas: [
      { name: 'Ski or snowboard lessons', category: 'experience' },
      { name: 'Fondue night', category: 'food' },
      { name: 'Snowshoe walk', category: 'hike' },
      { name: 'Spa or hot tub evening', category: 'experience' },
    ],
  },
  {
    key: 'city',
    emoji: '🏙️',
    label: 'City break',
    phrase: 'a city break',
    palette: 'lavender',
    packing: [
      { title: 'Comfortable walking shoes', match: ['walking shoes', 'trainers', 'sneakers'] },
      { title: 'Day bag', match: ['day bag', 'backpack', 'tote'] },
      { title: 'Portable charger', match: ['power bank', 'portable charger'] },
      { title: 'Reusable water bottle', match: ['water bottle', 'bottle'] },
      { title: 'A nicer outfit for dinner', match: ['outfit', 'dress', 'shirt'] },
    ],
    challenges: [
      { emoji: '🚪', title: 'Find a hidden courtyard', description: 'The quieter, the better.' },
      { emoji: '🌆', title: 'Rooftop view at golden hour', description: 'A photo with the whole skyline.' },
      { emoji: '🚋', title: 'Ride every kind of transport', description: 'Tram, metro, bus, ferry: collect them all.' },
    ],
    ideas: [
      { name: 'Free walking tour', category: 'sight' },
      { name: 'Food market', category: 'food' },
      { name: 'Rooftop bar', category: 'nightlife' },
      { name: 'Museum morning', category: 'sight' },
    ],
  },
  {
    key: 'road_trip',
    emoji: '🚐',
    label: 'Road trip',
    phrase: 'a road trip',
    palette: 'sunset',
    packing: [
      { title: 'Phone mount for the car', match: ['phone mount', 'mount'] },
      { title: 'Car charger', match: ['car charger'] },
      { title: 'Snacks for the road', match: ['snack'] },
      { title: 'First-aid kit', match: ['first-aid', 'first aid'] },
      { title: 'Road-trip playlist', match: ['playlist'] },
    ],
    challenges: [
      { emoji: '🗿', title: 'Find the weirdest roadside attraction', description: 'The stranger, the better.' },
      { emoji: '🥨', title: 'Rate the service-station snacks', description: 'One winner by the end of the trip.' },
      { emoji: '🚗', title: 'Spot number plates from 10 places', description: 'Keep a running list in the feed.' },
    ],
    ideas: [
      { name: 'Scenic viewpoint stop', category: 'sight' },
      { name: 'Roadside diner', category: 'food' },
      { name: 'Detour to a small town', category: 'experience' },
      { name: 'Lake swim stop', category: 'beach' },
    ],
  },
  {
    key: 'camping',
    emoji: '🏕️',
    label: 'Camping',
    phrase: 'a camping trip',
    palette: 'forest',
    packing: [
      { title: 'Tent', match: ['tent'] },
      { title: 'Sleeping bag', match: ['sleeping bag'] },
      { title: 'Head torch', match: ['torch', 'headlamp', 'flashlight'] },
      { title: 'Insect repellent', match: ['repellent', 'bug spray'] },
      { title: 'Camping stove and gas', match: ['stove'] },
      { title: 'Rain jacket', match: ['rain jacket', 'waterproof'] },
    ],
    challenges: [
      { emoji: '🦌', title: 'Spot a wild animal', description: 'From a safe distance, with a photo.' },
      { emoji: '🔥', title: 'Tell the best campfire story', description: 'The group decides who wins.' },
      { emoji: '✨', title: 'Find a constellation', description: 'Name it, point at it, prove it.' },
    ],
    ideas: [
      { name: 'Sunrise hike', category: 'hike' },
      { name: 'Campfire dinner', category: 'food' },
      { name: 'Wild swim', category: 'beach' },
      { name: 'Stargazing night', category: 'experience' },
    ],
  },
  {
    key: 'celebration',
    emoji: '🎉',
    label: 'Celebration',
    phrase: 'a celebration trip',
    palette: 'berry',
    packing: [
      { title: 'Party outfit', match: ['outfit', 'dress'] },
      { title: 'Gift or card', match: ['gift', 'card'] },
      { title: 'ID for venues', match: [' id', 'passport'] },
      { title: 'Painkillers and rehydration salts', match: ['painkiller', 'rehydration'] },
    ],
    challenges: [
      { emoji: '🥂', title: 'Give the best toast of the trip', description: 'Short, sweet and on video.' },
      { emoji: '💃', title: 'Group dance video', description: 'Everyone in it, no excuses.' },
      { emoji: '🎁', title: 'Surprise the guest of honour', description: 'Plan it in secret, post the reaction.' },
    ],
    ideas: [
      { name: 'Group dinner reservation', category: 'food' },
      { name: 'Cocktail class', category: 'experience' },
      { name: 'Karaoke night', category: 'nightlife' },
      { name: 'Brunch the morning after', category: 'food' },
    ],
  },
];

export const TRIP_THEME_KEYS = TRIP_THEMES.map((t) => t.key);
export const isTripTheme = (v: unknown): v is TripTheme => typeof v === 'string' && (TRIP_THEME_KEYS as string[]).includes(v);
export const themeInfo = (theme: TripTheme | null | undefined): TripThemeInfo | null => TRIP_THEMES.find((t) => t.key === theme) ?? null;

/** Bucket-list starters for the trip's theme that nobody has suggested yet. */
export function themeIdeas(theme: TripTheme | null | undefined, existing: string[]): ThemeIdea[] {
  const have = new Set(existing.map((s) => s.trim().toLowerCase()));
  return (themeInfo(theme)?.ideas ?? []).filter((i) => !have.has(i.name.toLowerCase()));
}
