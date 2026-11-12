/**
 * Split a stay's cost by room: enter what it cost, choose by room (bigger rooms
 * carry more, shared inside the room) or by person (each pays by their room's
 * size), see exactly what each person pays, then continue to the ordinary bill
 * form with it filled in, to pick who paid and save.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Banner, Button, Card, Chip, Field, Loading, Row, Screen, Stack, Text } from '@/components/ui';
import { formatMoney, minorToInput, parseAmount } from '@/lib/currency';
import { firstName } from '@/lib/format';
import { useStays } from '@/lib/queries';
import { encodePrefill, stayItems, stayShares, withoutBed, type SplitBy } from '@/lib/stays';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { space } from '@/theme';

export default function SplitStay() {
  const id = useTripId();
  const { stayId } = useLocalSearchParams<{ stayId: string }>();
  const { trip, members, me, loading } = useTripData(id);
  const stays = useStays(id);
  const [totalText, setTotalText] = useState('');
  const [by, setBy] = useState<SplitBy>('room');
  if (loading || !trip || stays.isLoading) return <Loading />;
  const stay = stays.data?.stays.find((s) => s.id === stayId);
  if (!stay) {
    return (
      <Screen>
        <Banner tone="info" title="This stay was removed" />
        <Button title="Back" kind="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }
  const currency = trip.base_currency;
  const rooms = (stays.data?.rooms ?? []).filter((r) => r.stay_id === stay.id);
  const guests = (stays.data?.guests ?? []).filter((g) => g.stay_id === stay.id);
  const total = parseAmount(totalText, currency);
  const items = total && total > 0 ? stayItems(total, rooms, guests, by) : [];
  const shares = stayShares(items);
  const nameOf = (uid: string) => (uid === me ? 'You' : firstName(members.find((m) => m.user_id === uid)?.profile.display_name || 'Friend'));
  const left = withoutBed(
    members.map((m) => m.user_id),
    guests,
  );

  const next = () =>
    router.push({
      pathname: '/trip/[id]/bill/new',
      params: {
        id,
        prefill: encodePrefill({ title: stay.name, stayId: stay.id, items: items.map((it) => ({ name: it.name, minor: it.minor, people: it.people })) }),
      },
    });

  return (
    <Screen footer={<Button title="Continue to the bill" icon="bills" onPress={next} disabled={items.length === 0} testID="stay-split-next" />}>
      <Stack gap={space.xs}>
        <Text variant="title">{`Split ${stay.name}`}</Text>
        <Text muted>What did the whole stay cost? You’ll pick who paid on the next screen.</Text>
      </Stack>
      <Field
        label={`Total (${currency})`}
        testID="stay-split-total"
        value={totalText}
        onChangeText={setTotalText}
        keyboardType="decimal-pad"
        placeholder={minorToInput(60000, currency)}
      />
      <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
        <Chip label="By room" selected={by === 'room'} onPress={() => setBy('room')} testID="stay-split-by-room" />
        <Chip label="By person" selected={by === 'person'} onPress={() => setBy('person')} testID="stay-split-by-person" />
      </Row>
      <Text variant="caption" muted>
        {by === 'room'
          ? 'Bigger rooms pay more, and people sharing a room split it.'
          : 'Everyone pays by their room’s size: a bed in a bigger room costs more.'}
      </Text>
      {items.length ? (
        <Card testID="stay-split-preview">
          {items.map((it) => (
            <Row key={it.name} style={{ justifyContent: 'space-between' }}>
              <Text variant="label">{it.name}</Text>
              <Text>{formatMoney(it.minor, currency)}</Text>
            </Row>
          ))}
          <Text variant="caption" muted style={{ marginTop: space.sm }}>Each person pays</Text>
          {shares.map((s) => (
            <Row key={s.userId} style={{ justifyContent: 'space-between' }}>
              <Text muted>{nameOf(s.userId)}</Text>
              <Text testID={`stay-split-share-${nameOf(s.userId)}`}>{formatMoney(s.totalMinor, currency)}</Text>
            </Row>
          ))}
        </Card>
      ) : guests.length === 0 ? (
        <Banner tone="info">Nobody has a bed in this stay yet.</Banner>
      ) : null}
      {left.length && guests.length ? (
        <Banner tone="warning">{`Not included (no bed): ${left.map(nameOf).join(', ')}.`}</Banner>
      ) : null}
    </Screen>
  );
}
