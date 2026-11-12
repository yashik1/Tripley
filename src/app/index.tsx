import { useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack as RouterStack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { Dashboard } from '@/components/Dashboard';
import { Landing } from '@/components/Landing';
import { Loading } from '@/components/ui';
import { isConfigured } from '@/config';
import { claimReferral } from '@/lib/api';
import { isReferralCode, setPendingReferral, takePendingReferral } from '@/lib/pending-referral';
import { keys } from '@/lib/queries';
import { useAuth } from '@/providers/AuthProvider';

/** "/" is the public home page when signed out, and your trips when signed in. */
export default function Home() {
  const { session, profile, profileLoading } = useAuth();
  const { ref } = useLocalSearchParams<{ ref?: string }>();
  const qc = useQueryClient();
  // A friend's invite link (/?ref=CODE): remember it, and use it once signed in.
  useEffect(() => {
    if (isReferralCode(ref)) setPendingReferral(ref).catch(() => undefined);
  }, [ref]);
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    takePendingReferral()
      .then((code) => (code ? claimReferral(code).then(() => qc.invalidateQueries({ queryKey: keys.account })) : undefined))
      .catch(() => undefined);
  }, [userId, qc]);
  if (!isConfigured) return <Redirect href="/setup" />;
  if (!session) {
    return (
      <>
        <RouterStack.Screen options={{ headerShown: false, title: 'Tripley' }} />
        <Landing />
      </>
    );
  }
  if (profileLoading) return <Loading />;
  if (profile && !profile.display_name.trim()) return <Redirect href="/welcome" />;
  return <Dashboard />;
}

