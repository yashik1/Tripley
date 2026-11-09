import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { RefreshControl, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { MoneySwitch } from '@/components/MoneySwitch';
import { SpendingChart } from '@/components/SpendingChart';
import { paidPerMember, spendPerMember, type ShareRow } from '@/lib/balances';
import { Avatar, Banner, Button, Card, EmptyState, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { formatMoney } from '@/lib/currency';
import { formatDate, timeAgo } from '@/lib/format';
import { discardQueuedBill, flushOutbox, retryQueuedBill, useOutbox } from '@/lib/outbox';
import { keys, useBills } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { space, useTheme } from '@/theme';

/** Each person's share of each bill, from the bill list (no extra request). */
function toShareRows(bills: { id: string; title: string; paid_by: string; bill_shares: { user_id: string; amount_base_minor: number }[] }[]): ShareRow[] {
  return bills.flatMap((b) =>
    b.bill_shares.map((s) => ({ billId: b.id, billTitle: b.title, paidBy: b.paid_by, userId: s.user_id, amountBaseMinor: s.amount_base_minor })),
  );
}

export default function BillsTab() {
  const id = useTripId();
  const t = useTheme();
  const { trip, me, nameOf, byId, members } = useTripData(id);
  const bills = useBills(id);
  const qc = useQueryClient();
  const waiting = useOutbox(me, id);
  const base = trip?.base_currency ?? 'USD';
  const syncNow = async () => {
    await flushOutbox(me);
    await Promise.all([qc.invalidateQueries({ queryKey: keys.bills(id) }), qc.invalidateQueries({ queryKey: keys.shares(id) })]);
  };
  const list = useMemo(() => bills.data ?? [], [bills.data]);
  const total = list.reduce((a, b) => a + b.total_base_minor, 0);
  const spendRows = useMemo(() => {
    const rows = toShareRows(list);
    const paid = paidPerMember(rows);
    const share = spendPerMember(rows);
    return members
      .map((m) => ({ userId: m.user_id, name: m.profile.display_name || 'Friend', url: m.profile.avatar_url, paid: paid.get(m.user_id) ?? 0, share: share.get(m.user_id) ?? 0 }))
      .filter((r) => r.paid || r.share);
  }, [list, members]);
  const mine = list.reduce((a, b) => a + (b.bill_shares.find((s) => s.user_id === me)?.amount_base_minor ?? 0), 0);

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={bills.isRefetching} onRefresh={() => { bills.refetch(); }} />}
      footer={<Button title="Add a bill" icon="add" onPress={() => router.push(`/trip/${id}/bill/new`)} testID="add-bill" />}>
      <MoneySwitch tripId={id} value="bills" />
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
      {list.length > 0 && spendRows.length > 1 ? (
        <Card testID="spending-chart">
          <Text variant="heading">Who paid, whose share</Text>
          <SpendingChart rows={spendRows} currency={base} me={me} />
        </Card>
      ) : null}

      {waiting.length > 0 ? (
        <Stack gap={space.sm}>
          <Banner
            tone={waiting.some((w) => w.error) ? 'warning' : 'info'}
            icon="cloudOff"
            title={`${waiting.length} ${waiting.length === 1 ? 'bill' : 'bills'} saved on this device`}
            action={<Button title="Sync now" small kind="secondary" onPress={syncNow} testID="sync-now" />}>
            They&apos;re sent as soon as you&apos;re back online, and only once.
          </Banner>
          {waiting.map((w) => (
            <Card key={w.clientId} style={{ borderStyle: 'dashed' }}>
              <Row gap={space.md}>
                <Icon name="cloudOff" size={22} color={w.error ? t.warning : t.textFaint} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontWeight: '600' }} numberOfLines={1} testID="queued-bill">{w.title}</Text>
                  <Text variant="caption" color={w.error ? t.warning : t.textMuted}>
                    {w.error ? `Couldn’t save: ${w.error}` : `Waiting to sync · added ${timeAgo(w.queuedAt)}`}
                  </Text>
                </View>
                <Text variant="money">{formatMoney(w.totalMinor, w.currency)}</Text>
              </Row>
              {w.error ? (
                <Row gap={space.sm}>
                  <Button title="Try again" small onPress={async () => { await retryQueuedBill(w.clientId); await syncNow(); }} />
                  <Button title="Discard" small kind="ghost" onPress={() => discardQueuedBill(w.clientId)} />
                </Row>
              ) : null}
            </Card>
          ))}
        </Stack>
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
                      {b.kitty_id ? '💵 From the kitty' : `${nameOf(b.paid_by)} paid`} · {formatDate(b.bill_date)}
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
