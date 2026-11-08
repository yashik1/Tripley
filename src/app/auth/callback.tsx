import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { Loading } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

/** Where Google / Apple sign-in returns to. */
export default function AuthCallback() {
  const { session } = useAuth();
  const { code } = useLocalSearchParams<{ code?: string }>();

  useEffect(() => {
    if (session) {
      router.replace('/');
      return;
    }
    // Web exchanges the code automatically (detectSessionInUrl). Native deep links may land here.
    if (code) supabase.auth.exchangeCodeForSession(code).catch(() => router.replace('/sign-in'));
    const t = setTimeout(() => router.replace('/'), 8000);
    return () => clearTimeout(t);
  }, [session, code]);

  return <Loading label="Signing you in…" />;
}
