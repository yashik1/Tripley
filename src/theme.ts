import { useColorScheme } from 'react-native';

const light = {
  scheme: 'light' as 'light' | 'dark',
  bg: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF1F4',
  border: '#E2E6EA',
  text: '#111418',
  textMuted: '#5B6470',
  textFaint: '#8A939E',
  primary: '#0E7C66',
  primaryPressed: '#0B6754',
  primaryText: '#FFFFFF',
  primarySoft: '#DDF2EC',
  danger: '#C93B3B',
  dangerSoft: '#FBE7E7',
  success: '#1F8A4C',
  successSoft: '#E1F4E8',
  warning: '#A36A0F',
  warningSoft: '#FCF1DC',
  overlay: 'rgba(17,20,24,0.45)',
};

const dark: typeof light = {
  scheme: 'dark',
  bg: '#0E1114',
  surface: '#171B20',
  surfaceAlt: '#21262D',
  border: '#2B3138',
  text: '#F2F4F6',
  textMuted: '#A3ACB7',
  textFaint: '#76808B',
  primary: '#2BB08F',
  primaryPressed: '#239A7C',
  primaryText: '#04140F',
  primarySoft: '#123A31',
  danger: '#EF6B6B',
  dangerSoft: '#3A1D1D',
  success: '#4CC27D',
  successSoft: '#163323',
  warning: '#E3A43A',
  warningSoft: '#3A2D15',
  overlay: 'rgba(0,0,0,0.6)',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

const AVATAR_COLORS = ['#0E7C66', '#3B6FD8', '#C2410C', '#8B5CF6', '#B45309', '#DB2777', '#0891B2', '#4D7C0F'];

/** Stable color per person for avatars and map dots. */
export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
