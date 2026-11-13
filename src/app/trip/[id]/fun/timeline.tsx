/**
 * Living Trip Timeline: everything that happened on the trip, in order, a
 * day at a time: the trip's dates, plan stops, posts and photos, scrapbook
 * memories, food finds and songs. Tap anything to open it.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';

import { FunIntro } from '@/components/TripFun';
import { Card, Chip, EmptyState, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { eventText } from '@/lib/feed';
import { firstName } from '@/lib/format';
import { useFunEntries, useItinerary, useMemories, usePhotoUrl, useTripPosts } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { buildTimeline, dayHeading, daysInclusive, type TimelineFilter, type TimelineItem } from '@/lib/trip-fun';
import { radius, space, useTheme } from '@/theme';

const FILTERS: { value: TimelineFilter; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'plans', label: '🗓️ Plans' },
  { value: 'posts', label: '📸 Posts' },
  { value: 'memories', label: '📔 Memories' },
  { value: 'food', label: '🍜 Food' },
  { value: 'songs', label: '🎵 Songs' },
];

function Thumb({ path }: { path: string }) {
  const t = useTheme();
  const url = usePhotoUrl(path);
  return (
    <View style={{ width: 52, height: 52, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: t.surfaceAlt }}>
      {url.data ? <Image source={{ uri: url.data }} style={{ width: 52, height: 52 }} contentFit="cover" /> : null}
    </View>
  );
}

export default function Timeline() {
  const id = useTripId();
  const t = useTheme();
  const { trip, me, nameOf } = useTripData(id);
  const plans = useItinerary(id);
  const posts = useTripPosts(id);
  const entries = useFunEntries(id);
  const memories = useMemories(id);
  const [filter, setFilter] = useState<TimelineFilter>('all');

  const who = (uid: string | null) => (!uid ? null : uid === me ? 'You' : firstName(nameOf(uid)));
  const days = useMemo(
    () =>
      buildTimeline(
        {
          trip,
          plans: plans.data ?? [],
          posts: posts.data ?? [],
          entries: entries.data ?? [],
          memories: memories.data ?? [],
          eventLabel: (p) => eventText(p.event, p.author_id === me ? 'You' : firstName(nameOf(p.author_id ?? ''))),
        },
        filter,
      ),
    [trip, plans.data, posts.data, entries.data, memories.data, filter, me, nameOf],
  );
  const loading = plans.isLoading || posts.isLoading || entries.isLoading || memories.isLoading;

  const open = (i: TimelineItem) => {
    if (!i.ref) return;
    if (i.kind === 'plan') router.push({ pathname: '/trip/[id]/plan/[itemId]', params: { id, itemId: i.ref } });
    else if (i.kind === 'post') router.push({ pathname: '/trip/[id]/post/[postId]', params: { id, postId: i.ref } });
    else if (i.kind === 'memory') router.push(`/trip/${id}/fun/scrapbook`);
    else if (i.kind === 'food') router.push(`/trip/${id}/fun/food`);
    else if (i.kind === 'song') router.push(`/trip/${id}/fun/soundtrack`);
    else if (i.kind === 'mission') router.push(`/trip/${id}/fun/missions`);
  };
  const dayLabel = (day: string) => {
    if (!trip?.starts_on) return null;
    const n = daysInclusive(trip.starts_on, day);
    if (n < 1) return 'Before the trip';
    if (trip.ends_on && day > trip.ends_on) return 'After the trip';
    return `Day ${n}`;
  };

  return (
    <Screen>
      <FunIntro emoji="📖" title="Living Trip Timeline" blurb="The whole trip in order: plans, posts and photos, memories, food finds and songs." />
      <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <Chip key={f.value} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} testID={`timeline-filter-${f.value}`} />
        ))}
      </Row>
      {!loading && !days.length ? (
        <EmptyState icon="clock" title="Nothing here yet" body="As the group plans, posts, adds memories, food finds and songs, the story of the trip builds up here." />
      ) : null}
      {days.map((d) => (
        <Stack key={d.day} gap={space.sm}>
          <SectionTitle action={dayLabel(d.day) ? <Text variant="caption" muted>{dayLabel(d.day)}</Text> : undefined}>{dayHeading(d.day)}</SectionTitle>
          <Card style={{ paddingVertical: space.sm, gap: 0 }}>
            {d.items.map((i, n) => (
              <Pressable
                key={i.key}
                onPress={i.ref ? () => open(i) : undefined}
                disabled={!i.ref}
                accessibilityRole={i.ref ? 'button' : undefined}
                testID={`timeline-${i.kind}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  gap: space.md,
                  alignItems: 'center',
                  paddingVertical: space.sm,
                  borderTopWidth: n === 0 ? 0 : 1,
                  borderTopColor: t.border,
                  opacity: pressed ? 0.7 : 1,
                })}>
                <Text variant="caption" muted style={{ width: 40 }}>{i.time && i.kind !== 'start' && i.kind !== 'end' ? i.time : ''}</Text>
                <Text style={{ fontSize: 20 }}>{i.emoji}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label" numberOfLines={2}>{i.title}</Text>
                  {i.detail || i.by ? (
                    <Text variant="caption" muted numberOfLines={2}>{[i.detail, who(i.by)].filter(Boolean).join(' · ')}</Text>
                  ) : null}
                </View>
                {i.photo ? <Thumb path={i.photo} /> : null}
              </Pressable>
            ))}
          </Card>
        </Stack>
      ))}
    </Screen>
  );
}
