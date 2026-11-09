/**
 * Cash kitty: the group's pot of physical cash and who's holding it. Money in
 * counts as paid to the holder; spending is a bill the holder paid; so it all
 * flows into the normal balances and leftover cash comes back on settling up.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Avatar, Banner, Button, Card, Chip, Field, Loading, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { newClientId } from '@/lib/ids';
import { closeKitty, createKitty, kittyAddCash, kittyHandover, kittyPayout, respondToSettlement } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { formatMoney, parseAmount } from '@/lib/currency';
import { errorMessage } from '@/lib/errors';
import { firstName, timeAgo } from '@/lib/format';
import type { KittyEntry, KittySummary } from '@/lib/kitty';
import { keys, useKitties, useSettlements } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import type { Kitty } from '@/lib/types';
import { useKittySummaries } from '@/lib/use-kitties';
import { space, useTheme } from '@/theme';

type Panel = 'add' | 'handover' | 'payout' | null;

export default function KittyScreen() {
  const id = useTripId();
  const kittiesQuery = useKitties(id);
  const kitties = useKittySummaries(id);
  const { trip, members, me } = useTripData(id);
  if (kittiesQuery.isLoading || !trip) return <Loading />;
  const open = kitties.filter((k) => !k.kitty.closed_at);
  const closed = kitties.filter((k) => k.kitty.closed_at);
  return (
    <Screen>
      {open.length === 0 ? <StartKitty tripId={id} me={me} members={members} first={kitties.length === 0} /> : null}
      {open.map((k) => (
        <KittyCard key={k.kitty.id} tripId={id} kitty={k.kitty} summary={k.summary} base={trip.base_currency} />
      ))}
      {closed.length > 0 ? (
        <Stack gap={space.sm}>
          <SectionTitle>Closed kitties</SectionTitle>
          {closed.map((k) => (
            <Card key={k.kitty.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="label">💵 {k.kitty.name}</Text>
                <Text variant="caption" muted>
                  {formatMoney(k.summary.spentMinor, trip.base_currency)} spent · {formatMoney(k.summary.cashMinor, trip.base_currency)} left
                </Text>
              </Row>
            </Card>
          ))}
        </Stack>
      ) : null}
      <Text variant="caption" faint>
        The kitty is part of everyone&apos;s balances: cash put in counts as paid to whoever holds it, and spending from it is
        a bill they paid. Any cash left over comes back to the people who put it in when you settle up.
      </Text>
    </Screen>
  );
}

function StartKitty({ tripId, me, members, first }: { tripId: string; me: string; members: ReturnType<typeof useTripData>['members']; first: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState('Kitty');
  const [holder, setHolder] = useState(me);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await createKitty(tripId, name.trim() || 'Kitty', holder);
      await qc.invalidateQueries({ queryKey: keys.kitties(tripId) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Text variant="heading">{first ? 'Pool cash in a kitty' : 'Start a new kitty'}</Text>
      <Text muted>
        Everyone hands cash to one person, who pays for taxis, tips and street food from it. Tripley keeps track of how
        much is left and who holds it, and it all comes out right when you settle up.
      </Text>
      <Field label="Name" value={name} onChangeText={setName} maxLength={60} testID="kitty-name" />
      <Text variant="label" muted>Who holds the cash?</Text>
      <Row style={{ flexWrap: 'wrap' }} gap={space.xs}>
        {members.map((m) => (
          <Chip
            key={m.user_id}
            label={m.user_id === me ? 'Me' : firstName(m.profile.display_name || 'Friend')}
            selected={holder === m.user_id}
            onPress={() => setHolder(m.user_id)}
          />
        ))}
      </Row>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Button title="Start the kitty" icon="wallet" onPress={start} loading={busy} testID="start-kitty" />
    </Card>
  );
}

function KittyCard({ tripId, kitty, summary, base }: { tripId: string; kitty: Kitty; summary: KittySummary; base: string }) {
  const t = useTheme();
  const qc = useQueryClient();
  const { me, members, nameOf, isOrganizer } = useTripData(tripId);
  const settlements = useSettlements(tripId);
  const holding = kitty.holder_id === me;
  // One id per cash move, kept until it succeeds, so tapping again after a
  // dropped connection can't record the same cash twice.
  const [opId, setOpId] = useState(newClientId);
  const [panel, setPanel] = useState<Panel>(null);
  const [amountText, setAmountText] = useState('');
  const [who, setWho] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = members.filter((m) => m.user_id !== kitty.holder_id);
  const pendingForMe = (settlements.data ?? []).filter(
    (s) => s.kitty_id === kitty.id && s.kitty_role === 'contribution' && s.status === 'paid' && s.to_user === me,
  );

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.kitties(tripId) }),
      qc.invalidateQueries({ queryKey: keys.kittyCash(tripId) }),
      qc.invalidateQueries({ queryKey: keys.settlements(tripId) }),
    ]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setOpId(newClientId());
      await refresh();
      setPanel(null);
      setAmountText('');
      setWho(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const amount = () => {
    const v = parseAmount(amountText, base);
    if (!v || v <= 0) throw new Error('Enter an amount.');
    return v;
  };
  const open = (p: Panel) => {
    setPanel((cur) => (cur === p ? null : p));
    setError(null);
    setAmountText('');
    setWho(p === 'add' && !holding ? me : null);
  };

  return (
    <Stack gap={space.md}>
      <Card>
        <Row style={{ justifyContent: 'space-between' }} align="flex-start">
          <Stack gap={2} style={{ flex: 1 }}>
            <Text variant="label" muted>💵 {kitty.name}</Text>
            <Text style={{ fontSize: 34, lineHeight: 42, fontWeight: '800' }} testID="kitty-cash">{formatMoney(summary.cashMinor, base)}</Text>
            <Text muted>{holding ? 'You’re holding the cash' : `${nameOf(kitty.holder_id)} is holding the cash`}</Text>
            {summary.pendingMinor > 0 ? (
              <Text variant="caption" color={t.warning}>
                Includes {formatMoney(summary.pendingMinor, base)} waiting for {holding ? 'you' : firstName(nameOf(kitty.holder_id))} to confirm.
              </Text>
            ) : null}
          </Stack>
          <Avatar id={kitty.holder_id} name={nameOf(kitty.holder_id)} url={members.find((m) => m.user_id === kitty.holder_id)?.profile.avatar_url} size={44} />
        </Row>

        <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
          <Button title="Put cash in" icon="add" small onPress={() => open('add')} testID="kitty-add" />
          <Button
            title="Spend from kitty"
            icon="bills"
            small
            kind="secondary"
            onPress={() => router.push({ pathname: '/trip/[id]/bill/new', params: { id: tripId, kitty: kitty.id } })}
            testID="kitty-spend"
          />
          {holding ? <Button title="Hand over" small kind="secondary" onPress={() => open('handover')} testID="kitty-handover" /> : null}
          {holding ? <Button title="Give cash back" small kind="secondary" onPress={() => open('payout')} testID="kitty-payout" /> : null}
        </Row>

        {panel === 'add' ? (
          <Stack gap={space.sm}>
            <Text variant="label" muted>Who put cash in?</Text>
            <Row style={{ flexWrap: 'wrap' }} gap={space.xs}>
              {(holding ? members : members.filter((m) => m.user_id === me)).map((m) => (
                <Chip
                  key={m.user_id}
                  label={m.user_id === me ? (holding ? 'My own cash' : 'Me') : firstName(m.profile.display_name || 'Friend')}
                  selected={who === m.user_id}
                  onPress={() => setWho(m.user_id)}
                />
              ))}
            </Row>
            <Field label={`Amount (${base})`} value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" placeholder="0.00" testID="kitty-amount" />
            <Text variant="caption" faint>
              {holding ? 'You’re recording cash you received, so it counts straight away.' : `${firstName(nameOf(kitty.holder_id))} confirms they got it.`}
            </Text>
            <Button
              title="Add to kitty"
              loading={busy}
              testID="kitty-add-save"
              onPress={() =>
                run(async () => {
                  if (!who) throw new Error('Choose who put the cash in.');
                  await kittyAddCash(kitty.id, who, amount(), opId);
                })
              }
            />
          </Stack>
        ) : null}

        {panel === 'handover' ? (
          <Stack gap={space.sm}>
            <Text variant="label" muted>Give the kitty ({formatMoney(summary.cashMinor, base)}) to</Text>
            <Row style={{ flexWrap: 'wrap' }} gap={space.xs}>
              {others.map((m) => (
                <Chip key={m.user_id} label={firstName(m.profile.display_name || 'Friend')} selected={who === m.user_id} onPress={() => setWho(m.user_id)} />
              ))}
            </Row>
            <Button
              title="Hand it over"
              loading={busy}
              testID="kitty-handover-save"
              onPress={() =>
                run(async () => {
                  if (!who) throw new Error('Choose who takes the kitty.');
                  await kittyHandover(kitty.id, who);
                })
              }
            />
          </Stack>
        ) : null}

        {panel === 'payout' ? (
          <Stack gap={space.sm}>
            <Text variant="label" muted>Give leftover cash back to</Text>
            <Row style={{ flexWrap: 'wrap' }} gap={space.xs}>
              {others.map((m) => (
                <Chip key={m.user_id} label={firstName(m.profile.display_name || 'Friend')} selected={who === m.user_id} onPress={() => setWho(m.user_id)} />
              ))}
            </Row>
            <Field label={`Amount (${base})`} value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" placeholder="0.00" />
            <Button
              title="Give it back"
              loading={busy}
              onPress={() =>
                run(async () => {
                  if (!who) throw new Error('Choose who gets the cash.');
                  await kittyPayout(kitty.id, who, amount(), opId);
                })
              }
            />
          </Stack>
        ) : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </Card>

      {pendingForMe.length > 0 ? (
        <Card>
          <Text variant="label">Did you get this cash?</Text>
          {pendingForMe.map((s) => (
            <Row key={s.id} style={{ justifyContent: 'space-between' }}>
              <Text>
                {nameOf(s.from_user)} · {formatMoney(s.amount_base_minor, base)}
              </Text>
              <Row gap={space.xs}>
                <Button title="Got it" small onPress={() => run(() => respondToSettlement(s.id, 'confirmed'))} testID="kitty-confirm" />
                <Button title="No" small kind="secondary" onPress={() => run(() => respondToSettlement(s.id, 'disputed'))} />
              </Row>
            </Row>
          ))}
        </Card>
      ) : null}

      {summary.byContributor.length > 0 ? (
        <Stack gap={space.sm}>
          <SectionTitle>Who put in what</SectionTitle>
          <Card>
            {summary.byContributor.map((c) => (
              <Row key={c.userId} style={{ justifyContent: 'space-between' }}>
                <Text>{nameOf(c.userId)}</Text>
                <Text variant="money">{formatMoney(c.minor, base)}</Text>
              </Row>
            ))}
            <Row style={{ justifyContent: 'space-between' }}>
              <Text muted>Spent from the kitty</Text>
              <Text variant="money">−{formatMoney(summary.spentMinor, base)}</Text>
            </Row>
          </Card>
        </Stack>
      ) : null}

      {summary.entries.length > 0 ? (
        <Stack gap={space.sm}>
          <SectionTitle>History</SectionTitle>
          <Card>
            {summary.entries.map((e) => (
              <HistoryRow key={`${e.kind}-${e.id}`} e={e} base={base} nameOf={nameOf} holder={kitty.holder_id} />
            ))}
          </Card>
        </Stack>
      ) : null}

      {holding || isOrganizer ? (
        <Button
          title="Close this kitty"
          kind="ghost"
          small
          onPress={async () => {
            const left = summary.cashMinor > 0 ? ` It still has ${formatMoney(summary.cashMinor, base)}; that stays in the balances.` : '';
            if (!(await confirm('Close the kitty?', `No more cash in or out.${left}`, 'Close', true))) return;
            await run(() => closeKitty(kitty.id));
          }}
        />
      ) : null}
    </Stack>
  );
}

function HistoryRow({ e, base, nameOf, holder }: { e: KittyEntry; base: string; nameOf: (id: string) => string; holder: string }) {
  const t = useTheme();
  let icon: string;
  let text: string;
  let amount: string;
  switch (e.kind) {
    case 'contribution':
      icon = '➕';
      text = `${nameOf(e.userId)} put cash in${e.pending ? ` (waiting for ${firstName(nameOf(holder))})` : ''}`;
      amount = `+${formatMoney(e.amountMinor, base)}`;
      break;
    case 'spend':
      icon = '🧾';
      text = e.title;
      amount = `−${formatMoney(e.amountMinor, base)}`;
      break;
    case 'handover':
      icon = '🤝';
      text = `${nameOf(e.from)} handed it to ${nameOf(e.to)}`;
      amount = formatMoney(e.amountMinor, base);
      break;
    case 'payout':
      icon = '↩️';
      text = `${nameOf(e.userId)} got cash back${e.pending ? ' (to confirm)' : ''}`;
      amount = `−${formatMoney(e.amountMinor, base)}`;
      break;
  }
  return (
    <Row style={{ justifyContent: 'space-between' }} gap={space.sm}>
      <Row gap={space.sm} style={{ flex: 1 }}>
        <Text>{icon}</Text>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1}>{text}</Text>
          <Text variant="caption" faint>{timeAgo(e.at)}</Text>
        </View>
      </Row>
      <Text variant="money" color={e.kind === 'contribution' ? t.success : t.text}>{amount}</Text>
    </Row>
  );
}
