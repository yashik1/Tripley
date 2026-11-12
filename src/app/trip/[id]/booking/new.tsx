/**
 * Add a booking, or edit one (?bookingId=…). After "Let Tripley read a
 * confirmation" it opens filled in from what was read (?read=…), to check
 * before saving, and the file it came from is attached (?docId=…).
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack as RouterStack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';

import { DateTimeField } from '@/components/DateTimeField';
import { PlaceField } from '@/components/PlaceField';
import { Banner, Button, Card, Chip, Field, Loading, Row, Screen, Stack, Text } from '@/components/ui';
import { deleteBooking, saveBooking, updateDocument } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { BOOKING_KINDS, formFromRead, type BookingForm, type ReadBooking } from '@/lib/documents';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { firstName, isISODate } from '@/lib/format';
import { keys, useBookings } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import type { Booking } from '@/lib/types';
import { space, useTheme } from '@/theme';

const empty: BookingForm = {
  kind: 'flight',
  title: '',
  provider: '',
  reference: '',
  startDay: '',
  startTime: '',
  endDay: '',
  endTime: '',
  fromPlace: '',
  toPlace: '',
  address: '',
  notes: '',
  travellerIds: [],
};

function fromBooking(b: Booking): BookingForm {
  return {
    kind: (BOOKING_KINDS.find((k) => k.kind === b.kind)?.kind ?? 'other') as BookingForm['kind'],
    title: b.title,
    provider: b.provider ?? '',
    reference: b.reference ?? '',
    startDay: b.start_day ?? '',
    startTime: b.start_time?.slice(0, 5) ?? '',
    endDay: b.end_day ?? '',
    endTime: b.end_time?.slice(0, 5) ?? '',
    fromPlace: b.from_place ?? '',
    toPlace: b.to_place ?? '',
    address: b.address ?? '',
    notes: b.notes ?? '',
    travellerIds: b.traveller_ids,
  };
}

export default function BookingEditor() {
  const id = useTripId();
  const { bookingId, docId, read } = useLocalSearchParams<{ bookingId?: string; docId?: string; read?: string }>();
  const { members, me, loading } = useTripData(id);
  const bookings = useBookings(id);
  if (loading || (bookingId && bookings.isLoading)) return <Loading />;
  const booking = bookingId ? bookings.data?.find((b) => b.id === bookingId) ?? null : null;
  if (bookingId && !booking) {
    return (
      <Screen>
        <Banner tone="info" title="This booking was removed" />
        <Button title="Back" kind="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }
  let initial = booking ? fromBooking(booking) : empty;
  let fromAi = false;
  if (!booking && read) {
    try {
      initial = formFromRead(JSON.parse(read) as ReadBooking, members.map((m) => ({ id: m.user_id, name: m.profile.display_name || '' })));
      fromAi = true;
    } catch {
      // Not readable: start empty.
    }
  }
  const people = members.map((m) => ({ id: m.user_id, name: m.user_id === me ? 'Me' : firstName(m.profile.display_name || 'Friend') }));
  return <Form key={booking?.id ?? 'new'} tripId={id} booking={booking} initial={initial} fromAi={fromAi} docId={docId} people={people} />;
}

function Form({
  tripId,
  booking,
  initial,
  fromAi,
  docId,
  people,
}: {
  tripId: string;
  booking: Booking | null;
  initial: BookingForm;
  fromAi: boolean;
  docId?: string;
  people: { id: string; name: string }[];
}) {
  const t = useTheme();
  const qc = useQueryClient();
  const [f, setF] = useState<BookingForm>(initial);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(booking?.lat != null && booking.lng != null ? { lat: booking.lat, lng: booking.lng } : null);
  const [isPrivate, setPrivate] = useState(booking?.private ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<BookingForm>) => setF((x) => ({ ...x, ...patch }));
  const journey = ['flight', 'train', 'bus', 'ferry', 'car'].includes(f.kind);

  const save = async () => {
    setError(null);
    if (!f.title.trim()) return setError('Give it a short title, e.g. "TP1350 Lisbon → Porto".');
    if (f.startDay && !isISODate(f.startDay)) return setError('Pick the start day.');
    if (f.endDay && !isISODate(f.endDay)) return setError('Pick the end day.');
    if ((f.startTime && !f.startDay) || (f.endTime && !f.endDay)) return setError('Add the day for each time.');
    if (f.startDay && f.endDay && (f.endDay < f.startDay || (f.endDay === f.startDay && f.startTime && f.endTime && f.endTime < f.startTime))) {
      return setError('It has to end after it starts.');
    }
    setBusy(true);
    try {
      const savedId = await saveBooking(tripId, booking?.id ?? null, {
        kind: f.kind,
        title: f.title.trim(),
        provider: f.provider.trim() || null,
        reference: f.reference.trim() || null,
        start_day: f.startDay || null,
        start_time: f.startDay && f.startTime ? f.startTime : null,
        end_day: f.endDay || null,
        end_time: f.endDay && f.endTime ? f.endTime : null,
        from_place: f.fromPlace.trim() || null,
        to_place: journey ? f.toPlace.trim() || null : null,
        address: f.address.trim() || null,
        lat: f.address.trim() && point ? point.lat : null,
        lng: f.address.trim() && point ? point.lng : null,
        notes: f.notes.trim() || null,
        traveller_ids: f.travellerIds,
        private: isPrivate,
      });
      if (docId) await updateDocument(docId, { booking_id: savedId, ...(isPrivate ? { private: true } : {}) });
      await Promise.all([qc.invalidateQueries({ queryKey: keys.bookings(tripId) }), qc.invalidateQueries({ queryKey: keys.documents(tripId) })]);
      if (router.canGoBack()) router.back();
      else router.replace(`/trip/${tripId}/bookings`);
    } catch (e) {
      setError(isNetworkError(e) ? 'No connection. Try again when you’re back online.' : errorMessage(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!booking) return;
    if (!(await confirm(`Delete ${booking.title}?`, 'Its files stay under Documents. A plan made from it stays too.', 'Delete', true))) return;
    try {
      await deleteBooking(booking.id);
      await qc.invalidateQueries({ queryKey: keys.bookings(tripId) });
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Screen footer={<Button title={booking ? 'Save changes' : 'Save booking'} icon="check" onPress={save} loading={busy} testID="booking-save" />}>
      <RouterStack.Screen options={{ title: booking ? 'Edit booking' : 'Add a booking' }} />
      {fromAi ? (
        <Banner tone="info" icon="sparkles" title="Read from your file">
          Check the details, especially dates, times and the code, then save.
        </Banner>
      ) : null}
      <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
        {BOOKING_KINDS.map((k) => (
          <Chip key={k.kind} label={`${k.emoji} ${k.label}`} selected={f.kind === k.kind} onPress={() => set({ kind: k.kind })} testID={`booking-kind-${k.kind}`} />
        ))}
      </Row>
      <Field label="Title" testID="booking-title" value={f.title} onChangeText={(v) => set({ title: v })} placeholder={journey ? 'TP1350 Lisbon → Porto' : 'Alfama flat'} maxLength={120} />
      <Row gap={space.md} align="flex-start">
        <Field label={journey ? 'Airline or company' : 'Hotel, host or venue'} testID="booking-provider" value={f.provider} onChangeText={(v) => set({ provider: v })} maxLength={80} style={{ flex: 1 }} />
        <Field label="Booking code" testID="booking-reference" value={f.reference} onChangeText={(v) => set({ reference: v })} maxLength={60} autoCapitalize="characters" style={{ flex: 1 }} />
      </Row>
      <Row gap={space.md} align="flex-start">
        <DateTimeField mode="date" label={journey ? 'Departs' : f.kind === 'stay' ? 'Check-in' : 'Starts'} value={f.startDay} onChangeText={(v) => set({ startDay: v })} style={{ flex: 1 }} testID="booking-start-day" />
        <DateTimeField mode="time" label="Time" value={f.startTime} onChangeText={(v) => set({ startTime: v })} style={{ flex: 1 }} testID="booking-start-time" />
      </Row>
      <Row gap={space.md} align="flex-start">
        <DateTimeField mode="date" label={journey ? 'Arrives' : f.kind === 'stay' ? 'Check-out' : 'Ends'} value={f.endDay} onChangeText={(v) => set({ endDay: v })} style={{ flex: 1 }} testID="booking-end-day" />
        <DateTimeField mode="time" label="Time" value={f.endTime} onChangeText={(v) => set({ endTime: v })} style={{ flex: 1 }} testID="booking-end-time" />
      </Row>
      {journey ? (
        <Row gap={space.md} align="flex-start">
          <Field label="From" testID="booking-from" value={f.fromPlace} onChangeText={(v) => set({ fromPlace: v })} placeholder="Lisbon LIS" maxLength={120} style={{ flex: 1 }} />
          <Field label="To" testID="booking-to" value={f.toPlace} onChangeText={(v) => set({ toPlace: v })} placeholder="Porto OPO" maxLength={120} style={{ flex: 1 }} />
        </Row>
      ) : (
        <PlaceField
          label="Address (optional)"
          value={f.address}
          onChangeText={(v) => {
            set({ address: v });
            setPoint(null);
          }}
          onPick={(r) => {
            set({ address: r.address || r.name, fromPlace: f.fromPlace || r.name });
            setPoint({ lat: r.lat, lng: r.lng });
          }}
          placeholder="Search the address or the place's name"
          testID="booking-address"
        />
      )}
      <Stack gap={space.xs}>
        <Text variant="label" muted>{f.travellerIds.length ? 'Who it’s for' : 'Who it’s for: everyone (tap to choose)'}</Text>
        <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
          {people.map((p) => {
            const on = f.travellerIds.includes(p.id);
            return (
              <Chip
                key={p.id}
                label={p.name}
                selected={on}
                onPress={() => set({ travellerIds: on ? f.travellerIds.filter((x) => x !== p.id) : [...f.travellerIds, p.id] })}
                testID={`booking-for-${p.name}`}
              />
            );
          })}
        </Row>
      </Stack>
      <Field label="Notes (optional)" testID="booking-notes" value={f.notes} onChangeText={(v) => set({ notes: v })} placeholder="Seat 14C, terminal 1, check-in from 15:00" maxLength={1000} multiline />
      <Card>
        <Row gap={space.md}>
          <View style={{ flex: 1 }}>
            <Text variant="label">Only me</Text>
            <Text variant="caption" muted>
              {isPrivate ? 'Nobody else on the trip sees it or its files.' : 'Everyone on the trip sees it, including the code. A code can be used to change a booking, so keep personal ones private.'}
            </Text>
          </View>
          <Switch value={isPrivate} onValueChange={setPrivate} trackColor={{ true: t.primary, false: t.border }} thumbColor="#fff" accessibilityLabel="Only me" testID="booking-private" />
        </Row>
      </Card>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {booking ? <Button title="Delete this booking" kind="ghost" icon="trash" onPress={remove} testID="booking-delete" /> : null}
    </Screen>
  );
}
