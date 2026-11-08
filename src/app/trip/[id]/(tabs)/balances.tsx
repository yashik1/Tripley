import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';

import { Avatar, Banner, Button, Card, EmptyState, ListRow, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { respondToSettlement, toSettlementRows, undoSettlement } from '@/lib/api';
import { computePairBalances, summarizeForUser } from '@/lib/balances';
import { formatMoney } from '@/lib/currency';
import { errorMessage } from '@/lib/errors';
import { timeAgo } from '@/lib/format';
import { keys, useSettlements, useShareRows } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { space, useTheme } from '@/theme';

export default function BalancesTab() {
  const id = useTripId();
  const t = useTheme();
  const qc = useQueryClient();
  const { trip, me, nameOf, byId } = useTripData(id);
  const shares = useShareRows(id);
  const settlements = useSettlements(id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = trip?.base_currency ?? 'USD';

  const pairs = useMemo(
    () => computePairBalances(shares.data ?? [], toSettlementRows(settlements.data ?? [])),
    [shares.data, settlements.data],
  );
  const mine = summarizeForUser(pairs, me);
  const others = pairs.filter((p) => p.from !== me && p.to !== me);
  const toConfirm = (settlements.data ?? []).filter((s) => s.to_user === me && s.status === 'paid');
  const history = (settlements.data ?? []).slice(0, 30);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: keys.settlements(id) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const avatarFor = (userId: string, size = 36) => {
    const m = byId.get(userId);
    return <Avatar id={userId} name={m?.profile.display_name ?? '?'} url={m?.profile.avatar_url} size={size} />;
  };

  const loading = shares.isLoading || settlements.isLoading;

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={shares.isRefetching || settlements.isRefetching}
          onRefresh={() => {
            shares.refetch();
            settlements.refetch();
          }}
        />
      }>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {loading ? null : (
        <Card style={{ alignItems: 'center' }}>
          <Text variant="caption" muted>
            {mine.netMinor > 0 ? 'Overall you are owed' : mine.netMinor < 0 ? 'Overall you owe' : 'You are all settled up'}
          </Text>
          <Text variant="title" color={mine.netMinor > 0 ? t.success : mine.netMinor < 0 ? t.danger : t.text} testID="net-balance">
            {formatMoney(Math.abs(mine.netMinor), base)}
          </Text>
        </Card>
      )}

      {toConfirm.length > 0 ? (
        <Stack gap={space.sm}>
          <SectionTitle>Confirm payments</SectionTitle>
          {toConfirm.map((s) => (
            <Card key={s.id}>
              <Row gap={space.md}>
                {avatarFor(s.from_user)}
                <View style={{ flex: 1 }}>
                  <Text>
                    <Text style={{ fontWeight: '600' }}>{nameOf(s.from_user)}</Text> says they paid you{' '}
                    <Text style={{ fontWeight: '600' }}>{formatMoney(s.amount_base_minor, base)}</Text>
                  </Text>
                  <Text variant="caption" muted>
                    {s.method ? `${s.method} · ` : ''}
                    {timeAgo(s.created_at)}
                  </Text>
                </View>
              </Row>
              <Row>
                <Button
                  title="Got it"
                  icon="check"
                  small
                  style={{ flex: 1 }}
                  loading={busy === `c${s.id}`}
                  onPress={() => act(`c${s.id}`, () => respondToSettlement(s.id, 'confirmed'))}
                />
                <Button
                  title="Not received"
                  kind="secondary"
                  small
                  style={{ flex: 1 }}
                  loading={busy === `d${s.id}`}
                  onPress={() => act(`d${s.id}`, () => respondToSettlement(s.id, 'disputed'))}
                />
              </Row>
            </Card>
          ))}
        </Stack>
      ) : null}

      {mine.owes.length > 0 ? (
        <Stack gap={space.sm}>
          <SectionTitle>You owe</SectionTitle>
          <Card>
            {mine.owes.map((p) => (
              <ListRow
                key={p.to}
                left={avatarFor(p.to)}
                title={nameOf(p.to)}
                subtitle={`${p.breakdown.filter((l) => l.kind === 'bill').length} bills`}
                right={
                  <Row gap={space.sm}>
                    <Text variant="money" color={t.danger}>{formatMoney(p.amountMinor, base)}</Text>
                    <Button title="Pay" small onPress={() => router.push(`/trip/${id}/settle/${p.to}`)} testID={`pay-${p.to}`} />
                  </Row>
                }
              />
            ))}
          </Card>
        </Stack>
      ) : null}

      {mine.owed.length > 0 ? (
        <Stack gap={space.sm}>
          <SectionTitle>Owed to you</SectionTitle>
          <Card>
            {mine.owed.map((p) => (
              <ListRow
                key={p.from}
                left={avatarFor(p.from)}
                title={nameOf(p.from)}
                subtitle="Tap to record a cash payment"
                onPress={() => router.push(`/trip/${id}/settle/${p.from}`)}
                right={<Text variant="money" color={t.success}>{formatMoney(p.amountMinor, base)}</Text>}
                chevron
              />
            ))}
          </Card>
        </Stack>
      ) : null}

      {!loading && pairs.length === 0 && toConfirm.length === 0 ? (
        <EmptyState icon="balances" title="Nothing to settle" body="When someone adds a bill, who owes whom shows up here." />
      ) : null}

      {others.length > 0 ? (
        <Stack gap={space.sm}>
          <SectionTitle>Between others</SectionTitle>
          <Card>
            {others.map((p) => (
              <ListRow
                key={`${p.from}-${p.to}`}
                left={avatarFor(p.from, 28)}
                title={`${nameOf(p.from)} owes ${nameOf(p.to)}`}
                right={<Text variant="money">{formatMoney(p.amountMinor, base)}</Text>}
              />
            ))}
          </Card>
        </Stack>
      ) : null}

      {history.length > 0 ? (
        <Stack gap={space.sm}>
          <SectionTitle>Payments</SectionTitle>
          <Card>
            {history.map((s) => (
              <ListRow
                key={s.id}
                title={`${nameOf(s.from_user)} → ${nameOf(s.to_user)}`}
                subtitle={`${s.status === 'confirmed' ? 'Confirmed' : s.status === 'disputed' ? 'Not received' : 'Waiting for confirmation'} · ${timeAgo(s.created_at)}`}
                right={
                  <Row gap={space.sm}>
                    <Text variant="money" color={s.status === 'disputed' ? t.textFaint : t.text}>
                      {formatMoney(s.amount_base_minor, base)}
                    </Text>
                    {s.from_user === me && s.status === 'paid' ? (
                      <Button
                        title="Undo"
                        kind="ghost"
                        small
                        loading={busy === `u${s.id}`}
                        onPress={() => act(`u${s.id}`, () => undoSettlement(s.id))}
                      />
                    ) : null}
                  </Row>
                }
              />
            ))}
          </Card>
        </Stack>
      ) : null}
    </Screen>
  );
}
