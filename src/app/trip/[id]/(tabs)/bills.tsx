import { router } from 'expo-router';
import { RefreshControl, View } from 'react-native';

import { Avatar, Button, Card, EmptyState, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/format';
import { useBills } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { space, useTheme } from '@/theme';

export default function BillsTab() {
  const id = useTripId();
  const t = useTheme();
  const { trip, me, nameOf, byId } = useTripData(id);
  const bills = useBills(id);
  const base = trip?.base_currency ?? 'USD';
  const list = bills.data ?? [];
  const total = list.reduce((a, b) => a + b.total_base_minor, 0);
  const mine = list.reduce((a, b) => a + (b.bill_shares.find((s) => s.user_id === me)?.amount_base_minor ?? 0), 0);

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={bills.isRefetching} onRefresh={() => { bills.refetch(); }} />}
      footer={<Button title="Add a bill" icon="add" onPress={() => router.push(`/trip/${id}/bill/new`)} testID="add-bill" />}>
      {list.length > 0 ? (
        <Row gap={space.md}>
          <Card style={{ flex: 1 }}>
            <Text variant="caption" muted>Trip total</Text>
            <Text variant="money">{formatMoney(total, base)}</Text>
          </Card>
          <Card style={{ flex: 1 }}>
            <Text variant="caption" muted>Your share</Text>
            <Text variant="money">{formatMoney(mine, base)}</Text>
          </Card>
        </Row>
      ) : null}

      {bills.isLoading ? null : list.length === 0 ? (
        <EmptyState
          icon="bills"
          title="No bills yet"
          body="Whoever pays adds the bill, taps who had what, and Tripley works out everyone's share."
        />
      ) : (
        <Stack gap={space.sm}>
          <SectionTitle>Bills</SectionTitle>
          {list.map((b) => {
            const myShare = b.bill_shares.find((s) => s.user_id === me)?.amount_base_minor ?? 0;
            const payer = byId.get(b.paid_by);
            return (
              <Card key={b.id} onPress={() => router.push(`/trip/${id}/bill/${b.id}`)}>
                <Row gap={space.md} align="flex-start">
                  <Avatar id={b.paid_by} name={payer?.profile.display_name ?? '?'} url={payer?.profile.avatar_url} size={36} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontWeight: '600' }} numberOfLines={1}>{b.title}</Text>
                    <Text variant="caption" muted>
                      {nameOf(b.paid_by)} paid · {formatDate(b.bill_date)}
                      {b.source === 'ai' ? ' · scanned' : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Text variant="money">{formatMoney(b.total_minor, b.currency)}</Text>
                    {b.paid_by === me ? (
                      <Text variant="caption" color={t.success}>You paid</Text>
                    ) : myShare > 0 ? (
                      <Text variant="caption" color={t.danger}>Your share {formatMoney(myShare, base)}</Text>
                    ) : (
                      <Text variant="caption" faint>Not involved</Text>
                    )}
                  </View>
                </Row>
              </Card>
            );
          })}
        </Stack>
      )}
    </Screen>
  );
}
