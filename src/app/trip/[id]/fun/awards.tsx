/**
 * Trip Awards: eight light-hearted awards. One vote per award each, never
 * for yourself (the server checks too). Results show as votes come in, and
 * the leaders become the winners once the trip is over.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { FunIntro } from '@/components/TripFun';
import { Banner, Button, Card, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { voteAward, withdrawAwardVote } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { firstName, todayISO } from '@/lib/format';
import { keys, useFunVotes } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { awardHeadline, awardResults } from '@/lib/trip-fun';
import { tripStatus } from '@/lib/trip-status';
import { radius, space, useTheme } from '@/theme';

export default function TripAwards() {
  const id = useTripId();
  const t = useTheme();
  const qc = useQueryClient();
  const { trip, members, me, nameOf } = useTripData(id);
  const votes = useFunVotes(id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const order = useMemo(() => members.map((m) => m.user_id), [members]);
  const results = useMemo(() => awardResults(votes.data ?? [], order), [votes.data, order]);
  const over = trip ? tripStatus(trip, todayISO()).kind === 'completed' : false;
  const short = (uid: string) => (uid === me ? 'You' : firstName(nameOf(uid)));

  const vote = async (awardKey: string, nominee: string) => {
    setError(null);
    setBusy(`${awardKey}:${nominee}`);
    try {
      const mine = (votes.data ?? []).find((v) => v.award_key === awardKey && v.voter_id === me);
      if (mine?.nominee_id === nominee) await withdrawAwardVote(mine.id);
      else await voteAward(id, me, awardKey, nominee, mine?.id);
      await qc.invalidateQueries({ queryKey: keys.tripFunVotes(id) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <FunIntro emoji="🏆" title="Trip Awards" blurb="Vote for who made the trip. One vote per award; you can’t vote for yourself." />
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <Card testID="awards-results">
        <Text variant="heading">{over ? 'The winners' : 'Results so far'}</Text>
        {results.map((r) => (
          <Row key={r.key} gap={space.md}>
            <Text style={{ fontSize: 20 }}>{r.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text variant="label">{r.label}</Text>
              <Text variant="caption" muted testID={`award-result-${r.key}`}>{awardHeadline(r, over, short)}</Text>
            </View>
            {r.leaders.length === 1 ? <Text style={{ fontSize: 18 }}>{over ? '🥇' : '⭐'}</Text> : null}
          </Row>
        ))}
        {!over ? <Text variant="caption" faint>Leaders become the winners when the trip ends.</Text> : null}
      </Card>

      <SectionTitle>Vote</SectionTitle>
      {members.length < 2 ? <Banner tone="info">Invite someone to the trip to start voting.</Banner> : null}
      <Stack gap={space.md}>
        {results.map((r) => {
          const mine = (votes.data ?? []).find((v) => v.award_key === r.key && v.voter_id === me);
          return (
            <Card key={r.key} testID={`award-${r.key}`}>
              <Row gap={space.sm}>
                <Text style={{ fontSize: 22 }}>{r.emoji}</Text>
                <Text variant="heading" style={{ flex: 1 }}>{r.label}</Text>
              </Row>
              <Text variant="caption" muted>{mine ? `Your vote: ${short(mine.nominee_id)}. Tap again to take it back.` : 'Who deserves this one?'}</Text>
              <View style={{ gap: space.xs }}>
                {members.map((m) => {
                  const self = m.user_id === me;
                  const chosen = mine?.nominee_id === m.user_id;
                  const count = r.counts[m.user_id] ?? 0;
                  const leading = r.leaders.includes(m.user_id);
                  return (
                    <Pressable
                      key={m.user_id}
                      disabled={self || !!busy}
                      onPress={() => vote(r.key, m.user_id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: chosen, disabled: self }}
                      accessibilityLabel={`${m.profile.display_name || 'Friend'}, ${count} ${count === 1 ? 'vote' : 'votes'}${self ? ', you' : ''}`}
                      testID={`vote-${r.key}-${m.profile.display_name}`}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.sm,
                        padding: space.sm,
                        borderRadius: radius.md,
                        backgroundColor: chosen ? t.primarySoft : t.surfaceAlt,
                        opacity: self ? 0.55 : pressed ? 0.8 : 1,
                      })}>
                      <Text style={{ flex: 1 }} color={chosen ? t.primary : t.text}>
                        {m.profile.display_name || 'Friend'}
                        {self ? ' (you)' : ''}
                      </Text>
                      {leading ? <Text variant="caption">⭐</Text> : null}
                      <Text variant="caption" color={t.primary}>
                        {count} {count === 1 ? 'vote' : 'votes'}
                        {chosen ? ' ✓' : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          );
        })}
      </Stack>
      {busy ? <Button title="Saving…" kind="ghost" loading small /> : null}
    </Screen>
  );
}
