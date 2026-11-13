/**
 * Tripley's colours, with no React or React Native imports (so they can be
 * tested on their own): the light and dark base colours and the palettes.
 */

// Travel palette: warm off-white, deep ink text, teal as the brand colour with
// coral and sunny yellow accents. Buttons use the deep teal so white text on
// them stays readable (WCAG AA); the brighter teal is for accents and progress.
export const light = {
  scheme: 'light' as 'light' | 'dark',
  bg: '#F7F8F5',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF2EF',
  border: '#E5EBE8',
  text: '#172B3A',
  textMuted: '#5F707B',
  textFaint: '#6C7B85',
  primary: '#117C78',
  primaryPressed: '#0D6663',
  primaryText: '#FFFFFF',
  primarySoft: '#E6F5F2',
  accent: '#18A999',
  coral: '#FF806E',
  coralText: '#B4422F',
  coralSoft: '#FFE8E3',
  yellow: '#F5C451',
  yellowText: '#8A6206',
  yellowSoft: '#FDF3D7',
  sky: '#4C8DF6',
  skySoft: '#E3EEFF',
  danger: '#C93B3B',
  dangerSoft: '#FBE7E7',
  success: '#1F8A4C',
  successSoft: '#E1F4E8',
  warning: '#A36A0F',
  warningSoft: '#FCF1DC',
  overlay: 'rgba(23,43,58,0.45)',
  /** Soft elevation for cards (CSS box-shadow syntax, supported on iOS, Android and web). */
  shadow: '0px 1px 2px rgba(23,43,58,0.05), 0px 6px 16px rgba(23,43,58,0.06)',
  shadowRaised: '0px 2px 4px rgba(23,43,58,0.06), 0px 12px 28px rgba(23,43,58,0.10)',
};

export const dark: typeof light = {
  scheme: 'dark',
  bg: '#0E181D',
  surface: '#152329',
  surfaceAlt: '#1D2F36',
  border: '#27393F',
  text: '#EEF3F2',
  textMuted: '#A2B2B7',
  textFaint: '#7D8E94',
  primary: '#2EC4B2',
  primaryPressed: '#25A999',
  primaryText: '#03201D',
  primarySoft: '#123B37',
  accent: '#2EC4B2',
  coral: '#FF8F7E',
  coralText: '#FFAB9E',
  coralSoft: '#3D2420',
  yellow: '#F5C451',
  yellowText: '#F5C451',
  yellowSoft: '#3A3118',
  sky: '#7AABFF',
  skySoft: '#1B2B45',
  danger: '#EF6B6B',
  dangerSoft: '#3A1D1D',
  success: '#4CC27D',
  successSoft: '#163323',
  warning: '#E3A43A',
  warningSoft: '#3A2D15',
  overlay: 'rgba(0,0,0,0.6)',
  shadow: '0px 1px 2px rgba(0,0,0,0.35)',
  shadowRaised: '0px 6px 20px rgba(0,0,0,0.45)',
};

/** Brand colours for places with no theme (map markers, app icon, manifest). */
export const brand = { teal: '#117C78', brightTeal: '#18A999', coral: '#FF806E', yellow: '#F5C451', ink: '#172B3A' };

export type Theme = typeof light;

// ------------------------------------------------------------------ palettes

/**
 * Colour palettes: the brand colour for buttons, links, highlights and
 * progress. Everything else (backgrounds, text, coral, yellow, sky) stays the
 * same. Every palette passes WCAG AA in light and dark (tests/unit/theme.test.ts).
 */
export type PaletteKey = 'teal' | 'ocean' | 'sunset' | 'forest' | 'lavender' | 'midnight' | 'berry';
type Accent = Pick<Theme, 'primary' | 'primaryPressed' | 'primaryText' | 'primarySoft' | 'accent'>;
const accent = (primary: string, primaryPressed: string, primaryText: string, primarySoft: string, accentColour: string): Accent => ({
  primary,
  primaryPressed,
  primaryText,
  primarySoft,
  accent: accentColour,
});

export const PALETTES: Record<PaletteKey, { label: string; light: Accent; dark: Accent }> = {
  teal: { label: 'Teal', light: accent('#117C78', '#0D6663', '#FFFFFF', '#E6F5F2', '#18A999'), dark: accent('#2EC4B2', '#25A999', '#03201D', '#123B37', '#2EC4B2') },
  ocean: { label: 'Ocean', light: accent('#1D5FBF', '#174D9C', '#FFFFFF', '#E6EEFB', '#3B82F6'), dark: accent('#6AA8FF', '#4F8FEF', '#04162E', '#15294A', '#6AA8FF') },
  sunset: { label: 'Sunset', light: accent('#B9420E', '#97350B', '#FFFFFF', '#FDEDE2', '#F97316'), dark: accent('#FF9A5C', '#F07F3C', '#2A1204', '#3D2414', '#FF9A5C') },
  forest: { label: 'Forest', light: accent('#2E7533', '#245C28', '#FFFFFF', '#E7F3E7', '#43A047'), dark: accent('#6CCB74', '#52B35B', '#062008', '#173322', '#6CCB74') },
  lavender: { label: 'Lavender', light: accent('#6A4BC4', '#563AA6', '#FFFFFF', '#EFEAFC', '#8B6FE0'), dark: accent('#B49CFF', '#9C82F2', '#1A1033', '#2A2247', '#B49CFF') },
  midnight: { label: 'Midnight', light: accent('#2F3E9E', '#25317F', '#FFFFFF', '#E8EAF7', '#5C6BC0'), dark: accent('#8C9EFF', '#7486F0', '#0B1033', '#1C2347', '#8C9EFF') },
  berry: { label: 'Berry', light: accent('#B0245F', '#8F1D4D', '#FFFFFF', '#FCE8F1', '#EC4899'), dark: accent('#FF7AB6', '#F0609F', '#2E0618', '#3D1A2B', '#FF7AB6') },
};
export const PALETTE_KEYS = Object.keys(PALETTES) as PaletteKey[];
export const isPaletteKey = (v: unknown): v is PaletteKey => typeof v === 'string' && Object.prototype.hasOwnProperty.call(PALETTES, v);

export type AppearancePref = 'system' | 'light' | 'dark';
export const isAppearancePref = (v: unknown): v is AppearancePref => v === 'system' || v === 'light' || v === 'dark';

const built = new Map<string, Theme>();
/** The full set of colours for a scheme and palette (the same object each time, so it's safe in hook deps). */
export function buildTheme(scheme: 'light' | 'dark', palette: PaletteKey = 'teal'): Theme {
  const key = `${scheme}:${palette}`;
  let theme = built.get(key);
  if (!theme) {
    theme = { ...(scheme === 'dark' ? dark : light), ...PALETTES[palette][scheme] };
    built.set(key, theme);
  }
  return theme;
}

