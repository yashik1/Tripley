/**
 * Trip Fun: one tile on the trip overview opens this hub, so the overview
 * stays uncluttered. Each feature opens on its own screen; the feature
 * catalogue decides which are on (and which need Pro).
 */
import { router, type Href } from 'expo-router';
import { View } from 'react-native';

import { Card, Row, Screen, Text } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { isPro } from '@/lib/api';
import { useAccount, useChallenges, useFunCatalogue, useFunEntries, useFunVotes, useMemories, useStamps, useTripPosts } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { enabledFeatures, FUN_FEATURES, passportStats, type FunFeatureKey } from '@/lib/trip-fun';
import { radius, space, useTheme } from '@/theme';

export default function TripFunHub() {
  const id = useTripId();
  const t = useTheme();
  const catalogue = useFunCatalogue();
  const account = useAccount();
  const memories = useMemories(id);
  const posts = useTripPosts(id);
  const entries = useFunEntries(id);
  const votes = useFunVotes(id);
  const challenges = useChallenges(id);
  const stamps = useStamps();

  const on = enabledFeatures(catalogue.data);
  const pro = isPro(account.data);
  const needsPro = (key: FunFeatureKey) => !pro && catalogue.data?.find((f) => f.feature_key === key)?.minimum_plan === 'pro';

  const photoPosts = (posts.data ?? []).filter((p) => p.kind !== 'event' && p.post_photos.length).length;
  const list = entries.data ?? [];
  const hunt = challenges.data ?? [];
  const huntDone = hunt.filter((c) => c.challenge_entries.length > 0).length;
  const stats = passportStats(stamps.data ?? [], []);
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

  const detail: Record<FunFeatureKey, string> = {
    travel_scrapbook: n((memories.data?.length ?? 0) + photoPosts, 'memory', 'memories'),
    travel_passport: `${n(stats.countries, 'country', 'countries')} · ${n(stamps.data?.length ?? 0, 'stamp', 'stamps')}`,
    scavenger_hunt: hunt.length ? `${huntDone} of ${n(hunt.length, 'challenge', 'challenges')} done` : 'No challenges yet',
    trip_awards: n(votes.data?.length ?? 0, 'vote', 'votes'),
    trip_soundtrack: n(list.filter((e) => e.kind === 'soundtrack').length, 'song', 'songs'),
    food_explorer: n(list.filter((e) => e.kind === 'food').length, 'find', 'finds'),
    living_timeline: 'Plans, posts, photos and finds in order',
    adventure_wheel: 'Spin for an idea',
    secret_missions: n(list.filter((e) => e.kind === 'mission').length, 'mission', 'missions'),
  };
  const route: Record<FunFeatureKey, Href> = {
    travel_scrapbook: `/trip/${id}/fun/scrapbook`,
    travel_passport: '/passport',
    scavenger_hunt: `/trip/${id}/challenges`,
    trip_awards: `/trip/${id}/fun/awards`,
    trip_soundtrack: `/trip/${id}/fun/soundtrack`,
    food_explorer: `/trip/${id}/fun/food`,
    living_timeline: `/trip/${id}/fun/timeline`,
    adventure_wheel: `/trip/${id}/fun/wheel`,
    secret_missions: `/trip/${id}/fun/missions`,
  };

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <Text variant="title" accessibilityRole="header">Trip Fun</Text>
        <Text muted>Memories, games and discoveries for the group, all in one place.</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {FUN_FEATURES.filter((f) => on.includes(f.key)).map((f) => {
          const locked = needsPro(f.key);
          return (
            <Card
              key={f.key}
              onPress={() => router.push(locked ? '/pro' : route[f.key])}
              accessibilityLabel={f.title}
              testID={`fun-${f.key}`}
              style={{ flexBasis: 300, flexGrow: 1, padding: space.md }}>
              <Row gap={space.md}>
                <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 24 }}>{f.emoji}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Row gap={space.sm}>
                    <Text variant="label" style={{ flexShrink: 1 }}>{f.title}</Text>
                    {locked ? <Text variant="caption" color={t.primary}>Pro</Text> : null}
                  </Row>
                  <Text variant="caption" muted numberOfLines={2}>{f.blurb}</Text>
                  <Text variant="caption" color={t.primary}>{detail[f.key]}</Text>
                </View>
                <Icon name="chevron" size={16} color={t.textFaint} />
              </Row>
            </Card>
          );
        })}
      </View>
      <Text variant="caption" faint center>Your passport is personal; everything else is shared with the people on this trip.</Text>
    </Screen>
  );
}
