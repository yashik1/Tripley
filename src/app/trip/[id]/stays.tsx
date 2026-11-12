/**
 * Where everyone sleeps: the trip's stays, their rooms and beds, and who is in
 * which room. Tap "Sleep here" to take a bed (it moves you out of your old
 * room); the organizer, or whoever added the stay, can put anyone anywhere.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Banner, Button, Card, Chip, Loading, Row, Screen, Stack, Text } from '@/components/ui';
import { leaveBed, pickBed } from '@/lib/api';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { firstName, formatDateRange } from '@/lib/format';
import { keys, useStays } from '@/lib/queries';
import { roomsWithGuests, sizeLabel, withoutBed } from '@/lib/stays';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import type { Stay, StaysData } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

export default function Stays() {
  const id = useTripId();
  const { members, me, isOrganizer, active, loading } = useTripData(id);
  const stays = useStays(id);
  if (loading || stays.isLoading) return <Loading />;
  const data = stays.data ?? { stays: [], rooms: [], guests: [] };
  const nameOf = (uid: string) => (uid === me ? 'You' : firstName(members.find((m) => m.user_id === uid)?.profile.display_name || 'Friend'));

  return (
    <Screen
      footer={
        active ? (
          <Button title="Add a stay" icon="add" kind={data.stays.length ? 'secondary' : 'primary'} onPress={() => router.push(`/trip/${id}/stay/new`)} testID="stay-add" />
        ) : undefined
      }>
      <Stack gap={space.xs}>
        <Text variant="title">Where everyone sleeps</Text>
        <Text muted>Add the flat or hotel, its rooms and beds. Everyone picks a bed, and the cost can be split by room.</Text>
      </Stack>
      {stays.isError ? <Banner tone="danger">{errorMessage(stays.error)}</Banner> : null}
      {data.stays.length === 0 ? (
        <Banner tone="info" icon="bed" title="No stays yet">
          {active ? 'Add where you’re staying, then everyone can pick a bed.' : 'Nobody added where they stayed.'}
        </Banner>
      ) : (
        data.stays.map((s) => (
          <StayCard
            key={s.id}
            tripId={id}
            stay={s}
            data={data}
            me={me}
            memberIds={members.map((m) => m.user_id)}
            nameOf={nameOf}
            arranger={isOrganizer || s.created_by === me}
            active={active}
          />
        ))
      )}
    </Screen>
  );
}

function StayCard({
  tripId,
  stay,
  data,
  me,
  memberIds,
  nameOf,
  arranger,
  active,
}: {
  tripId: string;
  stay: Stay;
  data: StaysData;
  me: string;
  memberIds: string[];
  nameOf: (uid: string) => string;
  arranger: boolean;
  active: boolean;
}) {
  const t = useTheme();
  const qc = useQueryClient();
  const guests = data.guests.filter((g) => g.stay_id === stay.id);
  const rooms = roomsWithGuests(
    data.rooms.filter((r) => r.stay_id === stay.id),
    guests,
  );
  const noBed = withoutBed(memberIds, guests);
  const myRoom = guests.find((g) => g.user_id === me)?.room_id ?? null;
  const [placing, setPlacing] = useState<string | null>(null); // room id the arranger is filling
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canPickSelf = active && (stay.self_pick || arranger);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: keys.stays(tripId) });
    } catch (e) {
      setError(isNetworkError(e) ? 'No connection. Try again when you’re back online.' : errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card testID={`stay-${stay.name}`}>
      <Row gap={space.sm} style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text variant="heading">{stay.name}</Text>
          {stay.check_in ? <Text variant="caption" muted>{formatDateRange(stay.check_in, stay.check_out)}</Text> : null}
          {stay.address ? <Text variant="caption" faint numberOfLines={2}>{stay.address}</Text> : null}
        </View>
        {arranger && active ? (
          <Button title="Edit" kind="ghost" small icon="edit" onPress={() => router.push({ pathname: '/trip/[id]/stay/new', params: { id: tripId, stayId: stay.id } })} testID={`stay-edit-${stay.name}`} />
        ) : null}
      </Row>
      {!stay.self_pick ? <Text variant="caption" muted>The organizer is choosing rooms for this stay.</Text> : null}

      {rooms.length === 0 ? (
        <Text muted>{arranger ? 'Add the rooms and how many beds each has.' : 'No rooms added yet.'}</Text>
      ) : (
        rooms.map((r) => {
          const full = r.people.length >= r.beds;
          const mine = myRoom === r.id;
          return (
            <View
              key={r.id}
              testID={`room-${r.name}`}
              style={{ borderWidth: 1, borderColor: mine ? t.primary : t.border, borderRadius: radius.md, padding: space.sm, gap: space.xs }}>
              <Row gap={space.sm} style={{ justifyContent: 'space-between' }}>
                <Row gap={space.xs}>
                  <Icon name="bed" size={18} color={t.textMuted} />
                  <Text variant="label">{r.name}</Text>
                </Row>
                <Text variant="caption" muted>{`${r.people.length}/${r.beds} beds · ${sizeLabel(r.size_weight)}`}</Text>
              </Row>
              <Text muted>{r.people.length ? r.people.map(nameOf).join(', ') : 'Nobody yet'}</Text>
              <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
                {mine ? (
                  canPickSelf ? (
                    <Button title="Leave this room" kind="ghost" small loading={busy === `leave-${r.id}`} onPress={() => run(`leave-${r.id}`, () => leaveBed(stay.id))} testID={`room-leave-${r.name}`} />
                  ) : null
                ) : canPickSelf && !full ? (
                  <Button
                    title={myRoom ? 'Move here' : 'Sleep here'}
                    small
                    loading={busy === `pick-${r.id}`}
                    onPress={() => run(`pick-${r.id}`, () => pickBed(r.id))}
                    testID={`room-pick-${r.name}`}
                  />
                ) : null}
                {arranger && active && !full ? (
                  <Button
                    title={placing === r.id ? 'Done' : 'Put someone here'}
                    kind="secondary"
                    small
                    onPress={() => setPlacing(placing === r.id ? null : r.id)}
                    testID={`room-place-${r.name}`}
                  />
                ) : null}
                {arranger && active
                  ? r.people
                      .filter((u) => u !== me)
                      .map((u) => (
                        <Chip key={u} label={`✕ ${nameOf(u)}`} onPress={() => run(`out-${u}`, () => leaveBed(stay.id, u))} testID={`room-out-${r.name}-${nameOf(u)}`} />
                      ))
                  : null}
              </Row>
              {placing === r.id ? (
                <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
                  {memberIds
                    .filter((u) => !r.people.includes(u))
                    .map((u) => (
                      <Chip
                        key={u}
                        label={`${nameOf(u)}${noBed.includes(u) ? '' : ' (move)'}`}
                        onPress={() => run(`put-${u}`, async () => {
                          await pickBed(r.id, u === me ? undefined : u);
                          if (r.people.length + 1 >= r.beds) setPlacing(null);
                        })}
                        testID={`room-put-${r.name}-${nameOf(u)}`}
                      />
                    ))}
                </Row>
              ) : null}
            </View>
          );
        })
      )}

      {rooms.length ? (
        <Text variant="caption" muted testID={`stay-nobed-${stay.name}`}>
          {noBed.length ? `No bed yet: ${noBed.map(nameOf).join(', ')}` : 'Everyone has a bed.'}
        </Text>
      ) : null}

      {guests.length ? (
        <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
          {stay.bill_id ? (
            <Button title="See the bill" kind="secondary" small icon="bills" onPress={() => router.push(`/trip/${tripId}/bill/${stay.bill_id}`)} testID={`stay-bill-${stay.name}`} />
          ) : null}
          {active ? (
            <Button
              title={stay.bill_id ? 'Split it again' : 'Split the cost by room'}
              kind={stay.bill_id ? 'ghost' : 'secondary'}
              small
              icon="wallet"
              onPress={() => router.push({ pathname: '/trip/[id]/stay/split', params: { id: tripId, stayId: stay.id } })}
              testID={`stay-split-${stay.name}`}
            />
          ) : null}
        </Row>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Card>
  );
}

