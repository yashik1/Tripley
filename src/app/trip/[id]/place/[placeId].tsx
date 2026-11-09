import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';

import { placeEmoji, PLACE_KINDS } from '@/components/TripMap.types';
import { Banner, Button, Card, Loading, Row, Screen, Stack as Col, Text } from '@/components/ui';
import { deletePlace, tripPhotoUrl, updatePlace } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { errorMessage } from '@/lib/errors';
import { timeAgo } from '@/lib/format';
import { describeOffset } from '@/lib/geo';
import { directionsUrl } from '@/lib/map-links';
import { keys, useLocations, usePlaces } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { radius, space, useTheme } from '@/theme';

export default function PlaceDetail() {
  const id = useTripId();
  const { placeId } = useLocalSearchParams<{ placeId: string }>();
  const t = useTheme();
  const qc = useQueryClient();
  const { me, nameOf, myMembership } = useTripData(id);
  const places = usePlaces(id);
  const locations = useLocations(id);
  const place = places.data?.find((p) => p.id === placeId);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!place?.photo_path) return;
    let cancelled = false;
    tripPhotoUrl(place.photo_path).then((u) => !cancelled && setPhoto(u));
    return () => {
      cancelled = true;
    };
  }, [place?.photo_path]);

  if (places.isLoading) return <Loading />;
  if (!place) {
    return (
      <Screen>
        <Text muted>This place was removed.</Text>
        <Button title="Back to the map" kind="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const canEdit = place.created_by === me || myMembership?.role === 'organizer';
  const mine = locations.data?.find((l) => l.user_id === me);
  const kindLabel = PLACE_KINDS.find((k) => k.kind === place.kind)?.label ?? 'Place';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: keys.places(id) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: place.name }} />
      {photo ? (
        <Image source={{ uri: photo }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.lg, backgroundColor: t.surfaceAlt }} contentFit="cover" />
      ) : null}
      <Row gap={space.md}>
        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 24 }}>{placeEmoji(place.kind)}</Text>
        </View>
        <Col gap={2} style={{ flex: 1 }}>
          <Text variant="heading">{place.name}</Text>
          <Text variant="caption" muted>
            {kindLabel} · pinned by {nameOf(place.created_by)} {timeAgo(place.created_at)}
          </Text>
        </Col>
      </Row>
      {place.note ? (
        <Card>
          <Text>{place.note}</Text>
        </Card>
      ) : null}
      {mine ? <Text muted>{describeOffset(mine, place) === 'right here' ? 'You’re here.' : `${describeOffset(mine, place)} of you`}</Text> : null}

      <Button title="Directions" icon="directions" kind="secondary" onPress={() => Linking.openURL(directionsUrl(place.lat, place.lng))} />

      <Card>
        <Text variant="label">Arrival alerts</Text>
        <Text variant="caption" muted>
          {place.alerts
            ? `On: the group hears when someone gets within ${place.radius_m} m. Turn alerts off for yourself in trip settings.`
            : 'Off: this is just a pin on the map.'}
        </Text>
        {canEdit ? (
          <Button
            title={place.alerts ? 'Turn off for this place' : 'Turn on for this place'}
            small
            kind="secondary"
            loading={busy}
            onPress={() => run(() => updatePlace(place.id, { alerts: !place.alerts }))}
            testID="toggle-place-alerts"
          />
        ) : null}
      </Card>

      {canEdit ? (
        <Button
          title="Remove this place"
          icon="trash"
          kind="danger"
          onPress={async () => {
            if (!(await confirm(`Remove ${place.name}?`, 'It disappears from everyone’s map.', 'Remove', true))) return;
            await run(async () => {
              await deletePlace(place.id);
              router.back();
            });
          }}
        />
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}
