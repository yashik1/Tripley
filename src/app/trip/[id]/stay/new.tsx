/**
 * Add a stay (or edit one with ?stayId=…): its name and address, check-in and
 * check-out, whether people pick their own bed, and its rooms (name, beds,
 * size). Removing a room with people in it frees their beds, after a warning.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack as RouterStack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';

import { DateTimeField } from '@/components/DateTimeField';
import { PlaceField } from '@/components/PlaceField';
import { Banner, Button, Card, Chip, Field, Loading, Row, Screen, Stack, Text } from '@/components/ui';
import { addRoom, createStay, deleteRoom, deleteStay, updateRoom, updateStay } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { isISODate } from '@/lib/format';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { keys, useStays } from '@/lib/queries';
import { ROOM_SIZES } from '@/lib/stays';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import type { Room, Stay } from '@/lib/types';
import { space, useTheme } from '@/theme';

type DraftRoom = { key: string; id: string | null; name: string; beds: number; size_weight: number; people: number };

let seq = 0;
const newKey = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

export default function StayEditor() {
  const id = useTripId();
  const { stayId } = useLocalSearchParams<{ stayId?: string }>();
  const { loading } = useTripData(id);
  const stays = useStays(id);
  if (loading || (stayId && stays.isLoading)) return <Loading />;
  const stay = stayId ? stays.data?.stays.find((s) => s.id === stayId) ?? null : null;
  if (stayId && !stay) {
    return (
      <Screen>
        <Banner tone="info" title="This stay was removed" />
        <Button title="Back" kind="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }
  const rooms = stay ? (stays.data?.rooms ?? []).filter((r) => r.stay_id === stay.id) : [];
  const guests = stay ? (stays.data?.guests ?? []).filter((g) => g.stay_id === stay.id) : [];
  return <Form key={stay?.id ?? 'new'} tripId={id} stay={stay} rooms={rooms} peopleIn={(roomId) => guests.filter((g) => g.room_id === roomId).length} />;
}

function Form({ tripId, stay, rooms, peopleIn }: { tripId: string; stay: Stay | null; rooms: Room[]; peopleIn: (roomId: string) => number }) {
  const t = useTheme();
  const qc = useQueryClient();
  const [name, setName] = useState(stay?.name ?? '');
  const [address, setAddress] = useState(stay?.address ?? '');
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(stay?.lat != null && stay.lng != null ? { lat: stay.lat, lng: stay.lng } : null);
  const [checkIn, setCheckIn] = useState(stay?.check_in ?? '');
  const [checkOut, setCheckOut] = useState(stay?.check_out ?? '');
  const [selfPick, setSelfPick] = useState(stay?.self_pick ?? true);
  const [draft, setDraft] = useState<DraftRoom[]>(() =>
    stay
      ? [...rooms]
          .sort((a, b) => a.position - b.position)
          .map((r) => ({ key: r.id, id: r.id, name: r.name, beds: r.beds, size_weight: Number(r.size_weight), people: peopleIn(r.id) }))
      : [
          { key: newKey(), id: null, name: 'Room 1', beds: 2, size_weight: 1, people: 0 },
          { key: newKey(), id: null, name: 'Room 2', beds: 2, size_weight: 1, people: 0 },
        ],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = (key: string, patch: Partial<DraftRoom>) => setDraft((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError('Give the stay a name, e.g. "Alfama flat".');
    if (checkIn && !isISODate(checkIn)) return setError('Pick the check-in day.');
    if (checkOut && !isISODate(checkOut)) return setError('Pick the check-out day.');
    if (checkIn && checkOut && checkOut < checkIn) return setError('Check-out has to be on or after check-in.');
    const list = draft.map((r) => ({ ...r, name: r.name.trim() })).filter((r) => r.name);
    if (new Set(list.map((r) => r.name.toLowerCase())).size !== list.length) return setError('Two rooms have the same name.');
    const tooSmall = list.find((r) => r.people > r.beds);
    if (tooSmall) return setError(`${tooSmall.people} people are in ${tooSmall.name}. Move someone out first, or keep more beds.`);
    const removed = rooms.filter((r) => !list.some((d) => d.id === r.id));
    const displaced = removed.reduce((n, r) => n + peopleIn(r.id), 0);
    if (displaced && !(await confirm('Remove rooms with people in them?', `${displaced === 1 ? 'One person loses their bed' : `${displaced} people lose their beds`}.`, 'Remove', true))) return;
    setBusy(true);
    try {
      const input = {
        name: name.trim(),
        address: address.trim() || null,
        lat: address.trim() && point ? point.lat : null,
        lng: address.trim() && point ? point.lng : null,
        check_in: checkIn || null,
        check_out: checkOut || null,
        self_pick: selfPick,
      };
      let stayId = stay?.id ?? null;
      if (stayId) await updateStay(stayId, input);
      else stayId = await createStay(tripId, input);
      for (const r of removed) await deleteRoom(r.id);
      for (const [i, r] of list.entries()) {
        const row = { name: r.name, beds: r.beds, size_weight: r.size_weight, position: i };
        if (r.id) await updateRoom(r.id, row);
        else await addRoom(stayId, row);
      }
      await qc.invalidateQueries({ queryKey: keys.stays(tripId) });
      if (router.canGoBack()) router.back();
      else router.replace(`/trip/${tripId}/stays`);
    } catch (e) {
      setError(isNetworkError(e) ? 'No connection. Try again when you’re back online.' : errorMessage(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!stay) return;
    if (!(await confirm(`Remove ${stay.name}?`, 'Its rooms and who sleeps where go too. A bill made from it stays.', 'Remove', true))) return;
    try {
      await deleteStay(stay.id);
      await qc.invalidateQueries({ queryKey: keys.stays(tripId) });
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Screen footer={<Button title={stay ? 'Save changes' : 'Add the stay'} icon="check" onPress={save} loading={busy} testID="stay-save" />}>
      <RouterStack.Screen options={{ title: stay ? 'Edit stay' : 'Add a stay' }} />
      <Field label="Name" testID="stay-name" value={name} onChangeText={setName} placeholder="Alfama flat" maxLength={80} />
      <PlaceField
        label="Address (optional)"
        value={address}
        onChangeText={(v) => {
          setAddress(v);
          setPoint(null);
        }}
        onPick={(r) => {
          setAddress(r.address || r.name);
          setPoint({ lat: r.lat, lng: r.lng });
        }}
        placeholder="Search the address or the hotel's name"
        testID="stay-address"
      />
      <Row gap={space.md} align="flex-start">
        <DateTimeField mode="date" label="Check-in" value={checkIn} onChangeText={setCheckIn} style={{ flex: 1 }} testID="stay-in" />
        <DateTimeField mode="date" label="Check-out" value={checkOut} onChangeText={setCheckOut} style={{ flex: 1 }} testID="stay-out" />
      </Row>
      <Card>
        <Row gap={space.md}>
          <View style={{ flex: 1 }}>
            <Text variant="label">People pick their own bed</Text>
            <Text variant="caption" muted>{selfPick ? 'Anyone can take a free bed.' : 'Only you (and the organizer) put people in rooms.'}</Text>
          </View>
          <Switch value={selfPick} onValueChange={setSelfPick} trackColor={{ true: t.primary, false: t.border }} thumbColor="#fff" accessibilityLabel="People pick their own bed" testID="stay-self-pick" />
        </Row>
      </Card>

      <Stack gap={space.sm}>
        <Text variant="label" muted>Rooms</Text>
        {draft.map((r, i) => (
          <Card key={r.key}>
            <Row gap={space.sm}>
              <Field value={r.name} onChangeText={(v) => edit(r.key, { name: v })} placeholder={`Room ${i + 1}`} maxLength={60} style={{ flex: 1 }} testID={`room-name-${i}`} />
              {draft.length > 1 ? <Button title="✕" kind="ghost" small onPress={() => setDraft((list) => list.filter((x) => x.key !== r.key))} testID={`room-remove-${i}`} /> : null}
            </Row>
            <Row gap={space.sm}>
              <Text variant="caption" muted style={{ flex: 1 }}>{`Beds${r.people ? ` (${r.people} in it)` : ''}`}</Text>
              <Button title="−" kind="secondary" small onPress={() => edit(r.key, { beds: Math.max(1, r.beds - 1) })} testID={`room-beds-down-${i}`} />
              <Text variant="label" testID={`room-beds-${i}`}>{String(r.beds)}</Text>
              <Button title="+" kind="secondary" small onPress={() => edit(r.key, { beds: Math.min(20, r.beds + 1) })} testID={`room-beds-up-${i}`} />
            </Row>
            <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
              {ROOM_SIZES.map((s) => (
                <Chip key={s.weight} label={s.label} selected={r.size_weight === s.weight} onPress={() => edit(r.key, { size_weight: s.weight })} testID={`room-size-${i}-${s.weight}`} />
              ))}
            </Row>
          </Card>
        ))}
        {draft.length < 30 ? (
          <Button
            title="Add a room"
            icon="add"
            kind="secondary"
            small
            onPress={() => setDraft((list) => [...list, { key: newKey(), id: null, name: `Room ${list.length + 1}`, beds: 2, size_weight: 1, people: 0 }])}
            testID="room-add"
            style={{ alignSelf: 'flex-start' }}
          />
        ) : null}
        <Text variant="caption" faint>Size decides each room’s share when you split the cost by room.</Text>
      </Stack>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {stay ? <Button title="Remove this stay" kind="ghost" icon="trash" onPress={remove} testID="stay-delete" /> : null}
    </Screen>
  );
}
