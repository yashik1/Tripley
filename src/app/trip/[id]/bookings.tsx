/**
 * Bookings and documents: the trip's flights, trains, stays and tickets in one
 * place, each with its confirmation code and files; documents can be kept on
 * this device to open with no signal. Tripley Pro reads a confirmation (PDF,
 * screenshot or photo) and fills in the booking.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';

import { Banner, Button, Card, Chip, Loading, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { addBookingToPlan, deleteDocument, documentUrl, isPro, readBooking, ScanError, uploadDocument } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { bookingWhen, documentTitle, kindInfo, MAX_DOCUMENT_BYTES, sortBookings, type PickedDocument } from '@/lib/documents';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { firstName, formatDate, formatDateRange } from '@/lib/format';
import { newClientId } from '@/lib/ids';
import { isSavedOffline, openOffline, removeOffline, saveOffline } from '@/lib/offline-docs';
import { pickDocument } from '@/lib/pick-document';
import { pickPhoto } from '@/lib/photos';
import { keys, useAccount, useBookings, useDocuments } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import type { Booking, Trip, TripDocument } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
/** Where and when, for the AI to choose the right year. */
const tripContext = (trip: Trip) => [trip.destination || trip.name, formatDateRange(trip.starts_on, trip.ends_on)].filter(Boolean).join(', ');

