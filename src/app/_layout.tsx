// Defines the background location task as early as possible (native only).
import '@/location/task';

import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Loading } from '@/components/ui';
import { isConfigured } from '@/config';
import { persistOptions } from '@/lib/device-data';
import { registerServiceWorker } from '@/lib/pwa';
import { useNotificationsRealtime } from '@/lib/queries';
import { useOutboxSync } from '@/lib/use-outbox-sync';
import { configureNotificationHandling, registerForPush } from '@/notifications/push';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { SharingProvider } from '@/providers/SharingProvider';
import { setupPurchases } from '@/purchases/purchases';
import { useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const DAY = 24 * 60 * 60 * 1000;
const queryClient = new QueryClient({
  // Keep data for a day in memory so the saved copy below has something to keep.
  defaultOptions: { queries: { staleTime: 20_000, retry: 1, gcTime: DAY } },
});

// A copy of trips, bills and balances is kept on the device so they still show
// without a connection. Live positions and notifications are never saved, and
// the copy is tied to one account (src/lib/device-data.ts, cache-policy.ts).

registerServiceWorker();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <AuthProvider>
          <AppNavigator />
        </AuthProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}

/**
 * Push, purchases, notifications and location sharing for the signed-in person.
 * Always mounted (with userId null when signed out) so signing in or out never
 * rebuilds the navigator underneath, which would drop the page you're on.
 */
function SignedInServices({ userId, children }: { userId: string | null; children: ReactNode }) {
  useNotificationsRealtime(userId ?? undefined);
  useOutboxSync(userId);
  useEffect(() => {
    if (!userId) return;
    registerForPush().catch(() => undefined);
    setupPurchases(userId).catch(() => undefined);
    return configureNotificationHandling((data) => {
      const tripId = typeof data.trip_id === 'string' ? data.trip_id : null;
      const kind = typeof data.kind === 'string' ? data.kind : '';
      if (kind === 'invitation') router.push('/');
      else if (tripId && (kind === 'kitty_holder' || typeof data.kitty_id === 'string')) router.push(`/trip/${tripId}/kitty`);
      else if (tripId && kind === 'itinerary_comment' && typeof data.item_id === 'string') router.push(`/trip/${tripId}/plan/${data.item_id}`);
      else if (tripId && kind.startsWith('post') && typeof data.post_id === 'string') router.push(`/trip/${tripId}/post/${data.post_id}`);
      else if (tripId && kind.startsWith('poll') && typeof data.poll_id === 'string') router.push(`/trip/${tripId}/poll/${data.poll_id}`);
      else if (tripId && kind.startsWith('settlement')) router.push(`/trip/${tripId}/balances`);
      else if (tripId && kind.startsWith('bill')) router.push(`/trip/${tripId}/bills`);
      else if (tripId) router.push(`/trip/${tripId}/overview`);
    });
  }, [userId]);
  return <SharingProvider userId={userId}>{children}</SharingProvider>;
}

function AppNavigator() {
  const { ready, session, profile } = useAuth();
  const t = useTheme();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  const signedIn = !!session;
  const needsName = signedIn && !!profile && !profile.display_name.trim();
  const navTheme = t.scheme === 'dark' ? DarkTheme : DefaultTheme;

  if (!ready) return <Loading />;

  const stack = (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTintColor: t.text,
        headerTitleStyle: { fontWeight: '600' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.bg },
        headerBackButtonDisplayMode: 'minimal',
      }}>
      <Stack.Protected guard={!isConfigured} redirectTo="/">
        <Stack.Screen name="setup" options={{ title: 'Set up Tripley' }} />
      </Stack.Protected>
      {/* Public home: the landing page when signed out, your trips when signed in. */}
      <Stack.Screen name="index" options={{ title: 'Tripley' }} />
      <Stack.Screen name="home" options={{ headerShown: false, title: 'Tripley' }} />
      {/* Log in / sign up screens go back by themselves once you're signed in (useLeaveWhenSignedIn). */}
      <Stack.Screen name="sign-in" options={{ headerShown: false, title: 'Log in' }} />
      <Stack.Screen name="sign-up" options={{ headerShown: false, title: 'Create your account' }} />
      <Stack.Screen name="forgot-password" options={{ headerShown: false, title: 'Reset your password' }} />
      <Stack.Screen name="verify" options={{ title: 'Enter your code' }} />
      <Stack.Protected guard={needsName} redirectTo="/">
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !needsName} redirectTo={!isConfigured ? '/setup' : !signedIn ? '/sign-in' : '/welcome'}>
        <Stack.Screen name="trips/new" options={{ title: 'New trip', presentation: 'modal' }} />
        <Stack.Screen name="trip/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ title: 'Profile' }} />
        <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
        <Stack.Screen name="battery-help" options={{ title: 'Keep sharing on' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="pro" options={{ title: 'Tripley Pro', presentation: 'modal' }} />
        <Stack.Screen name="explore" options={{ title: 'Explore ideas' }} />
      </Stack.Protected>
      <Stack.Screen name="join/index" options={{ title: 'Join a trip' }} />
      <Stack.Screen name="join/[code]" options={{ title: 'Join trip' }} />
      {/* Opened from the reset email, signed out; the link signs you in. */}
      <Stack.Screen name="reset-password" options={{ headerShown: false, title: 'Choose a new password' }} />
      <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
      {/* Public, signed in or out (app stores link to these). */}
      <Stack.Screen name="privacy" options={{ title: 'Privacy Policy' }} />
      <Stack.Screen name="terms" options={{ title: 'Terms of Use' }} />
      <Stack.Screen name="why-tripley" options={{ title: 'Why Tripley' }} />
    </Stack>
  );

  return (
    <ThemeProvider value={{ ...navTheme, colors: { ...navTheme.colors, background: t.bg, card: t.surface, primary: t.primary } }}>
      <SignedInServices userId={session?.user.id ?? null}>{stack}</SignedInServices>
    </ThemeProvider>
  );
}
