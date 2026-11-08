import Constants from 'expo-constants';

/** Runtime configuration from EXPO_PUBLIC_* environment variables (see .env.example). */
export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  appDomain: process.env.EXPO_PUBLIC_APP_DOMAIN || 'tripley.app',
  mapStyleUrl: process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty',
  revenueCat: {
    ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '',
    android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '',
    web: process.env.EXPO_PUBLIC_REVENUECAT_WEB_KEY ?? '',
  },
  easProjectId:
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
    Constants.easConfig?.projectId ??
    undefined,
};

export const isConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);

export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!config.supabaseUrl) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!config.supabaseAnonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  return missing;
}

/** Public link friends open to join a trip. */
export function inviteUrl(code: string): string {
  return `https://${config.appDomain}/join/${code}`;
}
