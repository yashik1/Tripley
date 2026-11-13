/**
 * My Travel Passport: the countries, cities and destinations you've been to,
 * your travel milestones and badges, and the trips behind them. Stamps are
 * private: only you see them.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { PassportCard } from '@/components/AccountCards';
import { DateTimeField } from '@/components/DateTimeField';
import { PlaceField } from '@/components/PlaceField';
import { ProgressBar } from '@/components/Travel';
import { Banner, Button, Card, Chip, EmptyState, Field, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { addStamp, deleteStamp, type StampInput } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate, isISODate, todayISO } from '@/lib/format';
import { searchPlaces, type GeoResult } from '@/lib/geocode';
import { keys, useStamps, useTrips } from '@/lib/queries';
import { flagEmoji, milestones, nextMilestone, passportStats, splitDestination, tripsToStamp, WORLD_COUNTRIES } from '@/lib/trip-fun';
import { tripStatus } from '@/lib/trip-status';
import type { PassportStamp, TripWithCount } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { radius, space, useTheme } from '@/theme';

const PASSPORT_NAVY = '#1E3A5F';
const monthYear = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

export default function Passport() {
  const t = useTheme();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const stamps = useStamps();
  const trips = useTrips();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const today = todayISO();
  const myTrips = useMemo(() => trips.data ?? [], [trips.data]);
  const pastTrips = myTrips.filter((tr) => tripStatus(tr, today).kind === 'completed');
  const list = useMemo(() => stamps.data ?? [], [stamps.data]);
  const stats = passportStats(list, pastTrips);
  const next = nextMilestone(stats);
  const toStamp = tripsToStamp(myTrips.filter((tr) => ['completed', 'ongoing'].includes(tripStatus(tr, today).kind)), list);
  const tripName = (id: string | null) => myTrips.find((tr) => tr.id === id)?.name ?? null;
  const byCountry = useMemo(() => {
    const m = new Map<string, { name: string; code: string | null; places: Set<string> }>();
    for (const s of list) {
      const key = s.country_code ?? s.country?.toLowerCase() ?? '';
      if (!key) continue;
      const e = m.get(key) ?? { name: s.country ?? s.country_code ?? '', code: s.country_code, places: new Set<string>() };
      e.places.add(s.place.toLowerCase());
      m.set(key, e);
    }
    return [...m.values()].sort((a, b) => b.places.size - a.places.size || a.name.localeCompare(b.name));
  }, [list]);

  const refresh = () => qc.invalidateQueries({ queryKey: keys.stamps });

  const stampTrip = async (trip: TripWithCount) => {
    setError(null);
    setBusy(trip.id);
    try {
      const { place, country } = splitDestination(trip.destination ?? '');
      // The country's code (for its flag), when address search knows the place.
      let found: GeoResult | undefined;
      try {
        found = (await searchPlaces(trip.destination ?? '', { scope: 'area', limit: 1 }))[0];
      } catch {
        found = undefined;
      }
      await addStamp({
        place,
        country: found?.country ?? country,
        country_code: found?.countryCode ?? null,
        lat: trip.destination_lat ?? null,
        lng: trip.destination_lng ?? null,
        visited_on: trip.starts_on && trip.starts_on <= today ? trip.starts_on : today,
        trip_id: trip.id,
        note: null,
      });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (s: PassportStamp) => {
    setError(null);
    try {
      await deleteStamp(s.id);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Screen>
      {/* A passport-cover navy in both themes, so the white text always reads clearly. */}
      <Card raised testID="passport-hero" style={{ backgroundColor: PASSPORT_NAVY, borderColor: PASSPORT_NAVY }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ gap: 2 }}>
            <Text variant="caption" color="#ffffffcc" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>My Travel Passport</Text>
            <Text variant="title" color="#fff">{profile?.display_name || 'Traveller'}</Text>
          </View>
          <Text style={{ fontSize: 34 }}>🛂</Text>
        </Row>
        <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
          {(
            [
              ['countries', stats.countries, stats.countries === 1 ? 'country' : 'countries'],
              ['places', stats.places, stats.places === 1 ? 'place' : 'places'],
              ['trips', stats.trips, stats.trips === 1 ? 'trip' : 'trips'],
              ['days', stats.daysAway, stats.daysAway === 1 ? 'day away' : 'days away'],
            ] as const
          ).map(([key, n, label]) => (
            <View key={key} style={{ flexBasis: 70, flexGrow: 1, backgroundColor: '#ffffff22', borderRadius: radius.md, padding: space.sm, alignItems: 'center' }}>
              <Text variant="heading" color="#fff" testID={`passport-stat-${key}`}>{n}</Text>
              <Text variant="caption" color="#ffffffcc">{label}</Text>
            </View>
          ))}
        </Row>
        <View style={{ gap: 4 }}>
          <ProgressBar value={(stats.countries / WORLD_COUNTRIES) * 100} color="#fff" label={`${stats.countries} of ${WORLD_COUNTRIES} countries`} />
          <Text variant="caption" color="#ffffffcc">
            {stats.countries} of {WORLD_COUNTRIES} countries · {((stats.countries / WORLD_COUNTRIES) * 100).toFixed(1)}% of the world
          </Text>
        </View>
      </Card>
      <Text variant="caption" faint center>Only you can see your passport stamps.</Text>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {next ? (
        <Card testID="passport-next">
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="label">Next: {next.emoji} {next.title}</Text>
            <Text variant="caption" muted>{next.value} / {next.target}</Text>
          </Row>
          <ProgressBar value={next.progress} label={`${next.title}: ${next.value} of ${next.target}`} />
        </Card>
      ) : null}

      <SectionTitle>Milestones</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {milestones(stats).map((m) => (
          <View
            key={m.key}
            accessible
            accessibilityLabel={`${m.title}: ${m.reached ? 'reached' : `${m.value} of ${m.target}`}`}
            testID={`milestone-${m.key}`}
            style={{ flexBasis: 150, flexGrow: 1, borderRadius: radius.md, padding: space.sm, gap: 2, backgroundColor: m.reached ? t.successSoft : t.surfaceAlt, opacity: m.reached ? 1 : 0.8 }}>
            <Text style={{ fontSize: 22 }}>{m.reached ? m.emoji : '🔒'}</Text>
            <Text variant="label" color={m.reached ? t.success : t.textMuted}>{m.title}</Text>
            <Text variant="caption" muted>{m.reached ? 'Reached' : `${m.value} of ${m.target}`}</Text>
          </View>
        ))}
      </View>

      {toStamp.length ? (
        <Stack gap={space.sm}>
          <SectionTitle>From your trips</SectionTitle>
          {toStamp.map((tr) => (
            <Card key={tr.id} testID={`passport-trip-${tr.name}`}>
              <Row gap={space.md}>
                <Text style={{ fontSize: 24 }}>✈️</Text>
                <View style={{ flex: 1 }}>
                  <Text variant="label">{tr.destination}</Text>
                  <Text variant="caption" muted>{[tr.name, tr.starts_on ? monthYear(tr.starts_on) : null].filter(Boolean).join(' · ')}</Text>
                </View>
                <Button title="Add stamp" small loading={busy === tr.id} onPress={() => stampTrip(tr)} testID="passport-stamp-trip" />
              </Row>
            </Card>
          ))}
        </Stack>
      ) : null}

      <SectionTitle action={!adding ? <Button title="Add a place" icon="add" small kind="ghost" onPress={() => setAdding(true)} testID="passport-add" /> : undefined}>
        Stamps
      </SectionTitle>
      {adding ? <AddStamp trips={myTrips} onDone={() => setAdding(false)} onSaved={refresh} /> : null}
      {!stamps.isLoading && !list.length && !adding ? (
        <EmptyState icon="flag" title="No stamps yet" body="Add the places you’ve been, or stamp a trip above once you’ve gone." />
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {list.map((s, i) => {
          const name = tripName(s.trip_id);
          return (
            <View
              key={s.id}
              testID={`stamp-${s.place}`}
              style={{
                flexBasis: 150,
                flexGrow: 1,
                borderRadius: radius.lg,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: [t.primary, t.coral, t.sky, t.yellowText][i % 4],
                padding: space.md,
                gap: 2,
                alignItems: 'center',
                backgroundColor: t.surface,
                transform: [{ rotate: `${(i % 3) - 1}deg` }],
              }}>
              <Text style={{ fontSize: 30 }}>{flagEmoji(s.country_code)}</Text>
              <Text variant="label" center>{s.place}</Text>
              {s.country ? <Text variant="caption" muted center>{s.country}</Text> : null}
              <Text variant="caption" faint>{formatDate(s.visited_on)} {s.visited_on.slice(0, 4)}</Text>
              {name && s.trip_id ? (
                <Pressable onPress={() => router.push(`/trip/${s.trip_id}/fun/scrapbook`)} accessibilityRole="link">
                  <Text variant="caption" color={t.primary} center>{name} ›</Text>
                </Pressable>
              ) : null}
              {s.note ? <Text variant="caption" center>{s.note}</Text> : null}
              <Pressable onPress={() => remove(s)} accessibilityRole="button" accessibilityLabel={`Remove ${s.place}`} hitSlop={8}>
                <Text variant="caption" faint>Remove</Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {byCountry.length ? (
        <Stack gap={space.sm}>
          <SectionTitle>Countries</SectionTitle>
          <Card style={{ gap: space.sm }}>
            {byCountry.map((c) => (
              <Row key={c.name} gap={space.md}>
                <Text style={{ fontSize: 20 }}>{flagEmoji(c.code)}</Text>
                <Text style={{ flex: 1 }}>{c.name}</Text>
                <Text variant="caption" muted>{c.places.size} {c.places.size === 1 ? 'place' : 'places'}</Text>
              </Row>
            ))}
          </Card>
        </Stack>
      ) : null}

      <SectionTitle>Badges</SectionTitle>
      <PassportCard />
    </Screen>
  );
}

function AddStamp({ trips, onDone, onSaved }: { trips: TripWithCount[]; onDone: () => void; onSaved: () => Promise<void> }) {
  const [place, setPlace] = useState('');
  const [picked, setPicked] = useState<GeoResult | null>(null);
  const [country, setCountry] = useState('');
  const [day, setDay] = useState(todayISO());
  const [tripId, setTripId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!place.trim()) return setError('Where did you go?');
    if (!isISODate(day) || day > todayISO()) return setError('Pick a day that has already happened.');
    setBusy(true);
    try {
      const input: StampInput = {
        place: place.trim(),
        country: country.trim() || null,
        country_code: picked && picked.country === country.trim() ? picked.countryCode ?? null : null,
        lat: picked?.lat ?? null,
        lng: picked?.lng ?? null,
        visited_on: day,
        trip_id: tripId,
        note: note.trim() || null,
      };
      await addStamp(input);
      await onSaved();
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID="passport-form">
      <Text variant="heading">Add a place</Text>
      <PlaceField
        label="City or destination"
        value={place}
        onChangeText={(v) => {
          setPlace(v);
          setPicked(null);
        }}
        onPick={(r) => {
          setPicked(r);
          setPlace(r.name);
          setCountry(r.country ?? '');
        }}
        scope="area"
        placeholder="Search a city, region or country"
        maxLength={80}
        found={!!picked}
        testID="stamp-place"
      />
      <Field label="Country" value={country} onChangeText={setCountry} placeholder="Portugal" maxLength={80} testID="stamp-country" />
      <DateTimeField mode="date" label="When" value={day} onChangeText={setDay} max={todayISO()} testID="stamp-day" />
      {trips.length ? (
        <View style={{ gap: space.xs }}>
          <Text variant="label" muted>Part of a trip? (optional)</Text>
          <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
            {trips.slice(0, 12).map((tr) => (
              <Chip key={tr.id} label={tr.name} selected={tripId === tr.id} onPress={() => setTripId(tripId === tr.id ? null : tr.id)} />
            ))}
          </Row>
        </View>
      ) : null}
      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Where we had the best custard tarts" maxLength={300} testID="stamp-note" />
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Row gap={space.sm}>
        <Button title="Add stamp" icon="check" onPress={save} loading={busy} testID="stamp-save" style={{ flex: 1 }} />
        <Button title="Cancel" kind="ghost" onPress={onDone} />
      </Row>
    </Card>
  );
}
