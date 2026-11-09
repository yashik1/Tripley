import { useColorScheme } from 'react-native';

// Travel palette: warm off-white, deep ink text, teal as the brand colour with
// coral and sunny yellow accents. Buttons use the deep teal so white text on
// them stays readable (WCAG AA); the brighter teal is for accents and progress.
const light = {
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

const dark: typeof light = {
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

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
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
