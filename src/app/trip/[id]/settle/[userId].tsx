import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Avatar, Banner, Button, Card, Chip, Field, ListRow, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { markPaid, recordPaymentReceived, toSettlementRows } from '@/lib/api';
import { computePairBalances } from '@/lib/balances';
import { formatMoney, minorToInput, parseAmount } from '@/lib/currency';
import { errorMessage } from '@/lib/errors';
import { paymentOptions } from '@/lib/payment-links';
import { keys, useSettlements, useShareRows } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { space, useTheme } from '@/theme';

const METHODS = ['UPI', 'PhonePe', 'Paytm', 'Venmo', 'Zelle', 'PayPal', 'Revolut', 'Monzo', 'Cash App', 'Wise', 'Bank transfer', 'Cash', 'Other'];

export default function SettleUp() {
  const id = useTripId();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const t = useTheme();
  const qc = useQueryClient();
  const { trip, me, byId, nameOf } = useTripData(id);
  const shares = useShareRows(id);
  const settlements = useSettlements(id);
  const base = trip?.base_currency ?? 'USD';
  const other = byId.get(userId);
  const otherName = nameOf(userId);

  const pair = useMemo(
    () =>
      computePairBalances(shares.data ?? [], toSettlementRows(settlements.data ?? [])).find(
        (p) => (p.from === me && p.to === userId) || (p.from === userId && p.to === me),
      ),
    [shares.data, settlements.data, me, userId],
  );
  const iOwe = pair?.from === me;
  const owed = pair?.amountMinor ?? 0;

  const [amountText, setAmountText] = useState<string | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountValue = amountText ?? (owed ? minorToInput(owed, base) : '');

  const options = paymentOptions(other?.profile.payment_handles, otherName, owed, base, trip ? `Tripley: ${trip.name}` : 'Tripley');

  const submit = async () => {
    const amount = parseAmount(amountValue, base);
    if (!amount || amount <= 0) return setError('Enter the amount you paid.');
    setBusy(true);
    setError(null);
    try {
      if (iOwe) {
        await markPaid({ trip_id: id, to_user: userId, amount_base_minor: amount, method, note: note.trim() || null });
      } else {
        await recordPaymentReceived({ trip_id: id, from_user: userId, amount_base_minor: amount, method, note: note.trim() || null });
      }
      await qc.invalidateQueries({ queryKey: keys.settlements(id) });
      router.back();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  if (!pair) {
    return (
      <Screen>
        <Card style={{ alignItems: 'center' }}>
          <Avatar id={userId} name={other?.profile.display_name ?? '?'} url={other?.profile.avatar_url} size={56} />
          <Text variant="heading">You and {otherName} are settled up</Text>
        </Card>
        <Button title="Back to balances" kind="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen footer={<Button title={iOwe ? 'Mark as paid' : 'Record payment received'} icon="check" onPress={submit} loading={busy} testID="mark-paid" />}>
      <Card style={{ alignItems: 'center' }}>
        <Avatar id={userId} name={other?.profile.display_name ?? '?'} url={other?.profile.avatar_url} size={56} />
        <Text muted>{iOwe ? `You owe ${otherName}` : `${otherName} owes you`}</Text>
        <Text variant="title" color={iOwe ? t.danger : t.success}>{formatMoney(owed, base)}</Text>
      </Card>

      {iOwe ? (
        <Stack gap={space.sm}>
          <SectionTitle>1. Pay {otherName.split(' ')[0]}</SectionTitle>
          {options.length === 0 ? (
            <Banner tone="info">
              {otherName} hasn&apos;t added payment details yet. Pay them however you usually do (cash, bank transfer…), then mark it as paid.
            </Banner>
          ) : (
            <Card>
              {options.map((o) => (
                <View key={o.kind} style={{ gap: space.sm }}>
                  <ListRow
                    title={o.label}
                    subtitle={o.prefillsAmount ? `${o.copyText} · amount filled in` : o.copyText}
                    right={
                      <Row gap={space.xs}>
                        <Button
                          title="Copy"
                          kind="ghost"
                          small
                          onPress={() => Clipboard.setStringAsync(o.copyText)}
                        />
                        {o.url ? (
                          <Button
                            title="Open"
                            small
                            testID={`pay-${o.kind}`}
                            onPress={() => {
                              setMethod(o.kind === 'sepa' ? 'Bank transfer' : o.label.split(' ')[0]);
                              Linking.openURL(o.url!).catch(() => setError(`Couldn't open ${o.label}. Is the app installed?`));
                            }}
                          />
                        ) : null}
                      </Row>
                    }
                  />
                  {o.qr ? (
                    <View style={{ alignItems: 'center', gap: space.xs, paddingBottom: space.sm }} testID="sepa-qr">
                      <View style={{ padding: 12, backgroundColor: '#fff', borderRadius: 12 }}>
                        <QRCode value={o.qr} size={170} ecl="M" />
                      </View>
                      <Text variant="caption" muted center>
                        Scan in your banking app: name, IBAN, amount and reference fill in by themselves.
                      </Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </Card>
          )}
          <SectionTitle>2. Tell {otherName.split(' ')[0]} you paid</SectionTitle>
        </Stack>
      ) : (
        <Banner tone="info" title="Got paid in cash or another way?">
          Record it here and it counts straight away. {otherName} can also mark it as paid from their phone.
        </Banner>
      )}

      <Field label={`Amount (${base})`} value={amountValue} onChangeText={setAmountText} keyboardType="decimal-pad" testID="settle-amount" />
      <View style={{ gap: 6 }}>
        <Text variant="label" muted>How</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {METHODS.map((m) => (
            <Chip key={m} label={m} selected={method === m} onPress={() => setMethod(method === m ? null : m)} />
          ))}
        </Row>
      </View>
      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. Paid for dinner and taxi" maxLength={300} />
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <Stack gap={space.sm}>
        <SectionTitle>What it&apos;s for</SectionTitle>
        <Card>
          {pair.breakdown.map((l, i) => (
            <ListRow
              key={`${l.id}-${i}`}
              title={l.kind === 'bill' ? l.title ?? 'Bill' : 'Payment'}
              subtitle={
                l.kind === 'bill'
                  ? l.amountMinor > 0
                    ? `${iOwe ? 'Your' : `${otherName.split(' ')[0]}'s`} share`
                    : `${iOwe ? `${otherName.split(' ')[0]}'s` : 'Your'} share (takes off)`
                  : 'Already paid'
              }
              right={
                <Text variant="money" color={l.amountMinor > 0 ? t.text : t.success}>
                  {l.amountMinor > 0 ? '' : '−'}
                  {formatMoney(Math.abs(l.amountMinor), base)}
                </Text>
              }
            />
          ))}
        </Card>
      </Stack>
    </Screen>
  );
}
