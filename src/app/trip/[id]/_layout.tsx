import { router, Stack, useLocalSearchParams } from 'expo-router';

import { IconButton, Row } from '@/components/ui';
import { useTrip, useTripRealtime } from '@/lib/queries';
import { space, useTheme } from '@/theme';

export default function TripLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const trip = useTrip(id);
  useTripRealtime(id);

  return (
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
    </Stack>
  );
}
