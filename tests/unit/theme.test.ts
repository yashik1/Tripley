import { describe, expect, it } from 'vitest';

import { buildTheme, dark, isAppearancePref, isPaletteKey, light, PALETTE_KEYS, PALETTES } from '../../src/lib/palettes';

/** WCAG 2 contrast ratio between two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255]
      .map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('colour palettes', () => {
  it('Teal is exactly today’s colours, so nothing changes for anyone who doesn’t choose', () => {
    expect(buildTheme('light', 'teal')).toMatchObject({ primary: '#117C78', primaryPressed: '#0D6663', primarySoft: '#E6F5F2', accent: '#18A999', bg: light.bg });
    expect(buildTheme('dark', 'teal')).toMatchObject({ primary: '#2EC4B2', primaryText: '#03201D', primarySoft: '#123B37', bg: dark.bg });
    expect(buildTheme('light')).toBe(buildTheme('light', 'teal'));
  });

  it('only the brand colours change between palettes', () => {
    const a = buildTheme('dark', 'ocean');
    const b = buildTheme('dark', 'berry');
    for (const k of ['bg', 'surface', 'text', 'textMuted', 'coral', 'yellow', 'danger', 'success'] as const) expect(a[k]).toBe(b[k]);
    expect(a.primary).not.toBe(b.primary);
  });

  for (const key of PALETTE_KEYS) {
    for (const scheme of ['light', 'dark'] as const) {
      it(`${PALETTES[key].label} (${scheme}) passes WCAG AA`, () => {
        const t = buildTheme(scheme, key);
        expect(contrast(t.primaryText, t.primary), 'button text on the button').toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.primaryText, t.primaryPressed), 'button text when pressed').toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.primary, t.bg), 'brand colour on the background').toBeGreaterThanOrEqual(3);
        expect(contrast(t.primary, t.surface), 'brand colour on cards').toBeGreaterThanOrEqual(3);
        expect(contrast(t.text, t.primarySoft), 'body text on soft tints').toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.primary, t.primarySoft), 'brand text on soft tints').toBeGreaterThanOrEqual(3);
      });
    }
  }

  it('recognises saved values, and nothing else', () => {
    expect(PALETTE_KEYS).toEqual(['teal', 'ocean', 'sunset', 'forest', 'lavender', 'midnight', 'berry']);
    expect(isPaletteKey('ocean')).toBe(true);
    expect(isPaletteKey('toString')).toBe(false);
    expect(isPaletteKey('rainbow')).toBe(false);
    expect(isAppearancePref('dark')).toBe(true);
    expect(isAppearancePref('auto')).toBe(false);
  });
});
