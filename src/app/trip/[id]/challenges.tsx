/**
 * Optional, light-hearted group challenges. Entries are members' own feed
 * posts; the group's reactions say which one they love most.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ActivityRow } from '@/components/ActivityRow';
import { Banner, Button, Card, EmptyState, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { createChallenge } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { firstName } from '@/lib/format';
import { CHALLENGE_IDEAS } from '@/lib/preparation';
import { keys, useChallenges, useFeed } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { radius, space, useTheme } from '@/theme';

export default function Challenges() {
  const id = useTripId();
  const t = useTheme();
  const qc = useQueryClient();
  const { me, nameOf, active } = useTripData(id);
  const challenges = useChallenges(id);
  const feed = useFeed(id);
  const posts = (feed.data?.pages ?? []).flat();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = new Set((challenges.data ?? []).map((c) => c.title));

  const start = async (idea: (typeof CHALLENGE_IDEAS)[number]) => {
    setBusy(idea.title);
    setError(null);
    try {
      await createChallenge(id, idea.title, idea.description, idea.emoji);
      await qc.invalidateQueries({ queryKey: keys.challenges(id) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Text muted>Just for fun. Enter with a post (a photo, a find, a story); everyone reacts to their favourites.</Text>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {(challenges.data ?? []).length === 0 && !challenges.isLoading ? (
        <EmptyState icon="trophy" title="No challenges yet" body="Pick one below to get the group going." />
      ) : null}
      {(challenges.data ?? []).map((c) => {
        const entries = c.challenge_entries.map((e) => posts.find((p) => p.id === e.post_id)).filter((p): p is NonNullable<typeof p> => !!p);
        const ranked = [...entries].sort((a, b) => b.post_reactions.length - a.post_reactions.length);
        const entered = c.challenge_entries.some((e) => e.user_id === me);
        return (
          <Card key={c.id} testID={`challenge-${c.title}`}>
            <Row gap={space.md}>
              <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: t.yellowSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 22 }}>{c.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="heading">{c.title}</Text>
                <Text variant="caption" muted>
                  {c.challenge_entries.length} {c.challenge_entries.length === 1 ? 'entry' : 'entries'} · started by {c.created_by === me ? 'you' : firstName(nameOf(c.created_by))}
                </Text>
              </View>
            </Row>
            {c.description ? <Text variant="caption">{c.description}</Text> : null}
            {ranked.length ? (
              <View>
                {ranked.slice(0, 3).map((p, i) => (
                  <ActivityRow key={p.id} post={p} me={me} first={i === 0} />
                ))}
              </View>
            ) : null}
            {active ? (
              <Button
                title={entered ? 'Enter another' : 'Enter with a post'}
                icon="send"
                small
                kind={entered ? 'secondary' : 'primary'}
                onPress={() => router.push({ pathname: '/trip/[id]/post/new', params: { id, kind: 'photos', challenge: c.id } })}
                testID="challenge-enter"
              />
            ) : null}
          </Card>
        );
      })}
      {active ? (
        <Stack gap={space.sm}>
          <SectionTitle>Start a challenge</SectionTitle>
          {CHALLENGE_IDEAS.filter((c) => !started.has(c.title)).map((c) => (
            <Card key={c.title}>
              <Row gap={space.md}>
                <Text style={{ fontSize: 22 }}>{c.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text variant="label">{c.title}</Text>
                  <Text variant="caption" muted>{c.description}</Text>
                </View>
                <Button title="Start" small kind="secondary" loading={busy === c.title} onPress={() => start(c)} testID={`challenge-start-${c.title}`} />
              </Row>
            </Card>
          ))}
        </Stack>
      ) : null}
    </Screen>
  );
}
