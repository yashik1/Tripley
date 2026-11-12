import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { config, isConfigured } from '@/config';
import { sessionStorage } from '@/lib/session-storage';

export const supabase = createClient(
  isConfigured ? config.supabaseUrl : 'https://not-configured.supabase.co',
  isConfigured ? config.supabaseAnonKey : 'not-configured',
  {
    auth: {
      // Phones: secure storage (src/lib/session-storage.ts). Web: local storage.
      storage: sessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
      flowType: 'pkce',
    },
  },
);

// Keep the session fresh only while the app is in the foreground (native).
if (Platform.OS !== 'web' && isConfigured) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}
