// Defines the background location task as early as possible (native only).
import '@/location/task';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Loading } from '@/components/ui';
import { isConfigured } from '@/config';
import { useNotificationsRealtime } from '@/lib/queries';
import { configureNotificationHandling, registerForPush } from '@/notifications/push';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { SharingProvider } from '@/providers/SharingProvider';
import { setupPurchases } from '@/purchases/purchases';
import { useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 20_000, retry: 1 } },
});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppNavigator />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function SignedInServices({ userId, children }: { userId: string; children: ReactNode }) {
  useNotificationsRealtime(userId);
  useEffect(() => {
    registerForPush().catch(() => undefined);
    setupPurchases(userId).catch(() => undefined);
    return configureNotificationHandling((data) => {
      const tripId = typeof data.trip_id === 'string' ? data.trip_id : null;
      const kind = typeof data.kind === 'string' ? data.kind : '';
      if (kind === 'invitation') router.push('/');
      else if (tripId && kind.startsWith('settlement')) router.push(`/trip/${tripId}/balances`);
      else if (tripId && kind.startsWith('bill')) router.push(`/trip/${tripId}/bills`);
      else if (tripId) router.push(`/trip/${tripId}/map`);
    });
  }, [userId]);
  return <SharingProvider userId={userId}>{children}</SharingProvider>;
}

function AppNavigator() {
  const { ready, session, profile, profileLoading } = useAuth();
  const t = useTheme();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  const signedIn = !!session;
  const needsName = signedIn && !!profile && !profile.display_name.trim();
  const navTheme = t.scheme === 'dark' ? DarkTheme : DefaultTheme;

  if (!ready || (signedIn && profileLoading)) return <Loading />;

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
      <Stack.Protected guard={!isConfigured}>
        <Stack.Screen name="setup" options={{ title: 'Set up Tripley' }} />
      </Stack.Protected>
      <Stack.Protected guard={isConfigured && !signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="verify" options={{ title: 'Enter your code' }} />
      </Stack.Protected>
      <Stack.Protected guard={needsName}>
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !needsName}>
        <Stack.Screen name="index" options={{ title: 'Tripley' }} />
        <Stack.Screen name="trips/new" options={{ title: 'New trip', presentation: 'modal' }} />
        <Stack.Screen name="trip/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ title: 'Profile' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="pro" options={{ title: 'Tripley Pro', presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Screen name="join/[code]" options={{ title: 'Join trip' }} />
      <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
    </Stack>
  );

  return (
    <ThemeProvider value={{ ...navTheme, colors: { ...navTheme.colors, background: t.bg, card: t.surface, primary: t.primary } }}>
      {signedIn ? <SignedInServices userId={session!.user.id}>{stack}</SignedInServices> : stack}
    </ThemeProvider>
  );
}
