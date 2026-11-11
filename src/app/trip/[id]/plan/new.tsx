/**
 * Add a stop to the plan, or edit one (?itemId=…). A stop can take its map
 * point from a pinned place or from where you are now, so it shows on the map
 * and gets directions.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack as RouterStack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';

import { DateTimeField } from '@/components/DateTimeField';
import { FoundNote, PlaceField } from '@/components/PlaceField';
import { placeEmoji } from '@/components/TripMap.types';
import { Banner, Button, Card, Chip, Field, Loading, Row, Screen, Stack, Text } from '@/components/ui';
import { addItineraryItem, updateItineraryItem, type ItineraryInput } from '@/lib/api';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { formatDate, todayISO } from '@/lib/format';
import { parseTime, planDays, shortTime } from '@/lib/itinerary';
import { keys, useItinerary, usePlaces } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import type { GeoResult } from '@/lib/geocode';
import type { ItineraryItem } from '@/lib/types';
import { useSearchNear } from '@/lib/use-search-near';
import { useMyFix } from '@/location/compass';
import { space } from '@/theme';

type Point = { lat: number; lng: number; label: string } | null;

export default function PlanItemForm() {
  const id = useTripId();
  const { itemId, day: dayParam } = useLocalSearchParams<{ itemId?: string; day?: string }>();
  const { trip, loading } = useTripData(id);
  const itinerary = useItinerary(id);
  const existing = itemId ? itinerary.data?.find((i) => i.id === itemId) : undefined;
  if (itemId && !existing) return itinerary.isLoading || loading ? <Loading /> : <Missing />;
  // Wait for the trip so the day choices (and the default day) come from its dates.
  if (loading || !trip) return <Loading />;
  return <Form key={existing?.id ?? 'new'} tripId={id} existing={existing} initialDay={dayParam} trip={trip} items={itinerary.data ?? []} />;
}

function Missing() {
  return (
    <Screen>
      <Banner tone="info" title="This stop isn’t in the plan any more">Someone may have removed it.</Banner>
      <Button title="Back to the plan" kind="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

function Form({
  tripId,
  existing,
  initialDay,
  trip,
  items,
}: {
  tripId: string;
  existing?: ItineraryItem;
  initialDay?: string;
  trip: { starts_on: string | null; ends_on: string | null } | null;
  items: ItineraryItem[];
}) {
  const qc = useQueryClient();
  const places = usePlaces(tripId);
  const fix = useMyFix();
  const near = useSearchNear(tripId);
  const today = todayISO();
  const days = useMemo(() => planDays(trip ?? { starts_on: null, ends_on: null }, items, today), [trip, items, today]);
  const [chosenDay, setDay] = useState(existing?.day ?? initialDay ?? days[0]?.day ?? today);
  // Only days the trip allows can be picked (the server checks this too).
  const day = days.some((d) => d.day === chosenDay) ? chosenDay : days[0]?.day ?? today;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [start, setStart] = useState(shortTime(existing?.starts_at ?? null) ?? '');
  const [end, setEnd] = useState(shortTime(existing?.ends_at ?? null) ?? '');
  const [placeName, setPlaceName] = useState(existing?.place_name ?? '');
  const [address, setAddress] = useState(existing?.address ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [point, setPoint] = useState<Point>(
    existing?.lat != null && existing.lng != null ? { lat: existing.lat, lng: existing.lng, label: existing.place_name ?? 'Saved spot' } : null,
  );
  // Set when the place came from search, so editing the text afterwards un-checks it.
  const [found, setFound] = useState<Pick<GeoResult, 'address'> | null>(
    existing?.lat != null && existing.address ? { address: existing.address } : null,
  );
  const pick = (r: GeoResult, fillName: boolean) => {
    if (fillName || !placeName.trim()) setPlaceName(r.name.slice(0, 120));
    setAddress(r.address.slice(0, 300));
    setPoint({ lat: r.lat, lng: r.lng, label: r.name });
    setFound(r);
  };
  const typed = (set: (v: string) => void) => (text: string) => {
    set(text);
    if (found) {
      setFound(null);
      setPoint(null);
    }
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startTime = parseTime(start);
  const endTime = parseTime(end);
  const timeError =
    startTime === undefined || endTime === undefined
      ? 'Use a time like 9:30 or 21:00.'
      : endTime && !startTime
        ? 'Add a start time too.'
        : startTime && endTime && endTime <= startTime
          ? 'The end time should be after the start.'
          : null;

  const save = async () => {
    if (!title.trim()) return setError('What’s the plan? Give it a name.');
    if (timeError) return setError(timeError);
    setBusy(true);
    setError(null);
    const input: ItineraryInput = {
      day,
      title: title.trim(),
      starts_at: startTime ?? null,
      ends_at: endTime ?? null,
      place_name: placeName.trim() || null,
      address: address.trim() || null,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      notes: notes.trim() || null,
    };
    try {
      if (existing) await updateItineraryItem(existing.id, input);
      else await addItineraryItem(tripId, input);
      await qc.invalidateQueries({ queryKey: keys.itinerary(tripId) });
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/trip/[id]/plan', params: { id: tripId } });
    } catch (e) {
      setError(isNetworkError(e) ? 'No connection. Changes to the plan need a connection; try again when you’re back online.' : errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button title={existing ? 'Save changes' : 'Add to the plan'} icon="check" onPress={save} loading={busy} testID="save-stop" />}>
      <RouterStack.Screen options={{ title: existing ? 'Edit stop' : 'Add to the plan' }} />
      <Field label="What’s the plan?" testID="stop-title" value={title} onChangeText={setTitle} placeholder="Tile museum, dinner at Taberna…" maxLength={120} />

      <Stack gap={space.sm}>
        <Text variant="label" muted>Day</Text>
        <Row style={{ flexWrap: 'wrap' }} gap={space.xs}>
          {days.map((d) => (
            <Chip key={d.day} label={`${d.label} · ${formatDate(d.day)}`} selected={day === d.day} onPress={() => setDay(d.day)} testID={`stop-day-${d.day}`} />
          ))}
        </Row>
      </Stack>

      <Row gap={space.md} align="flex-start">
        <DateTimeField mode="time" label="Starts" testID="stop-start" value={start} onChangeText={setStart} placeholder="10:00" style={{ flex: 1 }} />
        <DateTimeField mode="time" label="Ends (optional)" testID="stop-end" value={end} onChangeText={setEnd} placeholder="11:30" style={{ flex: 1 }} />
      </Row>
      {timeError && (start || end) ? <Text variant="caption" muted>{timeError}</Text> : null}

      <Card>
        <Text variant="label">Where</Text>
        <PlaceField
          label="Place"
          testID="stop-place"
          value={placeName}
          near={near}
          onChangeText={typed(setPlaceName)}
          onPick={(r) => pick(r, true)}
          found={!!found}
          placeholder="Search a place: Museu Nacional do Azulejo"
          maxLength={120}
        />
        <PlaceField
          label="Address (optional)"
          testID="stop-address"
          value={address}
          near={near}
          onChangeText={typed(setAddress)}
          onPick={(r) => pick(r, false)}
          found={!!found}
          placeholder="Or search the address"
        />
        <FoundNote found={found} typed={address || placeName} testID="stop-found" />
        <Text variant="caption" muted>
          {point ? `On the map: ${point.label}` : 'Add a map point so it shows on the map with directions.'}
        </Text>
        <Row style={{ flexWrap: 'wrap' }} gap={space.xs}>
          {(places.data ?? []).slice(0, 8).map((p) => (
            <Chip
              key={p.id}
              label={`${placeEmoji(p.kind)} ${p.name}`}
              selected={point?.lat === p.lat && point?.lng === p.lng}
              onPress={() => {
                setFound(null);
                setPoint({ lat: p.lat, lng: p.lng, label: p.name });
                if (!placeName.trim()) setPlaceName(p.name);
              }}
            />
          ))}
          {fix ? (
            <Chip
              label="📍 Where I am now"
              selected={point?.label === 'Where I was'}
              onPress={() => {
                setFound(null);
                setPoint({ lat: fix.lat, lng: fix.lng, label: 'Where I was' });
              }}
              testID="stop-here"
            />
          ) : null}
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

      <Field label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Booking ref, what to bring, who has the tickets…" maxLength={1000} multiline />
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}
