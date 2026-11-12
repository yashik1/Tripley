/**
 * Find dates that work: the organizer picks the days to choose from and how
 * long the trip is; everyone taps the days they can go (once for yes, twice
 * for maybe); the best stretches show with who can make them; the organizer
 * sets the trip dates from one, even if not everyone can come.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { DateTimeField } from '@/components/DateTimeField';
import { AvatarStack } from '@/components/Travel';
import { Banner, Button, Card, Chip, Field, Loading, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { remindAvailability, setDateWindow, setMyAvailability, updateTrip } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { answered, bestDates, calendarWeeks, dayCounts, windowDays } from '@/lib/date-coordination';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { firstName, formatDate, formatDateRange, todayISO } from '@/lib/format';
import { keys, useAvailability } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import type { Availability, Trip } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function FindDates() {
  const id = useTripId();
  const { trip, members, me, isOrganizer, active, loading } = useTripData(id);
  const availability = useAvailability(id);
  if (loading || !trip || availability.isLoading) return <Loading />;
  if (!trip.date_window_start || !trip.date_window_end) {
    return isOrganizer && active ? <AskForm tripId={id} trip={trip} /> : <NotAsked />;
  }
  return (
    <Choose
      key={`${trip.date_window_start}|${trip.date_window_end}|${(availability.data ?? []).filter((a) => a.user_id === me).length}`}
      tripId={id}
      trip={trip}
      members={members.map((m) => ({ id: m.user_id, name: m.profile.display_name || 'Friend', url: m.profile.avatar_url }))}
      me={me}
      isOrganizer={isOrganizer}
      active={active}
      answers={availability.data ?? []}
    />
  );
}

function NotAsked() {
  return (
    <Screen>
      <Banner tone="info" icon="calendar" title="No dates to pick yet">
        The organizer chooses the days to pick from. You’ll get a notification when they do.
      </Banner>
      <Button title="Back" kind="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

function AskForm({ tripId, trip }: { tripId: string; trip: Trip }) {
  const qc = useQueryClient();
  const [start, setStart] = useState(trip.date_window_start ?? '');
  const [end, setEnd] = useState(trip.date_window_end ?? '');
  const [length, setLength] = useState(String(trip.date_length ?? 3));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setError(null);
    const n = Number(length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return setError('Pick the first and last days to choose from.');
    if (!Number.isInteger(n) || n < 1) return setError('How many days is the trip?');
    setBusy(true);
    try {
      await setDateWindow(tripId, start, end, n);
      await qc.invalidateQueries({ queryKey: keys.trip(tripId) });
    } catch (e) {
      setError(isNetworkError(e) ? 'No connection. Try again when you’re back online.' : errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button title="Ask the group" icon="calendar" onPress={ask} loading={busy} testID="dates-ask" />}>
      <Stack gap={space.xs}>
        <Text variant="title">When can everyone go?</Text>
        <Text muted>Choose the days to pick from. Everyone ticks the days they’re free, and Tripley finds the best dates.</Text>
      </Stack>
      <Row gap={space.md} align="flex-start">
        <DateTimeField mode="date" label="From" value={start} onChangeText={setStart} min={todayISO()} style={{ flex: 1 }} testID="dates-from" />
        <DateTimeField mode="date" label="To" value={end} onChangeText={setEnd} min={start || todayISO()} style={{ flex: 1 }} testID="dates-to" />
      </Row>
      <Stack gap={space.sm}>
        <Text variant="label" muted>How many days is the trip?</Text>
        <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
          {['2', '3', '4', '5', '7', '10'].map((n) => (
            <Chip key={n} label={`${n} days`} selected={length === n} onPress={() => setLength(n)} testID={`dates-length-${n}`} />
          ))}
        </Row>
        <Field label="Or type it" value={length} onChangeText={setLength} keyboardType="number-pad" maxLength={2} style={{ width: 120 }} />
      </Stack>
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}

type Person = { id: string; name: string; url: string | null };

function Choose({
  tripId,
  trip,
  members,
  me,
  isOrganizer,
  active,
  answers,
}: {
  tripId: string;
  trip: Trip;
  members: Person[];
  me: string;
  isOrganizer: boolean;
  active: boolean;
  answers: Availability[];
}) {
  const t = useTheme();
  const qc = useQueryClient();
  const days = useMemo(() => windowDays(trip.date_window_start!, trip.date_window_end!), [trip.date_window_start, trip.date_window_end]);
  const weeks = useMemo(() => calendarWeeks(days), [days]);
  const mineStart = useMemo(() => new Map(answers.filter((a) => a.user_id === me).map((a) => [a.day, a.status])), [answers, me]);
  const [mine, setMine] = useState<Map<string, 'yes' | 'maybe'>>(mineStart);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Everyone else's saved answers, plus mine as I tap.
  const live = useMemo<Availability[]>(
    () => [...answers.filter((a) => a.user_id !== me), ...[...mine].map(([day, status]) => ({ user_id: me, day, status }))],
    [answers, me, mine],
  );
  const counts = dayCounts(live);
  const options = bestDates(live, members.map((m) => m.id), trip.date_window_start!, trip.date_window_end!, trip.date_length ?? 1);
  const done = answered(answers);
  const waiting = members.filter((m) => !done.has(m.id));
  const nameOf = (uid: string) => (uid === me ? 'you' : firstName(members.find((m) => m.id === uid)?.name ?? 'Friend'));
  const changed = mine.size !== mineStart.size || [...mine].some(([d, s]) => mineStart.get(d) !== s);

  const tap = (day: string) =>
    setMine((m) => {
      const next = new Map(m);
      const now = next.get(day);
      if (!now) next.set(day, 'yes');
      else if (now === 'yes') next.set(day, 'maybe');
      else next.delete(day);
      return next;
    });

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
      await Promise.all([qc.invalidateQueries({ queryKey: keys.availability(tripId) }), qc.invalidateQueries({ queryKey: keys.trip(tripId) })]);
    } catch (e) {
      setError(isNetworkError(e) ? 'No connection. Try again when you’re back online.' : errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run('save', async () => {
      await setMyAvailability(
        tripId,
        [...mine].filter(([, s]) => s === 'yes').map(([d]) => d),
        [...mine].filter(([, s]) => s === 'maybe').map(([d]) => d),
      );
      setNote('Saved. The group sees your days.');
    });

  const pickDates = async (start: string, end: string, missing: string[]) => {
    const who = missing.map(nameOf).join(', ');
    const ok = await confirm(
      `Set the trip to ${formatDateRange(start, end)}?`,
      missing.length ? `${who} can’t make all of it. You can change the dates later in trip settings.` : 'Everyone can make it.',
      'Set the dates',
    );
    if (ok) run(`use-${start}`, () => updateTrip(tripId, { starts_on: start, ends_on: end }).then(() => setNote('Trip dates set.')));
  };

  const heat = (day: string) => {
    const c = counts.get(day);
    const share = c ? (c.yes + c.maybe / 2) / Math.max(1, members.length) : 0;
    return share >= 0.99 ? t.primary : share >= 0.6 ? t.accent : share > 0 ? t.primarySoft : t.surfaceAlt;
  };

  return (
    <Screen
      footer={
        active ? (
          <Button
            title={changed ? 'Save my days' : 'Your days are saved'}
            icon="check"
            onPress={save}
            loading={busy === 'save'}
            disabled={!changed}
            testID="dates-save"
          />
        ) : undefined
      }>
      <Stack gap={space.xs}>
        <Text variant="title">When can you go?</Text>
        <Text muted>
          {`A ${trip.date_length ?? 1}-day trip between ${formatDate(trip.date_window_start!)} and ${formatDate(trip.date_window_end!)}. Tap a day once if you can go, twice for maybe.`}
        </Text>
        {trip.starts_on ? <Text variant="caption" color={t.primary}>{`Trip dates are set: ${formatDateRange(trip.starts_on, trip.ends_on)}`}</Text> : null}
      </Stack>

      <Card testID="dates-calendar">
        <Row style={{ justifyContent: 'space-between' }}>
          {WEEKDAYS.map((w, i) => (
            <Text key={i} variant="caption" faint center style={{ flex: 1 }}>{w}</Text>
          ))}
        </Row>
        {weeks.map((week, i) => (
          <Row key={i} style={{ justifyContent: 'space-between' }}>
            {week.map((day, j) => {
              if (!day) return <View key={j} style={{ flex: 1, aspectRatio: 1, margin: 2 }} />;
              const status = mine.get(day);
              const c = counts.get(day);
              const strong = heat(day) === t.primary || heat(day) === t.accent;
              return (
                <Pressable
                  key={day}
                  testID={`day-${day}`}
                  disabled={!active}
                  onPress={() => tap(day)}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatDate(day)}: ${status === 'yes' ? 'you can go' : status === 'maybe' ? 'maybe' : 'not marked'}, ${c?.yes ?? 0} can go`}
                  style={{
                    flex: 1,
                    aspectRatio: 1,
                    margin: 2,
                    borderRadius: radius.sm,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: heat(day),
                    borderWidth: status ? 2.5 : 0,
                    borderColor: status === 'maybe' ? t.yellow : t.text,
                    borderStyle: status === 'maybe' ? 'dashed' : 'solid',
                  }}>
                  <Text variant="label" color={strong ? '#fff' : t.text}>{Number(day.slice(8))}</Text>
                  <Text style={{ fontSize: 10 }} color={strong ? '#fff' : t.textMuted}>
                    {status === 'yes' ? '✓' : status === 'maybe' ? '?' : c?.yes ? String(c.yes) : ''}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        ))}
        <Text variant="caption" faint>Darker means more people can go. Your days have a border (dashed for maybe).</Text>
      </Card>

      <Stack gap={space.sm}>
        <SectionTitle>Best dates</SectionTitle>
        {options.length === 0 ? (
          <Text muted>Nothing yet: dates show here once people tick their days.</Text>
        ) : (
          options.map((o, i) => (
            <Card key={o.start} testID={`dates-option-${i}`}>
              <Row gap={space.sm} style={{ justifyContent: 'space-between' }}>
                <Text variant="heading">{formatDateRange(o.start, o.end)}</Text>
                <Text variant="caption" color={o.missing.length ? t.textMuted : t.primary}>
                  {o.missing.length ? `${o.everyDay.length + o.maybe.length} of ${members.length} can go` : 'Everyone can go'}
                </Text>
              </Row>
              {o.maybe.length ? <Text variant="caption" muted>{`Maybe: ${o.maybe.map(nameOf).join(', ')}`}</Text> : null}
              {o.missing.length ? <Text variant="caption" muted>{`Can’t make it: ${o.missing.map(nameOf).join(', ')}`}</Text> : null}
              {isOrganizer && active ? (
                <Button
                  title="Use these dates"
                  small
                  kind={i === 0 ? 'primary' : 'secondary'}
                  onPress={() => pickDates(o.start, o.end, o.missing)}
                  loading={busy === `use-${o.start}`}
                  testID={`dates-use-${i}`}
                  style={{ alignSelf: 'flex-start' }}
                />
              ) : null}
            </Card>
          ))
        )}
      </Stack>

      <Card>
        <Row gap={space.sm} style={{ justifyContent: 'space-between' }}>
          <Text variant="label">{`${done.size} of ${members.length} have answered`}</Text>
          <AvatarStack people={members.filter((m) => done.has(m.id))} />
        </Row>
        {waiting.length ? <Text variant="caption" muted testID="dates-waiting">{`Waiting for ${waiting.map((m) => nameOf(m.id)).join(', ')}`}</Text> : null}
        {isOrganizer && active && waiting.some((m) => m.id !== me) ? (
          <Button
            title="Remind them"
            icon="bell"
            small
            kind="secondary"
            loading={busy === 'remind'}
            onPress={() => run('remind', async () => setNote(`Reminded ${await remindAvailability(tripId)}.`))}
            testID="dates-remind"
            style={{ alignSelf: 'flex-start' }}
          />
        ) : null}
        {isOrganizer && active ? (
          <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
            <Button title="Change the days" kind="ghost" small onPress={() => run('reset', () => setDateWindow(tripId, null, null, null))} />
          </Row>
        ) : null}
      </Card>
      {note ? <Banner tone="success">{note}</Banner> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}
