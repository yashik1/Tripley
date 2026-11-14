import { describe, expect, it } from 'vitest';

import { BACKDROP_TINT, dark, light, SHEET_TINT } from '../../src/lib/palettes';

const lum = (hex: string) =>
  [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** The page colour laid over a photo colour at `alpha`. */
const over = (page: string, photo: string, alpha: number) =>
  `#${[1, 3, 5]
    .map((i) => Math.round(alpha * parseInt(page.slice(i, i + 2), 16) + (1 - alpha) * parseInt(photo.slice(i, i + 2), 16)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`;

// Average colours of real photos once blurred: sky, sea, sand, city, forest, night, snow, sunset.
const PHOTOS = ['#87A9C8', '#2E6E9E', '#C9B48A', '#8C7A6B', '#4E6B45', '#2B3340', '#E6EEF5', '#D9825B'];

describe('trip photo as the page background', () => {
  for (const [scheme, t] of [['light', light], ['dark', dark]] as const) {
    it(`${scheme}: text on the content column stays readable (WCAG AA) over any photo`, () => {
      const covered = 1 - (1 - BACKDROP_TINT[scheme]) * (1 - SHEET_TINT[scheme]);
      for (const photo of PHOTOS) {
        const page = over(t.bg, photo, covered);
        expect(contrast(t.textMuted, page), `muted text over ${photo}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.text, page), `text over ${photo}`).toBeGreaterThanOrEqual(7);
      }
    });
  }

  it('the photo really shows: in the margins, and as a tint behind dark-mode text', () => {
    expect(1 - BACKDROP_TINT.light).toBeGreaterThanOrEqual(0.5);
    expect(1 - BACKDROP_TINT.dark).toBeGreaterThanOrEqual(0.5);
    expect((1 - BACKDROP_TINT.dark) * (1 - SHEET_TINT.dark)).toBeGreaterThanOrEqual(0.15);
  });
});
