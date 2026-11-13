import { describe, expect, it } from 'vitest';

import { CATEGORIES } from '../../src/lib/group-decisions';
import { packingSuggestions } from '../../src/lib/packing';
import { isPaletteKey } from '../../src/lib/palettes';
import { isTripTheme, themeIdeas, themeInfo, TRIP_THEME_KEYS, TRIP_THEMES } from '../../src/lib/trip-themes';

describe('trip themes', () => {
  it('are the six the database accepts', () => {
    // Same list as the check constraint in 20261203000000_themes.sql.
    expect(TRIP_THEME_KEYS).toEqual(['beach', 'ski', 'city', 'road_trip', 'camping', 'celebration']);
    expect(isTripTheme('ski')).toBe(true);
    expect(isTripTheme('space')).toBe(false);
    expect(themeInfo(null)).toBeNull();
  });

  for (const t of TRIP_THEMES) {
    it(`${t.label}: a palette, and ideas for packing, the hunt and the bucket list`, () => {
      expect(isPaletteKey(t.palette)).toBe(true);
      expect(t.packing.length).toBeGreaterThanOrEqual(4);
      expect(t.challenges.length).toBeGreaterThanOrEqual(3);
      expect(t.ideas.length).toBeGreaterThanOrEqual(3);
      for (const i of t.ideas) expect(CATEGORIES.map((c) => c.key)).toContain(i.category);
      for (const list of [t.packing.map((p) => p.title), t.challenges.map((c) => c.title), t.ideas.map((i) => i.name)]) {
        expect(new Set(list.map((x) => x.toLowerCase())).size).toBe(list.length);
      }
      // Light-hearted and safe: no challenge asks people to share where they are or personal details.
      for (const c of t.challenges) expect(`${c.title} ${c.description}`).not.toMatch(/location|address|phone|share where/i);
      for (const c of t.challenges) expect(c.title.length).toBeLessThanOrEqual(120);
    });
  }

  it('each theme has its own colours', () => {
    expect(new Set(TRIP_THEMES.map((t) => t.palette)).size).toBe(TRIP_THEMES.length);
  });

  it('bucket-list starters skip what the group already suggested', () => {
    const names = themeIdeas('beach', ['  snorkelling ']).map((i) => i.name);
    expect(names).not.toContain('Snorkelling');
    expect(names).toContain('Sunset boat trip');
    expect(themeIdeas(null, [])).toEqual([]);
  });
});

describe('packing for a theme', () => {
  const base = { nights: 3, weather: null, bookingKinds: [] as string[] };

  it('adds the theme’s essentials, saying why', () => {
    const s = packingSuggestions({ ...base, existing: [], theme: 'beach' });
    expect(s).toContainEqual({ title: 'Swimwear', why: 'Beach trip' });
    expect(s).toContainEqual({ title: 'Sunscreen', why: 'Beach trip' });
  });

  it('skips anything already on the list, by any of its usual names', () => {
    const titles = packingSuggestions({ ...base, existing: ['Sun cream', 'Bikini'], theme: 'beach' }).map((x) => x.title);
    expect(titles).not.toContain('Sunscreen');
    expect(titles).not.toContain('Swimwear');
    expect(titles).toContain('Beach towel');
  });

  it('no theme, no theme items', () => {
    const titles = packingSuggestions({ ...base, existing: [], theme: null }).map((x) => x.title);
    expect(titles).not.toContain('Swimwear');
    expect(titles).not.toContain('Goggles');
  });

  it('weather and theme don’t repeat each other', () => {
    const s = packingSuggestions({ ...base, existing: [], theme: 'beach', weather: { minC: 22, maxC: 31, rainyDays: 0 } as never });
    expect(s.filter((x) => x.title === 'Sunscreen')).toHaveLength(1);
    expect(s.filter((x) => x.title === 'Sunglasses')).toHaveLength(1);
  });
});
