/**
 * Digital Travel Scrapbook: the trip's photos and memories, a day at a time.
 * Memories (caption, description, the day, photos) are added by anyone on
 * the trip; photo posts and food photos from the trip join in by themselves.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { PhotoGrid } from '@/components/FeedPost';
import { AvatarStack, TripCover } from '@/components/Travel';
import { Banner, Button, Card, EmptyState, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { tripPlacePhoto } from '@/lib/place-photo';
import { deleteMemory } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { firstName, formatDateRange } from '@/lib/format';
import { keys, useFunEntries, useMemories, useTripPosts } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { dayHeading, daysInclusive, scrapbookDays, type ScrapbookEntry } from '@/lib/trip-fun';
import { space, useTheme } from '@/theme';

export default function Scrapbook() {
  const id = useTripId();
  const t = useTheme();
  const qc = useQueryClient();
  const { trip, members, me, nameOf, isOrganizer } = useTripData(id);
  const memories = useMemories(id);
  const posts = useTripPosts(id);
  const entries = useFunEntries(id);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => scrapbookDays(memories.data ?? [], posts.data ?? [], entries.data ?? []), [memories.data, posts.data, entries.data]);
  const photoCount = days.reduce((n, d) => n + d.entries.reduce((m, e) => m + e.photos.length, 0), 0);
  const memoryCount = days.reduce((n, d) => n + d.entries.length, 0);
  const loading = memories.isLoading || posts.isLoading;

  const remove = async (e: ScrapbookEntry) => {
    setError(null);
    try {
      await deleteMemory(e.ref);
      await qc.invalidateQueries({ queryKey: keys.memories(id) });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const dayLabel = (day: string) => {
    if (!trip?.starts_on) return null;
    const n = daysInclusive(trip.starts_on, day);
    if (n < 1) return 'Before the trip';
    if (trip.ends_on && day > trip.ends_on) return 'After the trip';
    return `Day ${n}`;
  };
  const source = (e: ScrapbookEntry) => (e.source === 'post' ? 'from the feed' : e.source === 'food' ? 'from Food Explorer' : null);

  return (
    <Screen footer={<Button title="Add a memory" icon="add" onPress={() => router.push(`/trip/${id}/fun/memory`)} testID="scrapbook-add" />}>
      {trip ? (
        <Stack gap={space.sm}>
          <TripCover seed={trip.id} path={trip.cover_path} theme={trip.theme} place={tripPlacePhoto(trip)} height={150} />
          <Text variant="title" accessibilityRole="header">{trip.name}</Text>
          <Text muted>{[trip.destination, formatDateRange(trip.starts_on, trip.ends_on)].filter(Boolean).join(' · ')}</Text>
          <Row gap={space.sm}>
            <AvatarStack people={members.map((m) => ({ id: m.user_id, name: m.profile.display_name || 'Friend', url: m.profile.avatar_url }))} />
            <Text variant="caption" muted testID="scrapbook-count">
              {memoryCount} {memoryCount === 1 ? 'memory' : 'memories'} · {photoCount} {photoCount === 1 ? 'photo' : 'photos'}
            </Text>
          </Row>
          <Button title="Share a recap of the trip" icon="share" small kind="secondary" onPress={() => router.push(`/trip/${id}/memories`)} />
        </Stack>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {!loading && days.length === 0 ? (
        <EmptyState
          icon="photo"
          title="The scrapbook is empty"
          body="Add a memory: a caption, the story behind it, the day it happened and a few photos. Photos shared in the feed appear here too."
        />
      ) : null}
      {days.map((d) => (
        <Stack key={d.day} gap={space.sm}>
          <SectionTitle action={dayLabel(d.day) ? <Text variant="caption" muted>{dayLabel(d.day)}</Text> : undefined}>{dayHeading(d.day)}</SectionTitle>
          {d.entries.map((e) => {
            const mine = e.by === me;
            return (
              <Card key={e.key} testID={`scrapbook-${e.key}`}>
                <PhotoGrid paths={e.photos} />
                {e.caption ? <Text variant="heading">{e.caption}</Text> : null}
                {e.description ? <Text>{e.description}</Text> : null}
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text variant="caption" faint style={{ flex: 1 }}>
                    {[e.by ? (mine ? 'You' : firstName(nameOf(e.by))) : null, source(e)].filter(Boolean).join(' · ')}
                  </Text>
                  {e.source === 'memory' && mine ? (
                    <Button title="Edit" small kind="ghost" onPress={() => router.push({ pathname: '/trip/[id]/fun/memory', params: { id, memory: e.ref } })} />
                  ) : null}
                  {e.source === 'memory' && (mine || isOrganizer) ? <Button title="Remove" small kind="ghost" onPress={() => remove(e)} /> : null}
                </Row>
              </Card>
            );
          })}
        </Stack>
      ))}
      <View style={{ height: space.sm }} />
      <Text variant="caption" faint center style={{ color: t.textFaint }}>Only people on this trip can see the scrapbook.</Text>
    </Screen>
  );
}
