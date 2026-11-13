/** Suggest a place or activity for the group's bucket list. */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { FoundNote, PlaceField } from '@/components/PlaceField';
import { placeEmoji } from '@/components/TripMap.types';
import { Banner, Button, Card, Chip, Field, Row, Screen, Stack, Text } from '@/components/ui';
import { addSuggestion, uploadTripPhoto } from '@/lib/api';
import { parseAmount } from '@/lib/currency';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { formatDate, todayISO } from '@/lib/format';
import type { GeoResult } from '@/lib/geocode';
import { CATEGORIES } from '@/lib/group-decisions';
import { planDays } from '@/lib/itinerary';
import { pickPhoto } from '@/lib/photos';
import { keys, useItinerary, usePlaces } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import type { SuggestionCategory } from '@/lib/types';
import { useSearchNear } from '@/lib/use-search-near';
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
  const near = useSearchNear(id);
  // Pre-filled from a search on the map.
  const params = useLocalSearchParams<{ name?: string; address?: string; lat?: string; lng?: string; category?: string }>();
  const fromMap =
    params.lat && params.lng && Number.isFinite(Number(params.lat)) && Number.isFinite(Number(params.lng))
      ? { lat: Number(params.lat), lng: Number(params.lng) }
      : null;
  const base = trip?.base_currency ?? 'USD';
  const days = useMemo(() => planDays(trip ?? { starts_on: null, ends_on: null }, itinerary.data ?? [], todayISO()), [trip, itinerary.data]);
  // Pre-filled from a trip-theme starter ("Ideas for a beach trip").
  const [category, setCategory] = useState<SuggestionCategory>(CATEGORIES.find((c) => c.key === params.category)?.key ?? 'food');
  const [name, setName] = useState((params.name ?? '').slice(0, 120));
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState((params.address ?? '').slice(0, 300));
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(fromMap);
  const [found, setFound] = useState<Pick<GeoResult, 'address'> | null>(fromMap && params.address ? { address: params.address } : null);
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
        <PlaceField
          label="Where is it? (optional)"
          testID="idea-address"
          value={address}
          near={near}
          onChangeText={(text) => {
            setAddress(text);
            if (found) {
              setFound(null);
              setPoint(null);
            }
          }}
          onPick={(r) => {
            setAddress(r.address);
            setPoint({ lat: r.lat, lng: r.lng });
            setFound(r);
            if (!name.trim()) setName(r.name.slice(0, 120));
          }}
          found={!!found}
          placeholder="Search by name or address"
        />
        <FoundNote found={found} typed={address} testID="idea-address-note" />
        <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
          {fix ? (
            <Chip
              label="📍 Where I am now"
              selected={!!point && point.lat === fix.lat}
              onPress={() => {
                setFound(null);
                setPoint({ lat: fix.lat, lng: fix.lng });
              }}
            />
          ) : null}
          {(places.data ?? []).slice(0, 6).map((p) => (
            <Chip
              key={p.id}
              label={`${placeEmoji(p.kind)} ${p.name}`}
              selected={point?.lat === p.lat && point?.lng === p.lng}
              onPress={() => {
                setFound(null);
                setPoint({ lat: p.lat, lng: p.lng });
              }}
            />
          ))}
          {point ? (
            <Chip
              label="No map point"
              onPress={() => {
                setFound(null);
                setPoint(null);
              }}
            />
          ) : null}
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
