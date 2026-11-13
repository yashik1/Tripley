/**
 * Trip memories: an automatic recap from what the group actually shared and
 * did. Choose what goes into the shareable text before sharing; photos stay
 * private to the trip, and no locations or individual amounts are included.
 */
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Share, Switch, View } from 'react-native';

import { PhotoGrid } from '@/components/FeedPost';
import { AvatarStack, StatusPill, TripCover } from '@/components/Travel';
import { Banner, Button, Card, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { formatMoney } from '@/lib/currency';
import { firstName, formatDateRange, todayISO } from '@/lib/format';
import { pollIsOpen, pollResults } from '@/lib/group-decisions';
import { rsvpSummary } from '@/lib/itinerary';
import { useFeed, useItinerary, usePlaces, usePolls, useRsvps, useShareRows } from '@/lib/queries';
import { DEFAULT_SECTIONS, recapText, type RecapSection } from '@/lib/recap';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { tripStatus } from '@/lib/trip-status';
import { space, useTheme } from '@/theme';

const SECTION_LABELS: { key: RecapSection; label: string }[] = [
  { key: 'dates', label: 'Dates' },
  { key: 'people', label: 'Who came (first names)' },
  { key: 'highlights', label: 'Plan highlights' },
  { key: 'places', label: 'Places we loved' },
  { key: 'decisions', label: 'What the group decided' },
  { key: 'stats', label: 'How many photos and posts' },
  { key: 'spend', label: 'Group total spent (no one’s share)' },
];

export default function Memories() {
  const id = useTripId();
  const t = useTheme();
  const { trip, members, me } = useTripData(id);
  const feed = useFeed(id);
  const itinerary = useItinerary(id);
  const rsvps = useRsvps(id);
  const places = usePlaces(id);
  const polls = usePolls(id);
  const shares = useShareRows(id);
  const [include, setInclude] = useState<RecapSection[]>(DEFAULT_SECTIONS);
  const [note, setNote] = useState<string | null>(null);

  const posts = useMemo(() => (feed.data?.pages ?? []).flat(), [feed.data]);
  const photos = posts.flatMap((p) => p.post_photos.map((ph) => ph.path));
  const highlights = [...(itinerary.data ?? [])]
    .map((i) => ({ i, going: rsvpSummary(rsvps.data ?? [], i.id, me).going.length }))
    .sort((a, b) => b.going - a.going)
    .slice(0, 5);
  const loved = (places.data ?? []).filter((p) => p.kind !== 'stay' && p.kind !== 'airport').slice(0, 6);
  const decided = (polls.data ?? [])
    .filter((p) => !pollIsOpen(p))
    .map((p) => ({ question: p.question, winner: pollResults(p, me).options.find((o) => o.leading)?.label }))
    .filter((d): d is { question: string; winner: string } => !!d.winner);
  const total = (shares.data ?? []).reduce((a, s) => a + s.amountBaseMinor, 0);

  if (!trip) return <Screen>{null}</Screen>;
  const status = tripStatus(trip, todayISO());
  const dates = formatDateRange(trip.starts_on, trip.ends_on);
  const days =
    trip.starts_on && trip.ends_on ? Math.round((Date.parse(trip.ends_on) - Date.parse(trip.starts_on)) / 86_400_000) + 1 : null;

  const text = recapText(
    {
      name: trip.name,
      destination: trip.destination,
      dates,
      days,
      people: members.map((m) => firstName(m.profile.display_name || 'Friend')),
      highlights: highlights.map((h) => (h.going ? `${h.i.title} (${h.going} going)` : h.i.title)),
      places: loved.map((p) => p.name),
      decisions: decided,
      photoCount: photos.length,
      postCount: posts.filter((p) => p.kind !== 'event').length,
      totalSpent: total ? formatMoney(total, trip.base_currency) : null,
    },
    include,
  );

  const share = async () => {
    setNote(null);
    try {
      if (Platform.OS !== 'web' || (typeof navigator !== 'undefined' && 'share' in navigator)) {
        await Share.share({ message: text, title: trip.name });
      } else {
        await Clipboard.setStringAsync(text);
        setNote('Copied. Paste it into a message or a post.');
      }
    } catch {
      await Clipboard.setStringAsync(text).catch(() => undefined);
      setNote('Copied. Paste it into a message or a post.');
    }
  };

  return (
    <Screen footer={<Button title="Share the recap" icon="share" onPress={share} testID="recap-share" />}>
      <TripCover seed={trip.id} path={trip.cover_path} height={170} />
      <Stack gap={4}>
        <StatusPill kind={status.kind} label={status.kind === 'completed' ? 'Memories' : 'So far'} />
        <Text variant="title">{trip.name}</Text>
        <Text muted>{[trip.destination, dates, days ? `${days} days` : null].filter(Boolean).join(' · ')}</Text>
        <Row gap={space.sm}>
          <AvatarStack people={members.map((m) => ({ id: m.user_id, name: m.profile.display_name || 'Friend', url: m.profile.avatar_url }))} />
          <Text variant="caption" muted>{members.length} travellers</Text>
        </Row>
      </Stack>

      <Button title="Open the scrapbook" icon="photo" kind="secondary" onPress={() => router.push(`/trip/${id}/fun/scrapbook`)} testID="recap-scrapbook" />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {[
          ['📸', photos.length, 'photos'],
          ['💬', posts.filter((p) => p.kind !== 'event').length, 'posts'],
          ['🗓️', itinerary.data?.length ?? 0, 'plans'],
          ['📍', places.data?.length ?? 0, 'places'],
        ].map(([emoji, n, label]) => (
          <Card key={String(label)} style={{ flexBasis: 70, flexGrow: 1, alignItems: 'center', gap: 2, padding: space.md }}>
            <Text style={{ fontSize: 20 }}>{emoji}</Text>
            <Text variant="heading">{n}</Text>
            <Text variant="caption" muted>{label}</Text>
          </Card>
        ))}
      </View>

      {photos.length ? (
        <Stack gap={space.sm}>
          <SectionTitle>Photos</SectionTitle>
          <PhotoGrid paths={photos.slice(0, 6)} />
          <Text variant="caption" faint>Photos stay private to the trip; the shared recap is text only.</Text>
        </Stack>
      ) : null}

      <Card testID="recap-choose">
        <Text variant="heading">What to include when you share</Text>
        {SECTION_LABELS.map((s) => (
          <Row key={s.key} gap={space.md}>
            <Text style={{ flex: 1 }}>{s.label}</Text>
            <Switch
              value={include.includes(s.key)}
              onValueChange={(v) => setInclude((list) => (v ? [...list, s.key] : list.filter((x) => x !== s.key)))}
              trackColor={{ true: t.primary, false: t.border }}
              thumbColor="#fff"
              accessibilityLabel={s.label}
              testID={`recap-${s.key}`}
            />
          </Row>
        ))}
        <Text variant="caption" faint>Never included: locations, receipts, or what anyone paid or owes.</Text>
      </Card>

      <Card>
        <Text variant="label" muted>Preview</Text>
        <Text testID="recap-preview">{text}</Text>
      </Card>
      {note ? <Banner tone="success">{note}</Banner> : null}
    </Screen>
  );
}
