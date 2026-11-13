import { router, Stack, useLocalSearchParams } from 'expo-router';

import { IconButton, Row } from '@/components/ui';
import { useTrip, useTripRealtime } from '@/lib/queries';
import { TripIdContext } from '@/lib/trip-context';
import { themeInfo } from '@/lib/trip-themes';
import { space, TripPaletteContext, useTheme } from '@/theme';

// Deep links (notifications, /trip/x/invite) open on top of the trip tabs.
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function TripLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const trip = useTrip(id);
  useTripRealtime(id);

  // A trip with a theme uses that theme's colours on every trip screen.
  const tripPalette = themeInfo(trip.data?.theme)?.palette ?? null;

  return (
    <TripIdContext.Provider value={id}>
    <TripPaletteContext.Provider value={tripPalette}>
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTintColor: t.text,
        headerTitleStyle: { fontWeight: '600' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.bg },
        headerBackButtonDisplayMode: 'minimal',
      }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="(tabs)"
        options={{
          title: trip.data?.name ?? 'Trip',
          headerLeft: () => (
            <IconButton
              icon="back"
              label="All trips"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            />
          ),
          headerRight: () => (
            <Row gap={space.xs}>
              <IconButton icon="personAdd" label="Invite friends" onPress={() => router.push(`/trip/${id}/invite`)} />
              <IconButton icon="settings" label="Trip settings" onPress={() => router.push(`/trip/${id}/settings`)} />
            </Row>
          ),
        }}
      />
      <Stack.Screen name="bill/new" options={{ title: 'Add a bill', presentation: 'modal' }} />
      <Stack.Screen name="bill/[billId]" options={{ title: 'Bill' }} />
      <Stack.Screen name="invite" options={{ title: 'Invite friends', presentation: 'modal' }} />
      <Stack.Screen name="settle/[userId]" options={{ title: 'Settle up' }} />
      <Stack.Screen name="settings" options={{ title: 'Trip settings' }} />
      <Stack.Screen name="place/new" options={{ title: 'Pin a place', presentation: 'modal' }} />
      <Stack.Screen name="place/[placeId]" options={{ title: 'Place' }} />
      <Stack.Screen name="find/[userId]" options={{ title: 'Find a friend' }} />
      <Stack.Screen name="kitty" options={{ title: 'Cash kitty' }} />
      <Stack.Screen name="plan/new" options={{ title: 'Add to the plan', presentation: 'modal' }} />
      <Stack.Screen name="plan/[itemId]" options={{ title: 'Plan' }} />
      <Stack.Screen name="plan/draft" options={{ title: 'Draft the plan', presentation: 'modal' }} />
      <Stack.Screen name="post/new" options={{ title: 'New post', presentation: 'modal' }} />
      <Stack.Screen name="idea/new" options={{ title: 'Suggest an idea', presentation: 'modal' }} />
      <Stack.Screen name="poll/new" options={{ title: 'New poll', presentation: 'modal' }} />
      <Stack.Screen name="poll/[pollId]" options={{ title: 'Poll' }} />
      <Stack.Screen name="prepare" options={{ title: 'Get ready' }} />
      <Stack.Screen name="dates" options={{ title: 'Find dates' }} />
      <Stack.Screen name="stays" options={{ title: 'Rooms & beds' }} />
      <Stack.Screen name="stay/new" options={{ title: 'Add a stay', presentation: 'modal' }} />
      <Stack.Screen name="stay/split" options={{ title: 'Split the stay' }} />
      <Stack.Screen name="bookings" options={{ title: 'Bookings' }} />
      <Stack.Screen name="insights" options={{ title: 'Trip insights' }} />
      <Stack.Screen name="booking/new" options={{ title: 'Add a booking', presentation: 'modal' }} />
      <Stack.Screen name="challenges" options={{ title: 'Scavenger Hunt' }} />
      <Stack.Screen name="fun/index" options={{ title: 'Trip Fun' }} />
      <Stack.Screen name="fun/scrapbook" options={{ title: 'Scrapbook' }} />
      <Stack.Screen name="fun/memory" options={{ title: 'Add a memory', presentation: 'modal' }} />
      <Stack.Screen name="fun/food" options={{ title: 'Food Explorer' }} />
      <Stack.Screen name="fun/soundtrack" options={{ title: 'Trip Soundtrack' }} />
      <Stack.Screen name="fun/awards" options={{ title: 'Trip Awards' }} />
      <Stack.Screen name="fun/timeline" options={{ title: 'Timeline' }} />
      <Stack.Screen name="fun/wheel" options={{ title: 'Adventure Wheel' }} />
      <Stack.Screen name="fun/missions" options={{ title: 'Secret Missions' }} />
      <Stack.Screen name="memories" options={{ title: 'Trip memories' }} />
      <Stack.Screen name="post/[postId]" options={{ title: 'Post' }} />
    </Stack>
    </TripPaletteContext.Provider>
    </TripIdContext.Provider>
  );
}
