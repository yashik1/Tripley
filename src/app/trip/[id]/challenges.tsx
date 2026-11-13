/**
 * Adventure Scavenger Hunt: the group's challenges. Anyone on the trip starts
 * one (from the ideas or their own); you complete it with proof, a post in
 * the trip feed (a photo, a find or a story), and the group's reactions say
 * which entry they love most. Progress shows how much of the hunt is done.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ActivityRow } from '@/components/ActivityRow';
import { ProgressBar } from '@/components/Travel';
import { FunIntro } from '@/components/TripFun';
import { Banner, Button, Card, EmptyState, Field, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { createChallenge } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { firstName } from '@/lib/format';
import { CHALLENGE_IDEAS } from '@/lib/preparation';
import { keys, useChallenges, useTripPosts } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { themeInfo } from '@/lib/trip-themes';
import { radius, space, useTheme } from '@/theme';

export default function ScavengerHunt() {
  const id = useTripId();
  const t = useTheme();
  const qc = useQueryClient();
  const { trip, me, nameOf, active } = useTripData(id);
  const challenges = useChallenges(id);
  // Every post (not just the feed's first page), so older proof still shows.
  const posts = useTripPosts(id).data ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [own, setOwn] = useState('');
  const list = challenges.data ?? [];
  const started = new Set(list.map((c) => c.title.trim().toLowerCase()));
  // The trip's theme (beach, ski…) suggests its own challenges first.
  const theme = themeInfo(trip?.theme);
  const themed = (theme?.challenges ?? []).filter((c) => !started.has(c.title.toLowerCase()));
  const done = list.filter((c) => c.challenge_entries.length > 0).length;
  const mineDone = list.filter((c) => c.challenge_entries.some((e) => e.user_id === me)).length;

  const start = async (title: string, description: string | null, emoji: string) => {
    setBusy(title);
    setError(null);
    try {
      await createChallenge(id, title, description, emoji);
      await qc.invalidateQueries({ queryKey: keys.challenges(id) });
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const short = (uid: string) => (uid === me ? 'you' : firstName(nameOf(uid)));

  return (
    <Screen>
      <FunIntro emoji="🧭" title="Adventure Scavenger Hunt" blurb="Challenges for the whole group. Complete one by posting your proof (a photo, a find or a story) to the trip feed." />
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {list.length ? (
        <Card testID="hunt-progress">
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="heading">{done} of {list.length} {list.length === 1 ? 'challenge' : 'challenges'} done</Text>
            <Text variant="label" color={t.primary}>{Math.round((done / list.length) * 100)}%</Text>
          </Row>
          <ProgressBar value={(done / list.length) * 100} label={`${done} of ${list.length} challenges done`} />
          <Text variant="caption" muted>
            You’ve completed {mineDone}. {done === list.length ? 'The whole hunt is done. 🎉' : 'Keep going!'}
          </Text>
        </Card>
      ) : !challenges.isLoading ? (
        <EmptyState icon="trophy" title="No challenges yet" body="Start one below to get the hunt going." />
      ) : null}

      {list.map((c) => {
        const entries = c.challenge_entries.map((e) => posts.find((p) => p.id === e.post_id)).filter((p): p is NonNullable<typeof p> => !!p);
        const ranked = [...entries].sort((a, b) => b.post_reactions.length - a.post_reactions.length);
        const entered = c.challenge_entries.some((e) => e.user_id === me);
        const finishers = [...new Set(c.challenge_entries.map((e) => e.user_id))];
        const complete = finishers.length > 0;
        return (
          <Card key={c.id} testID={`challenge-${c.title}`}>
            <Row gap={space.md}>
              <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: complete ? t.successSoft : t.yellowSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 22 }}>{complete ? '✅' : c.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="heading">{c.title}</Text>
                <Text variant="caption" muted testID="challenge-status">
                  {complete
                    ? `Done by ${finishers.map(short).join(', ')} · ${c.challenge_entries.length} ${c.challenge_entries.length === 1 ? 'entry' : 'entries'}`
                    : 'Not done yet'}{' '}
                  · started by {short(c.created_by)}
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
                title={entered ? 'Add more proof' : 'Done it? Add photo proof'}
                icon="camera"
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
          <Card>
            <Field label="Your own challenge" value={own} onChangeText={setOwn} placeholder="Find the oldest café in town" maxLength={120} testID="challenge-own" />
            <Button
              title="Start it"
              small
              disabled={!own.trim()}
              loading={busy === own.trim()}
              onPress={async () => {
                if (await start(own.trim(), null, '🧭')) setOwn('');
              }}
              testID="challenge-own-start"
            />
          </Card>
          {theme && themed.length ? (
            <Text variant="label" muted testID="hunt-theme-ideas">
              {theme.emoji} For {theme.phrase}
            </Text>
          ) : null}
          {[...themed, ...CHALLENGE_IDEAS.filter((c) => !started.has(c.title.toLowerCase()))].map((c) => (
            <Card key={c.title}>
              <Row gap={space.md}>
                <Text style={{ fontSize: 22 }}>{c.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text variant="label">{c.title}</Text>
                  <Text variant="caption" muted>{c.description}</Text>
                </View>
                <Button title="Start" small kind="secondary" loading={busy === c.title} onPress={() => start(c.title, c.description, c.emoji)} testID={`challenge-start-${c.title}`} />
              </Row>
            </Card>
          ))}
        </Stack>
      ) : (
        <Banner tone="info">This trip has ended, so the hunt is closed. Its challenges and proof stay here and in the scrapbook.</Banner>
      )}
    </Screen>
  );
}
