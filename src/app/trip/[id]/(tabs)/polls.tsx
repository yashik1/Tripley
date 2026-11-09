/** Group polls: open ones first, then the results of closed ones. */
import { router } from 'expo-router';
import { RefreshControl } from 'react-native';

import { PlanSwitch, PollCard } from '@/components/GroupDecisions';
import { Skeleton } from '@/components/Travel';
import { Button, EmptyState, Screen, SectionTitle, Stack } from '@/components/ui';
import { pollIsOpen } from '@/lib/group-decisions';
import { usePolls } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { space } from '@/theme';

export default function Polls() {
  const id = useTripId();
  const { me, nameOf, isOrganizer, active } = useTripData(id);
  const polls = usePolls(id);
  const all = polls.data ?? [];
  const open = all.filter((p) => pollIsOpen(p));
  const closed = all.filter((p) => !pollIsOpen(p));
  return (
    <Screen
      refreshControl={<RefreshControl refreshing={polls.isRefetching} onRefresh={() => { polls.refetch(); }} />}
      footer={active ? <Button title="Start a poll" icon="poll" onPress={() => router.push({ pathname: '/trip/[id]/poll/new', params: { id } })} testID="start-poll" /> : undefined}>
      <PlanSwitch tripId={id} value="polls" />
      {polls.isLoading ? (
        <Skeleton height={180} />
      ) : all.length === 0 ? (
        <EmptyState icon="poll" title="Can’t decide? Ask the group" body="Where to eat, what to book, when to leave: start a poll and everyone taps their pick." />
      ) : (
        <>
          {open.length > 0 ? (
            <Stack gap={space.sm}>
              <SectionTitle>Open</SectionTitle>
              {open.map((p) => <PollCard key={p.id} poll={p} me={me} nameOf={nameOf} canModerate={isOrganizer} active={active} />)}
            </Stack>
          ) : null}
          {closed.length > 0 ? (
            <Stack gap={space.sm}>
              <SectionTitle>Decided</SectionTitle>
              {closed.map((p) => <PollCard key={p.id} poll={p} me={me} nameOf={nameOf} canModerate={isOrganizer} active={active} />)}
            </Stack>
          ) : null}
        </>
      )}
    </Screen>
  );
}
