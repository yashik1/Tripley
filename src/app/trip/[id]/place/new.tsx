/**
 * Pin a place on the trip map: where you're staying, the airport, a meeting
 * point, a great find, or a photo memory. Places where it matters (stay,
 * airport, meeting point) tell the group when someone arrives.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { PLACE_KINDS, type PlaceKind } from '@/components/TripMap.types';
import { Banner, Button, Card, Chip, Field, Row, Screen, Stack, Text } from '@/components/ui';
import { addPlace, uploadTripPhoto } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { pickPhoto } from '@/lib/photos';
import { keys } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { radius, space, useTheme } from '@/theme';

const RADII = [50, 100, 150, 300, 500];
const PLACEHOLDER: Record<PlaceKind, string> = {
  stay: 'Our Airbnb',
  airport: 'Lisbon airport, terminal 1',
  meetup: 'Meet by the fountain',
  food: 'Best pastéis in town',
  sight: 'Sunset viewpoint',
  memory: 'Where we got soaked',
  other: 'Name this place',
};

export default function NewPlace() {
  const id = useTripId();
  const t = useTheme();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ lat?: string; lng?: string }>();
  const lat = Number(params.lat);
  const lng = Number(params.lng);
  const [kind, setKind] = useState<PlaceKind>('stay');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [alerts, setAlerts] = useState(true);
  const [alertsTouched, setAlertsTouched] = useState(false);
  const [radiusM, setRadiusM] = useState(150);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseKind = (k: PlaceKind) => {
    setKind(k);
    if (!alertsTouched) setAlerts(PLACE_KINDS.find((x) => x.kind === k)?.alertsByDefault ?? false);
    if (k === 'airport') setRadiusM(500);
  };

  const addPhoto = async (fromCamera: boolean) => {
    setError(null);
    try {
      const uri = await pickPhoto(fromCamera);
      if (uri) setPhotoUri(uri);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const save = async () => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return setError('Pick the spot on the map first.');
    if (!name.trim()) return setError('Give the place a name.');
    setBusy(true);
    setError(null);
    try {
      const photo_path = photoUri ? await uploadTripPhoto(id, photoUri) : null;
      await addPlace({ trip_id: id, kind, name: name.trim(), note: note.trim() || null, lat, lng, radius_m: radiusM, alerts, photo_path });
      await qc.invalidateQueries({ queryKey: keys.places(id) });
      router.back();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button title="Pin it" icon="pin" onPress={save} loading={busy} testID="save-place" />}>
      <Stack gap={space.sm}>
        <Text variant="label" muted>What is it?</Text>
        <Row style={{ flexWrap: 'wrap' }} gap={space.sm}>
          {PLACE_KINDS.map((k) => (
            <Chip key={k.kind} label={`${k.emoji} ${k.label}`} selected={kind === k.kind} onPress={() => chooseKind(k.kind)} testID={`kind-${k.kind}`} />
          ))}
        </Row>
      </Stack>

      <Field label="Name" testID="place-name" value={name} onChangeText={setName} placeholder={PLACEHOLDER[kind]} maxLength={80} />
      <Field
        label={kind === 'memory' ? 'What happened here? (optional)' : 'Note for the group (optional)'}
        value={note}
        onChangeText={setNote}
        placeholder={kind === 'food' ? 'Order the custard tarts. Cash only.' : 'Door code, opening hours, why it’s worth it…'}
        maxLength={500}
        multiline
      />

      <Card>
        <Text variant="label">{kind === 'memory' ? 'Photo' : 'Photo (optional)'}</Text>
        {photoUri ? (
          <Row gap={space.md} align="flex-start">
            <Image source={{ uri: photoUri }} style={{ width: 96, height: 96, borderRadius: radius.md, backgroundColor: t.surfaceAlt }} contentFit="cover" />
            <Button title="Remove" kind="ghost" small onPress={() => setPhotoUri(null)} />
          </Row>
        ) : (
          <Row>
            {Platform.OS !== 'web' ? (
              <Button title="Take photo" icon="camera" kind="secondary" small onPress={() => addPhoto(true)} style={{ flex: 1 }} />
            ) : null}
            <Button title={Platform.OS === 'web' ? 'Upload photo' : 'From photos'} icon="photo" kind="secondary" small onPress={() => addPhoto(false)} style={{ flex: 1 }} />
          </Row>
        )}
      </Card>

      <Card>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: alerts }}
          testID="place-alerts"
          onPress={() => {
            setAlerts((v) => !v);
            setAlertsTouched(true);
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label">Tell the group when someone arrives</Text>
            <Text variant="caption" muted>
              {alerts ? `"Maya arrived at ${name.trim() || PLACEHOLDER[kind]}". No more "are you there yet?" texts.` : 'Off: this is just a pin on the map.'}
            </Text>
          </View>
          <View
            style={{
              width: 46,
              height: 28,
              borderRadius: 14,
              padding: 3,
              backgroundColor: alerts ? t.primary : t.border,
              alignItems: alerts ? 'flex-end' : 'flex-start',
            }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' }} />
          </View>
        </Pressable>
        {alerts ? (
          <Stack gap={space.xs}>
            <Text variant="caption" muted>Counts as arrived within</Text>
            <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
              {RADII.map((r) => (
                <Chip key={r} label={`${r} m`} selected={radiusM === r} onPress={() => setRadiusM(r)} />
              ))}
            </Row>
          </Stack>
        ) : null}
      </Card>

      <Text variant="caption" faint>
        Pinned at {Number.isFinite(lat) ? lat.toFixed(5) : '?'}, {Number.isFinite(lng) ? lng.toFixed(5) : '?'}. Only people on this trip can see it.
      </Text>
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}
