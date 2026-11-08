import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router, Stack as RouterStack } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, View } from 'react-native';

import { Brand } from '@/components/AuthLayout';
import { Landing } from '@/components/Landing';
import { Avatar, Banner, Button, Card, EmptyState, IconButton, Loading, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { isConfigured } from '@/config';
import { isTripActive, respondToInvitation } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateRange } from '@/lib/format';
import { isGuest } from '@/lib/guest';
import { takePendingJoin } from '@/lib/pending-join';
import { keys, useInvitations, useNotifications, useTrips } from '@/lib/queries';
import type { TripWithCount } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { space, useTheme } from '@/theme';

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
  return <TripsHome />;
}

function TripsHome() {
  const t = useTheme();
  const qc = useQueryClient();
  const { profile, user } = useAuth();
  const trips = useTrips();
  const invitations = useInvitations();
  const notifications = useNotifications();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unread = (notifications.data ?? []).filter((n) => !n.read_at).length;

  useEffect(() => {
    takePendingJoin().then((code) => {
      if (code) router.push({ pathname: '/join/[code]', params: { code, auto: '1' } });
    });
  }, []);

  const respond = async (id: string, accept: boolean) => {
    setBusy(id);
    setError(null);
    try {
      const tripId = await respondToInvitation(id, accept);
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.invitations }),
        qc.invalidateQueries({ queryKey: keys.trips }),
        qc.invalidateQueries({ queryKey: keys.sharing }),
      ]);
      if (accept) router.push(`/trip/${tripId}/map`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const all = trips.data ?? [];
  const active = all.filter((x) => isTripActive(x));
  const past = all.filter((x) => !isTripActive(x));

  return (
    <>
      <RouterStack.Screen
        options={{
          headerShown: true,
          title: 'Tripley',
          headerTitle: () => <Brand size={18} onPress={() => router.push('/home')} testID="header-home" />,
          headerRight: () => (
            <Row gap={space.xs}>
              <View>
                <IconButton icon="bell" label="Notifications" onPress={() => router.push('/notifications')} />
                {unread > 0 ? (
                  <View
                    style={{
                      position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8,
                      backgroundColor: t.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
                    }}>
                    <Text variant="caption" color="#fff" style={{ fontSize: 10, lineHeight: 12 }}>{unread > 9 ? '9+' : unread}</Text>
                  </View>
                ) : null}
              </View>
              <IconButton icon="person" label="Profile" onPress={() => router.push('/profile')} />
            </Row>
          ),
        }}
      />
      <Screen
        refreshControl={
          <RefreshControl
            refreshing={trips.isRefetching}
            onRefresh={() => {
              trips.refetch();
              invitations.refetch();
            }}
          />
        }
        footer={<Button title="Start a new trip" icon="add" onPress={() => router.push('/trips/new')} testID="new-trip" />}>
        <Text variant="title">Hi {profile?.display_name?.split(' ')[0] ?? 'there'}</Text>
        {isGuest(user) ? (
          <Banner
            tone="warning"
            title="Save your account"
            icon="person"
            action={<Button title="Save my account" small onPress={() => router.push('/profile')} testID="home-save-account" style={{ alignSelf: 'flex-start' }} />}>
            You&apos;re using a guest account, which only lives in this browser. Add an email and password to keep your trips and log in anywhere.
          </Banner>
        ) : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}

        {(invitations.data ?? []).length > 0 ? (
          <Stack gap={space.sm}>
            <SectionTitle>Invitations</SectionTitle>
            {invitations.data!.map((inv) => (
              <Card key={inv.invitation_id}>
                <Text variant="heading">{inv.trip_name}</Text>
                <Text muted>
                  {inv.invited_by_name} invited you · {inv.member_count} {inv.member_count === 1 ? 'person' : 'people'}
                  {formatDateRange(inv.starts_on, inv.ends_on) ? ` · ${formatDateRange(inv.starts_on, inv.ends_on)}` : ''}
                </Text>
                <Row>
                  <Button title="Join trip" small onPress={() => respond(inv.invitation_id, true)} loading={busy === inv.invitation_id} style={{ flex: 1 }} />
                  <Button title="Decline" small kind="secondary" onPress={() => respond(inv.invitation_id, false)} style={{ flex: 1 }} />
                </Row>
              </Card>
            ))}
          </Stack>
        ) : null}

        {trips.isLoading ? null : all.length === 0 ? (
          <EmptyState
            icon="trip"
            title="No trips yet"
            body="Start a trip and share the link with your friends, or open an invite link someone sent you."
          />
        ) : (
          <>
            {active.length > 0 ? (
              <Stack gap={space.sm}>
                <SectionTitle>Your trips</SectionTitle>
                {active.map((trip) => <TripCard key={trip.id} trip={trip} me={user?.id} />)}
              </Stack>
            ) : null}
            {past.length > 0 ? (
              <Stack gap={space.sm}>
                <SectionTitle>Past trips</SectionTitle>
                {past.map((trip) => <TripCard key={trip.id} trip={trip} me={user?.id} />)}
              </Stack>
            ) : null}
          </>
        )}
      </Screen>
    </>
  );
}

function TripCard({ trip, me }: { trip: TripWithCount; me?: string }) {
  const count = trip.trip_members?.[0]?.count ?? 1;
  const dates = formatDateRange(trip.starts_on, trip.ends_on);
  return (
    <Card onPress={() => router.push(`/trip/${trip.id}/map`)}>
      <Row gap={space.md}>
        <Avatar id={trip.id} name={trip.name} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="heading" numberOfLines={1}>{trip.name}</Text>
          <Text variant="caption" muted>
            {count} {count === 1 ? 'person' : 'people'} · {trip.base_currency}
            {dates ? ` · ${dates}` : ''}
            {trip.organizer_id === me ? ' · You organize' : ''}
          </Text>
        </View>
      </Row>
    </Card>
  );
}
