import { Redirect, Stack as RouterStack } from 'expo-router';

import { Dashboard } from '@/components/Dashboard';
import { Landing } from '@/components/Landing';
import { Loading } from '@/components/ui';
import { isConfigured } from '@/config';
import { useAuth } from '@/providers/AuthProvider';

/** "/" is the public home page when signed out, and your trips when signed in. */
export default function Home() {
  const { session, profile, profileLoading } = useAuth();
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

