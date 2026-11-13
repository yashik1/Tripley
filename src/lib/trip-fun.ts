/**
 * Trip Fun: the pure parts of the seven features (no network, no React), so
 * they can be tested on their own.
 *   Trip Awards results, Soundtrack links, Food Explorer kinds, the Living
 *   Trip Timeline, the Digital Travel Scrapbook and My Travel Passport.
 */
import type { Challenge, FeedPost, FoodKind, FunEntry, FunFeature, ItineraryItem, PassportStamp, Trip, TripMemory } from './types';

// ---------------------------------------------------------------- the hub

export type FunFeatureKey =
  | 'travel_scrapbook'
  | 'travel_passport'
  | 'scavenger_hunt'
  | 'trip_awards'
  | 'trip_soundtrack'
  | 'food_explorer'
  | 'living_timeline'
  | 'adventure_wheel'
  | 'secret_missions';

/** Every Trip Fun feature, in the order the hub shows them. */
export const FUN_FEATURES: { key: FunFeatureKey; emoji: string; title: string; blurb: string }[] = [
  { key: 'travel_scrapbook', emoji: '📔', title: 'Digital Travel Scrapbook', blurb: 'Photos and memories from the trip, day by day' },
  { key: 'travel_passport', emoji: '🛂', title: 'My Travel Passport', blurb: 'Your countries, cities and travel milestones' },
  { key: 'scavenger_hunt', emoji: '🧭', title: 'Adventure Scavenger Hunt', blurb: 'Group challenges, with photo proof in the feed' },
  { key: 'trip_awards', emoji: '🏆', title: 'Trip Awards', blurb: 'Vote for who made the trip; see the winners' },
  { key: 'trip_soundtrack', emoji: '🎵', title: 'Trip Soundtrack', blurb: 'Songs, links and the moments they go with' },
  { key: 'food_explorer', emoji: '🍜', title: 'Food Explorer', blurb: 'Dishes, restaurants and food moments, with photos' },
  { key: 'living_timeline', emoji: '📖', title: 'Living Trip Timeline', blurb: 'Everything that happened, in order' },
  { key: 'adventure_wheel', emoji: '🎡', title: 'Spin the Adventure Wheel', blurb: 'Let chance pick what the group does next' },
  { key: 'secret_missions', emoji: '🕵️', title: 'Secret Missions', blurb: 'A private, fun task for one friend' },
];

/** Features the catalogue has switched on (all of the chosen seven if it hasn't loaded or is unreachable). */
export function enabledFeatures(catalogue: FunFeature[] | undefined): FunFeatureKey[] {
  const fallback: FunFeatureKey[] = ['travel_scrapbook', 'travel_passport', 'scavenger_hunt', 'trip_awards', 'trip_soundtrack', 'food_explorer', 'living_timeline'];
  if (!catalogue?.length) return fallback;
  const on = new Set(catalogue.filter((f) => f.enabled).map((f) => f.feature_key));
  return FUN_FEATURES.map((f) => f.key).filter((k) => on.has(k));
}

// ---------------------------------------------------------------- awards

export const AWARDS = [
  { key: 'food_scout', label: 'Food Scout', emoji: '🍜' },
  { key: 'photo_pro', label: 'Photo Pro', emoji: '📸' },
  { key: 'human_gps', label: 'Human GPS', emoji: '🧭' },
  { key: 'adventure_seeker', label: 'Adventure Seeker', emoji: '🥾' },
  { key: 'best_planner', label: 'Best Planner', emoji: '🗓️' },
  { key: 'comic_relief', label: 'Comic Relief', emoji: '😂' },
  { key: 'early_bird', label: 'Early Bird', emoji: '🌅' },
  { key: 'last_ready', label: 'Last Ready', emoji: '⏰' },
] as const;

export type AwardResult = {
  key: string;
  label: string;
  emoji: string;
  /** Votes cast for this award. */
  total: number;
  /** Most votes anyone has. */
  top: number;
  /** Everyone with the most votes (more than one is a tie); empty with no votes. */
  leaders: string[];
  counts: Record<string, number>;
};

/** Votes per award, and who's ahead. `order` (member ids) keeps ties in a stable order. */
export function awardResults(votes: { award_key: string; nominee_id: string }[], order: string[] = []): AwardResult[] {
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  return AWARDS.map((a) => {
    const counts: Record<string, number> = {};
    for (const v of votes) if (v.award_key === a.key) counts[v.nominee_id] = (counts[v.nominee_id] ?? 0) + 1;
    const top = Math.max(0, ...Object.values(counts));
    const leaders = top ? Object.keys(counts).filter((id) => counts[id] === top).sort((x, y) => rank(x) - rank(y) || x.localeCompare(y)) : [];
    return { key: a.key, label: a.label, emoji: a.emoji, total: Object.values(counts).reduce((s, n) => s + n, 0), top, leaders, counts };
  });
}

