import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { Avatar, Banner, Button, Card, Loading, Row, Screen, Stack, Text } from '@/components/ui';
import { isConfigured } from '@/config';
import { joinTripByCode, tripPreview } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateRange } from '@/lib/format';
import { setPendingJoin } from '@/lib/pending-join';
import { keys } from '@/lib/queries';
import { useAuth } from '@/providers/AuthProvider';
import { space } from '@/theme';

export default function JoinTrip() {
  const { code = '' } = useLocalSearchParams<{ code: string }>();
  const { session } = useAuth();
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: ['preview', code, !!session],
    queryFn: () => tripPreview(code),
    enabled: isConfigured && !!code,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (preview.isLoading) return <Loading />;
  const p = preview.data;

  if (!p) {
    return (
      <Screen>
        <Text variant="heading">This invite link doesn&apos;t work</Text>
        <Text muted>The trip may have ended, or the organizer made a new link. Ask them to send it again.</Text>
        <Button title="Go to my trips" kind="secondary" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  const join = async () => {
    setError(null);
    if (!session) {
      await setPendingJoin(code);
      router.replace('/sign-in');
      return;
    }
    setBusy(true);
    try {
      const tripId = await joinTripByCode(code);
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.trips }),
        qc.invalidateQueries({ queryKey: keys.sharing }),
      ]);
      router.replace(`/trip/${tripId}/map`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const dates = formatDateRange(p.starts_on, p.ends_on);
  return (
    <Screen>
      <Card>
        <Text variant="caption" muted>{p.organizer_name} invited you to</Text>
        <Text variant="title">{p.name}</Text>
        {dates ? <Text muted>{dates}</Text> : null}
        <Row gap={-8} style={{ marginTop: space.sm }}>
          {p.member_names.map((n, i) => (
            <View key={`${n}-${i}`} style={{ marginRight: -8 }}>
              <Avatar id={`${p.trip_id}-${i}`} name={n} size={34} ring="#fff" />
            </View>
          ))}
          <Text muted style={{ marginLeft: space.lg }}>
            {p.member_count} {p.member_count === 1 ? 'person' : 'people'} going
          </Text>
        </Row>
      </Card>
      <Stack gap={space.sm}>
        <Text variant="label">When you join</Text>
        <Text muted>• Everyone on the trip can see where you are on the map until the trip ends. You can pause anytime.</Text>
        <Text muted>• You can add bills and see what you owe. The app does all the maths.</Text>
      </Stack>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {p.is_member ? (
        <Button title="Open trip" onPress={() => router.replace(`/trip/${p.trip_id}/map`)} />
      ) : (
        <Button title={session ? 'Join trip' : 'Sign in to join'} onPress={join} loading={busy} testID="join-trip" />
      )}
      {Platform.OS === 'web' ? (
        <Banner tone="info" title="Get the app for the best experience" icon="location">
          In the browser your location only updates while this page is open. Install Tripley on your phone to keep sharing when it&apos;s closed.
        </Banner>
      ) : null}
    </Screen>
  );
}
