/** The group's bucket list: ideas anyone can suggest and vote on, then add to the plan. */
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import { PlanSwitch, SuggestionCard } from '@/components/GroupDecisions';
import { Skeleton } from '@/components/Travel';
import { Button, Chip, EmptyState, Screen, Stack, Text } from '@/components/ui';
import { CATEGORIES, rankSuggestions } from '@/lib/group-decisions';
import { useSuggestions } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { space } from '@/theme';

export default function Ideas() {
  const id = useTripId();
  const { me, nameOf, isOrganizer, active } = useTripData(id);
  const ideas = useSuggestions(id);
  const [cat, setCat] = useState<string | null>(null);
  const list = rankSuggestions((ideas.data ?? []).filter((s) => !cat || s.category === cat));
  return (
    <Screen
      refreshControl={<RefreshControl refreshing={ideas.isRefetching} onRefresh={() => { ideas.refetch(); }} />}
      footer={active ? <Button title="Suggest a place or activity" icon="idea" onPress={() => router.push({ pathname: '/trip/[id]/idea/new', params: { id } })} testID="suggest-idea" /> : undefined}>
      <PlanSwitch tripId={id} value="ideas" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.xs }}>
        <Chip label="All" selected={!cat} onPress={() => setCat(null)} />
        {CATEGORIES.map((c) => (
          <Chip key={c.key} label={`${c.emoji} ${c.label}`} selected={cat === c.key} onPress={() => setCat(cat === c.key ? null : c.key)} />
        ))}
      </ScrollView>
      {ideas.isLoading ? (
        <Stack gap={space.sm}>
          <Skeleton height={140} />
          <Skeleton height={140} />
        </Stack>
      ) : list.length === 0 ? (
        <EmptyState
          icon="idea"
          title={cat ? 'No ideas in this category yet' : 'Start the bucket list'}
          body="Suggest restaurants, beaches, hikes or experiences. Everyone votes, and the favourites go into the plan."
        />
      ) : (
        <Stack gap={space.sm}>
          <Text variant="caption" muted>Most votes first. Tap 👍 to vote; anyone can add an idea to the plan.</Text>
          {list.map((s) => (
            <SuggestionCard key={s.id} s={s} me={me} nameOf={nameOf} canModerate={isOrganizer} active={active} />
          ))}
        </Stack>
      )}
    </Screen>
  );
}