const votesWord = (n: number) => `${n} ${n === 1 ? 'vote' : 'votes'}`;

/** "Winner: Ana · 3 votes", "Leading: …", "Tie: Ana & Ben · 2 votes each", or "No votes yet". */
export function awardHeadline(r: AwardResult, over: boolean, nameOf: (id: string) => string): string {
  if (!r.leaders.length) return 'No votes yet';
  if (r.leaders.length === 1) return `${over ? 'Winner' : 'Leading'}: ${nameOf(r.leaders[0])} · ${votesWord(r.top)}`;
  const names = r.leaders.map(nameOf);
  const list = names.length === 2 ? names.join(' & ') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  return `Tie: ${list} · ${votesWord(r.top)} each`;
}

// ---------------------------------------------------------------- soundtrack

const LINK = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/\S*)?$/;

/**
 * A song link as typed, made safe to store and open: https only (http is
 * upgraded, a bare "open.spotify.com/…" gets https://). Empty is fine.
 */
export function cleanMusicLink(input: string): { url: string | null; error: string | null } {
  let s = input.trim();
  if (!s) return { url: null, error: null };
  if (/^http:\/\//i.test(s)) s = `https://${s.slice(7)}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  if (s.length > 500 || !LINK.test(s) || !/^https:\/\/[^/]*\.[^/]/.test(s)) {
    return { url: null, error: 'That doesn’t look like a web link. Paste the song’s share link (https://…).' };
  }
  return { url: s, error: null };
}

