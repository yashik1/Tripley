import { Stack } from 'expo-router';

import { Landing } from '@/components/Landing';

/** The home page (what Tripley is), reachable when signed in from the Tripley logo. */
export default function HomePage() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false, title: 'Tripley' }} />
      <Landing />
    </>
  );
}
