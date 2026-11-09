import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { Avatar, Banner, Button, Card, Divider, ListRow, Loading, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { deleteBill, receiptUrl } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { formatMoney } from '@/lib/currency';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { keys, useBill } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { radius, space, useTheme } from '@/theme';

export default function BillDetail() {
  const id = useTripId();
  const { billId } = useLocalSearchParams<{ billId: string }>();
  const t = useTheme();
  const qc = useQueryClient();
  const { trip, me, byId, nameOf, isOrganizer } = useTripData(id);
  const bill = useBill(billId);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (bill.data?.receipt_path) receiptUrl(bill.data.receipt_path).then(setPhoto);
  }, [bill.data?.receipt_path]);

  if (bill.isLoading) return <Loading />;
  const b = bill.data;
  if (!b || !trip) {
    return (
      <Screen>
        <Text muted>This bill was deleted.</Text>
      </Screen>
    );
  }
  const base = trip.base_currency;
  const canEdit = b.created_by === me || b.paid_by === me || isOrganizer;
  const foreign = b.currency !== base;
  const shareFor = (userId: string) => b.bill_shares.find((s) => s.user_id === userId);

  const remove = async () => {
    if (!(await confirm('Delete this bill?', 'Everyone’s balances will be updated.', 'Delete', true))) return;
    setBusy(true);
    try {
      await deleteBill(b.id);
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.bills(id) }),
        qc.invalidateQueries({ queryKey: keys.shares(id) }),
      ]);
      router.back();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Row gap={space.md} align="flex-start">
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="heading">{b.title}</Text>
            <Text variant="caption" muted>
              {b.kitty_id ? `Paid from the kitty (${nameOf(b.paid_by)} had it)` : `${nameOf(b.paid_by)} paid`} · {formatDate(b.bill_date)}
              {b.source === 'ai' ? ' · read from receipt' : ''}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="money">{formatMoney(b.total_minor, b.currency)}</Text>
            {foreign ? <Text variant="caption" muted>{formatMoney(b.total_base_minor, base)}</Text> : null}
          </View>
        </Row>
        {foreign ? (
          <Text variant="caption" faint testID="fx-lock">
            🔒 1 {b.currency} = {Number(b.fx_rate)} {base}
            {b.fx_source === 'ecb' ? ' · European Central Bank rate' : b.fx_source === 'manual' ? ' · rate entered by hand' : ''}
            {b.fx_locked_at ? ` · locked ${formatDate(b.fx_locked_at.slice(0, 10))}` : ''}. Shares stay in {base} at this rate.
          </Text>
        ) : null}
        {photo ? (
          <Pressable onPress={() => Linking.openURL(photo)}>
            <Image source={{ uri: photo }} style={{ width: '100%', height: 220, borderRadius: radius.md, backgroundColor: t.surfaceAlt }} contentFit="cover" />
          </Pressable>
        ) : null}
        {b.notes ? <Text muted>{b.notes}</Text> : null}
      </Card>

      <Stack gap={space.sm}>
        <SectionTitle>Shares</SectionTitle>
        <Card>
          {b.bill_shares
            .slice()
            .sort((x, y) => y.amount_minor - x.amount_minor)
            .map((s) => {
              const m = byId.get(s.user_id);
              return (
                <ListRow
                  key={s.user_id}
                  left={<Avatar id={s.user_id} name={m?.profile.display_name ?? '?'} url={m?.profile.avatar_url} size={32} />}
                  title={nameOf(s.user_id)}
                  subtitle={s.user_id === b.paid_by ? 'Paid the bill' : `Owes ${nameOf(b.paid_by)}`}
                  right={
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text variant="money">{formatMoney(foreign ? s.amount_base_minor : s.amount_minor, base)}</Text>
                      {foreign ? <Text variant="caption" muted>{formatMoney(s.amount_minor, b.currency)}</Text> : null}
                    </View>
                  }
                />
              );
            })}
        </Card>
      </Stack>

      {b.split_mode === 'itemized' && b.bill_items.length > 0 ? (
        <Stack gap={space.sm}>
          <SectionTitle>Items</SectionTitle>
          <Card>
            {b.bill_items.map((it, i) => (
              <View key={it.id}>
                {i > 0 ? <Divider /> : null}
                <ListRow
                  title={it.name || `Item ${i + 1}`}
                  subtitle={it.bill_item_shares
                    .map((s) => `${nameOf(s.user_id)}${s.weight > 1 ? ` ×${s.weight}` : ''}`)
                    .join(', ')}
                  right={<Text variant="money">{formatMoney(it.line_total_minor, b.currency)}</Text>}
                />
              </View>
            ))}
            {[
              ['Tax', b.tax_minor],
              ['Service', b.service_minor],
              ['Tip', b.tip_minor],
              ['Discount', -b.discount_minor],
            ]
              .filter(([, v]) => v !== 0)
              .map(([label, v]) => (
                <Row key={label as string} style={{ justifyContent: 'space-between' }}>
                  <Text muted>{label}</Text>
                  <Text variant="money" color={(v as number) < 0 ? t.success : t.text}>
                    {(v as number) < 0 ? '−' : ''}
                    {formatMoney(Math.abs(v as number), b.currency)}
                  </Text>
                </Row>
              ))}
          </Card>
        </Stack>
      ) : (
        <Text variant="caption" muted>Split equally between {b.bill_shares.length} people.</Text>
      )}

      {shareFor(me) && b.paid_by !== me ? (
        <Banner tone="info">
          Your share is {formatMoney(shareFor(me)!.amount_base_minor, base)}. Settle up with {nameOf(b.paid_by)} from the Balances tab.
        </Banner>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {canEdit ? (
        <Row>
          <Button
            title="Edit"
            icon="edit"
            kind="secondary"
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/trip/[id]/bill/new', params: { id, billId: b.id } })}
          />
          <Button title="Delete" icon="trash" kind="danger" style={{ flex: 1 }} onPress={remove} loading={busy} />
        </Row>
      ) : null}
    </Screen>
  );
}
