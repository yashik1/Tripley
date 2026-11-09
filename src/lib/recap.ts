/**
 * The shareable trip recap. Only the sections the person ticked are included;
 * it never contains anyone's location history or what each person paid or
 * owes (at most the group total, and only if chosen). Photos stay private.
 */
export type RecapSection = 'dates' | 'people' | 'highlights' | 'places' | 'decisions' | 'stats' | 'spend';

export type RecapData = {
  name: string;
  destination: string | null;
  dates: string | null;
  days: number | null;
  people: string[];
  highlights: string[];
  places: string[];
  decisions: { question: string; winner: string }[];
  photoCount: number;
  postCount: number;
  totalSpent: string | null;
};

export const DEFAULT_SECTIONS: RecapSection[] = ['dates', 'people', 'highlights', 'places', 'decisions', 'stats'];

export function recapText(d: RecapData, include: RecapSection[]): string {
  const on = new Set(include);
  const lines: string[] = [`✈️ ${d.name}${d.destination ? ` · ${d.destination}` : ''}`];
  if (on.has('dates') && d.dates) lines.push(`🗓️ ${d.dates}${d.days ? ` (${d.days} ${d.days === 1 ? 'day' : 'days'})` : ''}`);
  if (on.has('people') && d.people.length) lines.push(`👥 ${d.people.join(', ')}`);
  if (on.has('highlights') && d.highlights.length) lines.push('', '⭐ Highlights', ...d.highlights.map((h) => `• ${h}`));
  if (on.has('places') && d.places.length) lines.push('', '📍 Places we loved', ...d.places.map((p) => `• ${p}`));
  if (on.has('decisions') && d.decisions.length) lines.push('', '🗳️ The group decided', ...d.decisions.map((x) => `• ${x.question} → ${x.winner}`));
  if (on.has('stats') && (d.photoCount || d.postCount)) lines.push('', `📸 ${d.photoCount} photos and ${d.postCount} posts shared`);
  if (on.has('spend') && d.totalSpent) lines.push(`💸 ${d.totalSpent} spent together`);
  lines.push('', 'Planned together with Tripley');
  return lines.join('\n');
}
