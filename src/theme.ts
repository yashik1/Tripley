import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

import { buildTheme, type AppearancePref, type PaletteKey, type Theme } from './lib/palettes';

export {
  brand,
  buildTheme,
  isAppearancePref,
  isPaletteKey,
  PALETTE_KEYS,
  PALETTES,
  type AppearancePref,
  type PaletteKey,
  type Theme,
} from './lib/palettes';

// ------------------------------------------------------------------ preferences

export type ThemePrefs = {
  appearance: AppearancePref;
  palette: PaletteKey;
  setAppearance: (appearance: AppearancePref) => void;
  setPalette: (palette: PaletteKey) => void;
  /** Set when saving to your account failed (the change still applies on this device). */
  saveError: string | null;
};
export const DEFAULT_PREFS = { appearance: 'system' as AppearancePref, palette: 'teal' as PaletteKey };

/** Your appearance and colour (src/providers/ThemePrefsProvider.tsx fills this in). */
export const ThemePrefsContext = createContext<ThemePrefs>({ ...DEFAULT_PREFS, setAppearance: () => undefined, setPalette: () => undefined, saveError: null });
/** Inside a trip that has a theme: the trip's palette, which replaces yours there. */
export const TripPaletteContext = createContext<PaletteKey | null>(null);

export const useThemePrefs = () => useContext(ThemePrefsContext);

/** Light or dark: your choice, or the device's when you chose System. */
export function useResolvedScheme(): 'light' | 'dark' {
  const system = useColorScheme();
  const { appearance } = useContext(ThemePrefsContext);
  if (appearance !== 'system') return appearance;
  return system === 'dark' ? 'dark' : 'light';
}

export function useTheme(): Theme {
  const scheme = useResolvedScheme();
  const { palette } = useContext(ThemePrefsContext);
  const tripPalette = useContext(TripPaletteContext);
  return buildTheme(scheme, tripPalette ?? palette);
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 };

const AVATAR_COLORS = ['#117C78', '#3B6FD8', '#D9583F', '#8B5CF6', '#B7791F', '#D63A7A', '#0891B2', '#4D7C0F'];

/** Stable color per person for avatars and map dots. */
export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