/** "open.spotify.com" from a link, for showing where it goes. */
export function linkHost(url: string): string {
  const m = /^https?:\/\/([^/:?#]+)/i.exec(url);
  return m ? m[1].replace(/^www\./i, '') : url;
}

// ---------------------------------------------------------------- food

export const FOOD_KINDS: { value: FoodKind; label: string; emoji: string }[] = [
  { value: 'dish', label: 'Dish', emoji: '🍽️' },
  { value: 'restaurant', label: 'Restaurant', emoji: '🏮' },
  { value: 'experience', label: 'Experience', emoji: '🧑‍🍳' },
];

export const foodEmoji = (kind: FoodKind | null) => FOOD_KINDS.find((k) => k.value === (kind ?? 'dish'))?.emoji ?? '🍽️';

// ---------------------------------------------------------------- dates

const pad = (n: number) => String(n).padStart(2, '0');

/** The local day and time ("2026-11-14", "18:05") of a timestamp. */
export function localDayTime(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** "Friday 14 November" (adds the year when it isn't this year). */
export function dayHeading(day: string, now = new Date()): string {
  const d = new Date(`${day}T12:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function daysInclusive(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

// ---------------------------------------------------------------- timeline

export type TimelineKind = 'start' | 'end' | 'plan' | 'post' | 'memory' | 'food' | 'song' | 'mission' | 'checklist';
export type TimelineFilter = 'all' | 'plans' | 'posts' | 'memories' | 'food' | 'songs';

export type TimelineItem = {
  key: string;
  kind: TimelineKind;
  day: string;
  /** "HH:MM", or null for things that only have a day. */
  time: string | null;
  emoji: string;
  title: string;
  detail: string | null;
  /** Who did it (a user id), when that matters. */
  by: string | null;
  photo: string | null;
  /** The id to open (a plan stop, post, memory or activity). */
  ref: string | null;
};

export type TimelineDay = { day: string; items: TimelineItem[] };

/** Feed events worth keeping in the story (the rest repeat plans, bills or ideas shown elsewhere). */
const STORY_EVENTS = new Set(['trip_started', 'member_joined', 'place_pinned', 'challenge_started']);

const FILTER_KINDS: Record<TimelineFilter, TimelineKind[] | null> = {
  all: null,
  plans: ['start', 'end', 'plan'],
  posts: ['post'],
  memories: ['memory'],
  food: ['food'],
  songs: ['song'],
};

/**
 * Everything that happened on the trip, oldest first, a day at a time: the
 * trip's dates, plan stops, posts and photos, scrapbook memories, food finds,
 * songs, and missions or checklist items (when the person can see them).
 */
export function buildTimeline(
  input: {
    trip: Pick<Trip, 'starts_on' | 'ends_on'> | null;
    plans: ItineraryItem[];
    posts: FeedPost[];
    entries: FunEntry[];
    memories: TripMemory[];
    challenges?: Challenge[];
    eventLabel?: (post: FeedPost) => string;
  },
  filter: TimelineFilter = 'all',
): TimelineDay[] {
  const items: TimelineItem[] = [];
  const { trip } = input;
  if (trip?.starts_on) items.push({ key: 'start', kind: 'start', day: trip.starts_on, time: '00:00', emoji: '🛫', title: 'The trip begins', detail: null, by: null, photo: null, ref: null });
  if (trip?.ends_on) items.push({ key: 'end', kind: 'end', day: trip.ends_on, time: '23:59', emoji: '🏁', title: 'Last day of the trip', detail: null, by: null, photo: null, ref: null });

  for (const p of input.plans) {
    items.push({
      key: `plan:${p.id}`,
      kind: 'plan',
      day: p.day,
      time: p.starts_at ? p.starts_at.slice(0, 5) : null,
      emoji: '🗓️',
      title: p.title,
      detail: [p.starts_at ? p.starts_at.slice(0, 5) : null, p.place_name].filter(Boolean).join(' · ') || null,
      by: null,
      photo: null,
      ref: p.id,
    });
  }

  for (const p of input.posts) {
    if (p.kind === 'event' && !STORY_EVENTS.has(p.event?.type ?? '')) continue;
    const { day, time } = localDayTime(p.created_at);
    const event = p.kind === 'event';
    items.push({
      key: `post:${p.id}`,
      kind: 'post',
      day,
      time,
      emoji: event ? '✨' : p.kind === 'photos' ? '📸' : p.kind === 'place' ? '📍' : p.kind === 'announcement' ? '📣' : '💬',
      title: event
        ? input.eventLabel?.(p) ?? p.event?.label ?? 'Trip update'
        : p.kind === 'photos'
          ? p.body || `${p.post_photos.length} ${p.post_photos.length === 1 ? 'photo' : 'photos'}`
          : p.kind === 'place'
            ? p.place_name ?? 'A find'
            : p.body ?? '',
      detail: p.kind === 'place' ? p.body : null,
      by: event ? null : p.author_id,
      photo: [...p.post_photos].sort((a, b) => a.position - b.position)[0]?.path ?? null,
      ref: p.id,
    });
  }

  for (const m of input.memories) {
    const created = localDayTime(m.created_at);
    items.push({
      key: `memory:${m.id}`,
      kind: 'memory',
      day: m.happened_on,
      time: created.day === m.happened_on ? created.time : null,
      emoji: '📔',
      title: m.caption,
      detail: m.description,
      by: m.created_by,
      photo: m.photo_paths[0] ?? null,
      ref: m.id,
    });
  }

  for (const e of input.entries) {
    const { day, time } = localDayTime(e.created_at);
    const kind: TimelineKind = e.kind === 'food' ? 'food' : e.kind === 'soundtrack' ? 'song' : e.kind === 'mission' ? 'mission' : 'checklist';
    items.push({
      key: `fun:${e.id}`,
      kind,
      day,
      time,
      emoji: kind === 'food' ? foodEmoji(e.food_kind) : kind === 'song' ? '🎵' : kind === 'mission' ? '🤫' : '🧭',
      title: e.title,
      detail: [e.place_name, e.details || null].filter(Boolean).join(' · ') || null,
      by: e.created_by,
      photo: e.photo_path,
      ref: e.id,
    });
  }

  const only = FILTER_KINDS[filter];
  const shown = only ? items.filter((i) => only.includes(i.kind)) : items;
  // Within a day: timed things in time order, then the ones with only a day.
  const sortKey = (i: TimelineItem) => `${i.day}T${i.time ?? '23:58'}`;
  shown.sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.key.localeCompare(b.key));

  const days: TimelineDay[] = [];
  for (const item of shown) {
    const last = days[days.length - 1];
    if (last?.day === item.day) last.items.push(item);
    else days.push({ day: item.day, items: [item] });
  }
  return days;
}

// ---------------------------------------------------------------- scrapbook

export type ScrapbookEntry = {
  key: string;
  source: 'memory' | 'post' | 'food';
  day: string;
  caption: string | null;
  description: string | null;
  photos: string[];
  by: string | null;
  ref: string;
  /** Sort order within a day. */
  at: string;
};

export type ScrapbookDay = { day: string; entries: ScrapbookEntry[] };

/** The scrapbook: memories, photo posts and food photos, grouped by day (oldest first). */
export function scrapbookDays(memories: TripMemory[], posts: FeedPost[], entries: FunEntry[]): ScrapbookDay[] {
  const all: ScrapbookEntry[] = [];
  for (const m of memories) {
    all.push({ key: `memory:${m.id}`, source: 'memory', day: m.happened_on, caption: m.caption, description: m.description, photos: m.photo_paths, by: m.created_by, ref: m.id, at: m.created_at });
  }
  for (const p of posts) {
    if (p.kind === 'event' || !p.post_photos.length) continue;
    all.push({
      key: `post:${p.id}`,
      source: 'post',
      day: localDayTime(p.created_at).day,
      caption: p.body || (p.kind === 'place' ? p.place_name : null),
      description: null,
      photos: [...p.post_photos].sort((a, b) => a.position - b.position).map((ph) => ph.path),
      by: p.author_id,
      ref: p.id,
      at: p.created_at,
    });
  }
  for (const e of entries) {
    if (e.kind !== 'food' || !e.photo_path) continue;
    all.push({
      key: `food:${e.id}`,
      source: 'food',
      day: localDayTime(e.created_at).day,
      caption: `${foodEmoji(e.food_kind)} ${e.title}`,
      description: [e.place_name, e.details || null].filter(Boolean).join(' · ') || null,
      photos: [e.photo_path],
      by: e.created_by,
      ref: e.id,
      at: e.created_at,
    });
  }
  all.sort((a, b) => a.day.localeCompare(b.day) || a.at.localeCompare(b.at));
  const days: ScrapbookDay[] = [];
  for (const e of all) {
    const last = days[days.length - 1];
    if (last?.day === e.day) last.entries.push(e);
    else days.push({ day: e.day, entries: [e] });
  }
  return days;
}

// ---------------------------------------------------------------- passport

/** 🇵🇹 from "PT"; 🌍 when there's no code. */
export function flagEmoji(code: string | null | undefined): string {
  const c = (code ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '🌍';
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** "Lisbon, Portugal" → Lisbon in Portugal; a single name is the place. */
export function splitDestination(destination: string): { place: string; country: string | null } {
  const parts = destination.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return { place: parts[0] ?? destination.trim(), country: null };
  return { place: parts[0], country: parts[parts.length - 1] };
}

export const WORLD_COUNTRIES = 195;

export type PassportStats = { countries: number; places: number; trips: number; daysAway: number };

/** Countries and places from your stamps; trips and days away from finished trips you were on (or stamped). */
export function passportStats(stamps: PassportStamp[], pastTrips: Pick<Trip, 'id' | 'starts_on' | 'ends_on'>[]): PassportStats {
  const countries = new Set(stamps.map((s) => s.country_code ?? s.country?.trim().toLowerCase() ?? null).filter((x): x is string => !!x));
  const places = new Set(stamps.map((s) => `${s.place.trim().toLowerCase()}|${s.country_code ?? s.country?.trim().toLowerCase() ?? ''}`));
  const tripIds = new Set([...pastTrips.map((t) => t.id), ...stamps.map((s) => s.trip_id).filter((x): x is string => !!x)]);
  const daysAway = pastTrips.reduce((sum, t) => sum + (t.starts_on && t.ends_on ? Math.max(1, daysInclusive(t.starts_on, t.ends_on)) : 0), 0);
  return { countries: countries.size, places: places.size, trips: tripIds.size, daysAway };
}

export type Milestone = { key: string; emoji: string; title: string; target: number; measure: keyof PassportStats };

export const MILESTONES: Milestone[] = [
  { key: 'first_stamp', emoji: '🛂', title: 'First stamp', target: 1, measure: 'places' },
  { key: 'explorer', emoji: '🧭', title: 'Explorer: 3 countries', target: 3, measure: 'countries' },
  { key: 'city_hopper', emoji: '🏙️', title: 'City hopper: 10 places', target: 10, measure: 'places' },
  { key: 'frequent', emoji: '✈️', title: 'Frequent traveller: 5 trips', target: 5, measure: 'trips' },
  { key: 'globetrotter', emoji: '🌍', title: 'Globetrotter: 10 countries', target: 10, measure: 'countries' },
  { key: 'month_away', emoji: '🗓️', title: 'A month away: 30 days travelling', target: 30, measure: 'daysAway' },
  { key: 'world_class', emoji: '🏅', title: 'World class: 25 countries', target: 25, measure: 'countries' },
];

/** Each milestone, whether it's reached, and progress toward it (0–100). */
export function milestones(stats: PassportStats): (Milestone & { reached: boolean; progress: number; value: number })[] {
  return MILESTONES.map((m) => {
    const value = stats[m.measure];
    return { ...m, value, reached: value >= m.target, progress: Math.min(100, Math.round((value / m.target) * 100)) };
  });
}

/** The next milestone not yet reached (closest to done first), or null when all are. */
export function nextMilestone(stats: PassportStats) {
  const open = milestones(stats).filter((m) => !m.reached);
  return open.sort((a, b) => b.progress - a.progress)[0] ?? null;
}

/** Finished or ongoing trips with a destination that aren't in the passport yet. */
export function tripsToStamp<T extends Pick<Trip, 'id' | 'destination'>>(trips: T[], stamps: PassportStamp[]): T[] {
  const stamped = new Set(stamps.map((s) => s.trip_id).filter(Boolean));
  return trips.filter((t) => !!t.destination?.trim() && !stamped.has(t.id));
}
