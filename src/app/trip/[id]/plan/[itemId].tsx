/**
 * One stop in the plan: when and where, who's going, directions, and the
 * group's comments. The person who added it or the organizer can edit, move
 * or remove it.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack as RouterStack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Avatar, Banner, Button, Card, Field, IconButton, Loading, Row, Screen, SectionTitle, Segmented, Stack, Text } from '@/components/ui';
import { addItineraryComment, deleteItineraryComment, deleteItineraryItem, moveItineraryItem, setRsvp } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { errorMessage } from '@/lib/errors';
import { firstName, formatDate, timeAgo } from '@/lib/format';
import { findConflicts, RSVP_OPTIONS, rsvpSummary, timeRange } from '@/lib/itinerary';
import { directionsUrl, searchUrl } from '@/lib/map-links';
import { keys, useItinerary, useItineraryComments, useRsvps } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import type { RsvpStatus } from '@/lib/types';
import { space, useTheme } from '@/theme';

export default function PlanItem() {
  const id = useTripId();
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const t = useTheme();
  const qc = useQueryClient();
  const { me, nameOf, byId, isOrganizer, active } = useTripData(id);
  const itinerary = useItinerary(id);
  const rsvps = useRsvps(id);
  const comments = useItineraryComments(itemId);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const item = itinerary.data?.find((i) => i.id === itemId);
  if (!item) {
    return itinerary.isLoading ? (
      <Loading />
    ) : (
      <Screen>
        <Banner tone="info" title="This stop isn’t in the plan any more">Someone may have removed it.</Banner>
        <Button title="Back to the plan" kind="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const canEdit = active && (item.created_by === me || isOrganizer);
  const r = rsvpSummary(rsvps.data ?? [], item.id, me);
  const clash = findConflicts((itinerary.data ?? []).filter((i) => i.day === item.day)).get(item.id);
  const time = timeRange(item);
  const names = (ids: string[]) => ids.map((u) => (u === me ? 'You' : firstName(nameOf(u)))).join(', ');

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const answer = (status: RsvpStatus) =>
    run(async () => {
      await setRsvp(item.id, status);
      await qc.invalidateQueries({ queryKey: keys.rsvps(id) });
    });

  const openMaps = () =>
    Linking.openURL(item.lat != null && item.lng != null ? directionsUrl(item.lat, item.lng) : searchUrl(item.address ?? item.place_name ?? item.title));

  return (
    <Screen>
      <RouterStack.Screen options={{ title: formatDate(item.day) }} />
      <Stack gap={space.xs}>
        <Text variant="title" testID="stop-heading">{item.title}</Text>
        <Text muted>
          {formatDate(item.day)}
          {time ? ` · ${time}` : ' · any time'}
        </Text>
        {item.place_name || item.address ? (
          <Row gap={6} align="center">
            <Icon name="location" size={16} color={t.textMuted} />
            <Text muted style={{ flex: 1 }}>{[item.place_name, item.address].filter(Boolean).join(', ')}</Text>
          </Row>
        ) : null}
      </Stack>

      {clash ? (
        <Banner tone="warning" icon="calendar" title="Overlaps with another stop">
          {`Same time as ${clash.join(', ')}. Worth checking everyone can make both.`}
        </Banner>
      ) : null}

      {item.place_name || item.address || item.lat != null ? (
        <Button title="Directions" icon="directions" kind="secondary" onPress={openMaps} testID="stop-directions" />
      ) : null}

      {item.notes ? (
        <Card>
          <Text variant="label" muted>Notes</Text>
          <Text>{item.notes}</Text>
        </Card>
      ) : null}

      <Stack gap={space.sm}>
        <SectionTitle>Who’s going</SectionTitle>
        {active ? (
          <Segmented<RsvpStatus | 'none'>
            options={RSVP_OPTIONS}
            value={r.mine ?? 'none'}
            onChange={(v) => v !== 'none' && answer(v)}
          />
        ) : null}
        <Text variant="caption" muted testID="stop-going">
          {r.going.length ? `Going: ${names(r.going)}` : 'No one has said they’re going yet.'}
          {r.maybe.length ? `\nMaybe: ${names(r.maybe)}` : ''}
          {r.notGoing.length ? `\nNot going: ${names(r.notGoing)}` : ''}
        </Text>
      </Stack>

      <Stack gap={space.sm}>
        <SectionTitle>Comments</SectionTitle>
        {(comments.data ?? []).length === 0 ? <Text variant="caption" faint>No comments yet. Share a tip or ask a question.</Text> : null}
        {(comments.data ?? []).map((c) => (
          <Row key={c.id} gap={space.sm} align="flex-start">
            <Avatar id={c.user_id} name={nameOf(c.user_id)} url={byId.get(c.user_id)?.profile.avatar_url} size={32} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="caption" muted>
                {c.user_id === me ? 'You' : firstName(nameOf(c.user_id))} · {timeAgo(c.created_at)}
              </Text>
              <Text>{c.body}</Text>
            </View>
            {c.user_id === me || isOrganizer ? (
              <IconButton
                icon="trash"
                label="Delete comment"
                size={18}
                onPress={() =>
                  run(async () => {
                    await deleteItineraryComment(c.id);
                    await qc.invalidateQueries({ queryKey: keys.itineraryComments(item.id) });
                  })
                }
              />
            ) : null}
          </Row>
        ))}
        {active ? (
          <Row gap={space.sm} align="flex-end">
            <Field value={comment} onChangeText={setComment} placeholder="Add a comment" maxLength={1000} style={{ flex: 1 }} testID="stop-comment" />
            <Button
              title="Send"
              small
              disabled={!comment.trim()}
              loading={busy}
              testID="stop-comment-send"
              onPress={() =>
                run(async () => {
                  await addItineraryComment(id, item.id, comment.trim());
                  await qc.invalidateQueries({ queryKey: keys.itineraryComments(item.id) });
                }, () => setComment(''))
              }
            />
          </Row>
        ) : null}
      </Stack>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      <Text variant="caption" faint center>
        Added by {item.created_by === me ? 'you' : nameOf(item.created_by)}
        {item.updated_by ? ` · edited by ${item.updated_by === me ? 'you' : nameOf(item.updated_by)}` : ''}
      </Text>

      {canEdit ? (
        <Stack gap={space.sm}>
          <Row gap={space.sm}>
            <Button title="Earlier" icon="arrowUp" kind="secondary" small style={{ flex: 1 }} onPress={() => run(() => moveItineraryItem(item.id, true).then(() => qc.invalidateQueries({ queryKey: keys.itinerary(id) })))} />
            <Button title="Later" icon="arrowDown" kind="secondary" small style={{ flex: 1 }} onPress={() => run(() => moveItineraryItem(item.id, false).then(() => qc.invalidateQueries({ queryKey: keys.itinerary(id) })))} />
          </Row>
          <Button title="Edit" icon="edit" kind="secondary" onPress={() => router.push({ pathname: '/trip/[id]/plan/new', params: { id, itemId: item.id } })} testID="stop-edit" />
          <Button
            title="Remove from the plan"
            icon="trash"
            kind="ghost"
            onPress={async () => {
              if (!(await confirm('Remove this stop?', `"${item.title}" and its comments are removed for everyone.`, 'Remove', true))) return;
              run(async () => {
                await deleteItineraryItem(item.id);
                await qc.invalidateQueries({ queryKey: keys.itinerary(id) });
              }, () => router.back());
            }}
          />
        </Stack>
      ) : null}
    </Screen>
  );
}