export default function Bookings() {
  const id = useTripId();
  const { trip, members, me, isOrganizer, active, loading } = useTripData(id);
  const bookings = useBookings(id);
  const documents = useDocuments(id);
  const account = useAccount();
  const qc = useQueryClient();
  const t = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const docs = documents.data ?? [];
  const offline = useQuery({
    queryKey: ['offlineDocs', me, docs.map((d) => d.id).join(',')],
    queryFn: async () => {
      const saved = await Promise.all(docs.map(async (d) => ((await isSavedOffline(me, d)) ? d.id : null)));
      return new Set(saved.filter((x): x is string => !!x));
    },
    enabled: !!me,
    networkMode: 'always',
  });
  if (loading || !trip || bookings.isLoading || documents.isLoading) return <Loading />;
  const pro = isPro(account.data);
  const list = sortBookings(bookings.data ?? []);
  const loose = docs.filter((d) => !d.booking_id || !list.some((b) => b.id === d.booking_id));
  const nameOf = (uid: string) => (uid === me ? 'You' : firstName(members.find((m) => m.user_id === uid)?.profile.display_name || 'Friend'));
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: keys.bookings(id) }), qc.invalidateQueries({ queryKey: keys.documents(id) })]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(isNetworkError(e) ? 'No connection. Try again when you’re back online.' : errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const upload = async (picked: PickedDocument, isPrivate: boolean) => {
    if (picked.bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error('That file is over 10 MB. Try a smaller one.');
    const doc = await uploadDocument(id, picked, { name: documentTitle(picked.name), private: isPrivate });
    await refresh();
    return doc;
  };

  const addDocument = () =>
    run('add-doc', async () => {
      const picked = await pickDocument();
      if (!picked) return;
      await upload(picked, false);
      setNote('Added. Everyone on the trip can open it.');
    });

  const readConfirmation = (fromPhotos: boolean) =>
    run(fromPhotos ? 'read-photo' : 'read-file', async () => {
      let picked: PickedDocument | null;
      if (fromPhotos) {
        const uri = await pickPhoto(false);
        picked = uri ? { name: 'Booking.jpg', mime: 'image/jpeg', bytes: await (await fetch(uri)).arrayBuffer() } : null;
      } else {
        picked = await pickDocument();
      }
      if (!picked) return;
      const doc = await upload(picked, false);
      try {
        const res = await readBooking(id, doc.path, tripContext(trip), newClientId());
        router.push({ pathname: '/trip/[id]/booking/new', params: { id, docId: doc.id, read: JSON.stringify(res.booking) } });
      } catch (e) {
        // The file is kept; they can type the booking in.
        setError(`${e instanceof ScanError ? e.message : errorMessage(e)} The file is saved under Documents.`);
      }
    });

  const open = async (doc: TripDocument) => {
    await run(`open-${doc.id}`, async () => {
      if (await openOffline(me, doc).catch(() => false)) return;
      const url = await documentUrl(doc.path);
      if (!url) throw new Error('Couldn’t open it. Check your connection.');
      if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
      else await Linking.openURL(url);
    });
  };

  const toggleOffline = (doc: TripDocument) =>
    run(`offline-${doc.id}`, async () => {
      if (offline.data?.has(doc.id)) {
        await removeOffline(me, doc);
      } else {
        const url = await documentUrl(doc.path);
        if (!url) throw new Error('Couldn’t download it. Check your connection.');
        await saveOffline(me, doc, url);
        setNote(`${doc.name} is on this device now.`);
      }
      await offline.refetch();
    });

  const removeDoc = (doc: TripDocument) =>
    run(`delete-${doc.id}`, async () => {
      if (!(await confirm(`Delete ${doc.name}?`, 'It’s removed for everyone on the trip.', 'Delete', true))) return;
      await deleteDocument(doc);
      await removeOffline(me, doc).catch(() => undefined);
      await refresh();
    });

  const docRow = (doc: TripDocument) => (
    <DocRow
      key={doc.id}
      doc={doc}
      saved={!!offline.data?.has(doc.id)}
      canDelete={doc.uploaded_by === me || (isOrganizer && !doc.private)}
      onOpen={() => open(doc)}
      onToggle={() => toggleOffline(doc)}
      onDelete={() => removeDoc(doc)}
    />
  );

  return (
    <Screen
      footer={
        active ? (
          <Row gap={space.sm}>
            <Button title="Add a booking" icon="add" onPress={() => router.push(`/trip/${id}/booking/new`)} style={{ flex: 1 }} testID="booking-add" />
            <Button title="Add a document" icon="document" kind="secondary" loading={busy === 'add-doc'} onPress={addDocument} style={{ flex: 1 }} testID="doc-add" />
          </Row>
        ) : undefined
      }>
      <Stack gap={space.xs}>
        <Text variant="title">Bookings & documents</Text>
        <Text muted>Flights, trains, stays and tickets in one place, with their codes and files. Keep files on your phone for when there’s no signal.</Text>
      </Stack>

      {active ? (
        pro ? (
          <Card>
            <Text variant="label">Let Tripley read a confirmation</Text>
            <Text variant="caption" muted>A PDF, a screenshot or a photo of the booking email. You check it before it’s saved.</Text>
            <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
              <Button title="Choose a file" small icon="sparkles" loading={busy === 'read-file'} onPress={() => readConfirmation(false)} testID="booking-read-file" />
              <Button title="From photos" small kind="secondary" icon="photo" loading={busy === 'read-photo'} onPress={() => readConfirmation(true)} testID="booking-read-photo" />
            </Row>
          </Card>
        ) : (
          <Text variant="caption" muted>
            Tripley Pro can read a confirmation for you.{' '}
            <Text variant="caption" color={t.primary} onPress={() => router.push('/pro')}>See Pro</Text>
          </Text>
        )
      ) : null}

      {note ? <Banner tone="success">{note}</Banner> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {list.length === 0 && docs.length === 0 ? (
        <Banner tone="info" icon="ticket" title="Nothing here yet">
          Add your flights, the stay and any tickets, so everyone has the times and codes, even offline.
        </Banner>
      ) : null}

      {list.map((b) => (
        <BookingCard
          key={b.id}
          tripId={id}
          booking={b}
          docs={docs.filter((d) => d.booking_id === b.id)}
          nameOf={nameOf}
          canEdit={active && (b.created_by === me || (isOrganizer && !b.private))}
          active={active}
          busy={busy}
          run={run}
          docRow={docRow}
        />
      ))}

      {loose.length ? (
        <Stack gap={space.sm}>
          <SectionTitle>Documents</SectionTitle>
          <Card>
            {loose.map(docRow)}
          </Card>
        </Stack>
      ) : null}
    </Screen>
  );
}

function BookingCard({
  tripId,
  booking: b,
  docs,
  nameOf,
  canEdit,
  active,
  busy,
  run,
  docRow,
}: {
  tripId: string;
  booking: Booking;
  docs: TripDocument[];
  nameOf: (uid: string) => string;
  canEdit: boolean;
  active: boolean;
  busy: string | null;
  run: (key: string, fn: () => Promise<void>) => Promise<void>;
  docRow: (doc: TripDocument) => React.ReactElement;
}) {
  const t = useTheme();
  const qc = useQueryClient();
  const k = kindInfo(b.kind);
  const when = bookingWhen(b, formatDate);
  const route = [b.from_place, b.to_place].filter(Boolean).join(' → ');
  return (
    <Card testID={`booking-${b.title}`}>
      <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
        <Text style={{ fontSize: 24 }}>{k.emoji}</Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="heading">{b.title}</Text>
          {when ? <Text muted>{when}</Text> : null}
          {route ? <Text variant="caption" muted>{route}</Text> : null}
          {b.address ? <Text variant="caption" faint numberOfLines={2}>{b.address}</Text> : null}
        </View>
        {canEdit ? (
          <Button title="Edit" kind="ghost" small icon="edit" onPress={() => router.push({ pathname: '/trip/[id]/booking/new', params: { id: tripId, bookingId: b.id } })} testID={`booking-edit-${b.title}`} />
        ) : null}
      </Row>
      {b.reference || b.provider ? (
        <View style={{ backgroundColor: t.surfaceAlt, borderRadius: radius.sm, padding: space.sm }}>
          <Text variant="caption" muted>{b.provider ?? k.label}</Text>
          {b.reference ? (
            <Text variant="heading" testID={`booking-ref-${b.title}`}>{b.reference}</Text>
          ) : null}
        </View>
      ) : null}
      <Text variant="caption" muted>
        {[b.traveller_ids.length ? `For ${b.traveller_ids.map(nameOf).join(', ')}` : b.private ? null : 'For everyone', b.private ? 'Only you can see this' : null].filter(Boolean).join(' · ')}
      </Text>
      {b.notes ? <Text variant="caption">{b.notes}</Text> : null}
      {docs.map(docRow)}
      {!b.private ? (
        b.itinerary_item_id ? (
          <Button title="In the plan" kind="ghost" small icon="calendar" onPress={() => router.push(`/trip/${tripId}/plan/${b.itinerary_item_id}`)} style={{ alignSelf: 'flex-start' }} testID={`booking-in-plan-${b.title}`} />
        ) : active ? (
          <Button
            title="Add to the plan"
            kind="secondary"
            small
            icon="calendar"
            loading={busy === `plan-${b.id}`}
            onPress={() =>
              run(`plan-${b.id}`, async () => {
                await addBookingToPlan(b.id);
                await Promise.all([qc.invalidateQueries({ queryKey: keys.bookings(tripId) }), qc.invalidateQueries({ queryKey: keys.itinerary(tripId) })]);
              })
            }
            style={{ alignSelf: 'flex-start' }}
            testID={`booking-plan-${b.title}`}
          />
        ) : null
      ) : null}
    </Card>
  );
}

function DocRow({
  doc,
  saved,
  canDelete,
  onOpen,
  onToggle,
  onDelete,
}: {
  doc: TripDocument;
  saved: boolean;
  canDelete: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <View testID={`doc-${doc.name}`}>
    <Row gap={space.xs} style={{ flexWrap: 'wrap', alignItems: 'center' }}>
      <Chip label={`${doc.mime === 'application/pdf' ? '📄' : '🖼️'} ${doc.name}`} onPress={onOpen} testID={`doc-open-${doc.name}`} />
      <Text variant="caption" faint>{[sizeText(doc.size_bytes), doc.private ? 'Only you' : null].filter(Boolean).join(' · ')}</Text>
      <Chip label={saved ? '✓ On this device' : 'Keep offline'} selected={saved} onPress={onToggle} testID={`doc-offline-${doc.name}`} />
      {canDelete ? <Chip label="Delete" onPress={onDelete} testID={`doc-delete-${doc.name}`} /> : null}
    </Row>
    </View>
  );
}
