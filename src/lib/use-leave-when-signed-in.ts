import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { useAuth } from '@/providers/AuthProvider';

/**
 * For log in / sign up screens: once signed in, go back to where you came from
 * (the home page, or the invite you opened), or home if there's nothing to go
 * back to. Going back, rather than replacing this screen with "/", avoids a
 * second home page in the history.
 */
export function useLeaveWhenSignedIn() {
  const { session } = useAuth();
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      if (router.canGoBack()) router.back();
      else router.replace('/');
    }, [session]),
  );
}
