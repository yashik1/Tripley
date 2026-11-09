/** Suggest a place or activity for the group's bucket list. */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { placeEmoji } from '@/components/TripMap.types';
import { Banner, Button, Card, Chip, Field, Row, Screen, Stack, Text } from '@/components/ui';
import { addSuggestion, uploadTripPhoto } from '@/lib/api';
import { parseAmount } from '@/lib/currency';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { formatDate, todayISO } from '@/lib/format';
import { CATEGORIES } from '@/lib/group-decisions';
import { planDays } from '@/lib/itinerary';
import { pickPhoto } from '@/lib/photos';
import { keys, useItinerary, usePlaces } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import type { SuggestionCategory } from '@/lib/types';
import { useMyFix } from '@/location/compass';
import { radius, space, useTheme } from '@/theme';

export default function SuggestIdea() {
  const id = useTripId();
  const t = useTheme();
  const qc = useQueryClient();
  const { trip } = useTripData(id);
  const places = usePlaces(id);
  const itinerary = useItinerary(id);
  const fix = useMyFix();
  const base = trip?.base_currency ?? 'USD';
  const days = useMemo(() => planDays(trip ?? { starts_on: null, ends_on: null }, itinerary.data ?? [], todayISO()), [trip, itinerary.data]);
  const [category, setCategory] = useState<SuggestionCategory>('food');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [cost, setCost] = useState('');
  const [day, setDay] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError('What’s the place or activity called?');
    const costMinor = cost.trim() ? parseAmount(cost, base) : null;
    if (cost.trim() && (costMinor == null || costMinor < 0)) return setError('Enter the cost as a number, like 25.');
    setBusy(true);
    try {
      const photo_path = photo ? await uploadTripPhoto(id, photo) : null;
      await addSuggestion(id, {
        category,
        name: name.trim(),
        description: description.trim() || null,
        address: address.trim() || null,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        photo_path,
        cost_minor: costMinor,
        cost_currency: costMinor != null ? base : null,
        preferred_day: day,
      });
      await qc.invalidateQueries({ queryKey: keys.suggestions(id) });
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/trip/[id]/ideas', params: { id } });
    } catch (e) {
      setError(isNetworkError(e) ? 'No connection. Try again when you’re back online.' : errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button title="Add to the bucket list" icon="idea" onPress={save} loading={busy} testID="save-idea" />}>
      <Stack gap={space.sm}>
        <Text variant="label" muted>What kind of thing?</Text>
        <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
          {CATEGORIES.map((c) => (
            <Chip key={c.key} label={`${c.emoji} ${c.label}`} selected={category === c.key} onPress={() => setCategory(c.key)} testID={`idea-cat-${c.key}`} />
          ))}
        </Row>
      </Stack>
      <Field label="Name" testID="idea-name" value={name} onChangeText={setName} placeholder="Time Out Market" maxLength={120} />
      <Field label="Why go? (optional)" value={description} onChangeText={setDescription} placeholder="Huge food hall, something for everyone" maxLength={1000} multiline />
      <Card>
        <Field label="Address (optional)" value={address} onChangeText={setAddress} placeholder="Av. 24 de Julho 49, Lisboa" maxLength={300} />
        <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
          {fix ? <Chip label="📍 Where I am now" selected={!!point && point.lat === fix.lat} onPress={() => setPoint({ lat: fix.lat, lng: fix.lng })} /> : null}
          {(places.data ?? []).slice(0, 6).map((p) => (
            <Chip key={p.id} label={`${placeEmoji(p.kind)} ${p.name}`} selected={point?.lat === p.lat && point?.lng === p.lng} onPress={() => setPoint({ lat: p.lat, lng: p.lng })} />
          ))}
          {point ? <Chip label="No map point" onPress={() => setPoint(null)} /> : null}
        </Row>
      </Card>
      <Row gap={space.md} align="flex-start">
        <Field label={`Rough cost per person (${base}, optional)`} testID="idea-cost" value={cost} onChangeText={setCost} placeholder="25" keyboardType="decimal-pad" style={{ flex: 1 }} />
      </Row>
      <Stack gap={space.sm}>
        <Text variant="label" muted>Best day (optional)</Text>
        <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
          <Chip label="Any day" selected={!day} onPress={() => setDay(null)} />
          {days.map((d) => (
            <Chip key={d.day} label={`${d.label} · ${formatDate(d.day)}`} selected={day === d.day} onPress={() => setDay(d.day)} />
          ))}
        </Row>
      </Stack>
      <Stack gap={space.sm}>
        <Text variant="label" muted>Photo (optional)</Text>
        {photo ? (
          <Row gap={space.md}>
            <Image source={{ uri: photo }} style={{ width: 92, height: 92, borderRadius: radius.md, backgroundColor: t.surfaceAlt }} contentFit="cover" />
            <Button title="Remove" kind="ghost" small onPress={() => setPhoto(null)} />
          </Row>
        ) : (
          <Pressable
            onPress={async () => {
              try {
                const uri = await pickPhoto(false);
                if (uri) setPhoto(uri);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
            accessibilityRole="button"
            style={{ width: 92, height: 92, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.border, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 22 }}>📷</Text>
              <Text variant="caption" muted>Add</Text>
            </View>
          </Pressable>
        )}
      </Stack>
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}
