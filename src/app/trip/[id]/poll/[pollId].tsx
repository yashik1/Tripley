/** One poll (opened from a notification). */
import { router, useLocalSearchParams } from 'expo-router';

import { PollCard } from '@/components/GroupDecisions';
import { Banner, Button, Loading, Screen } from '@/components/ui';
import { usePolls } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';

export default function PollPage() {
  const id = useTripId();
  const { pollId } = useLocalSearchParams<{ pollId: string }>();
  const { me, nameOf, isOrganizer, active } = useTripData(id);
  const polls = usePolls(id);
  const poll = polls.data?.find((p) => p.id === pollId);
  if (polls.isLoading) return <Loading />;
  return (
    <Screen>
      {poll ? (
        <PollCard poll={poll} me={me} nameOf={nameOf} canModerate={isOrganizer} active={active} />
      ) : (
        <Banner tone="info" title="This poll isn’t here any more">It may have been removed.</Banner>
      )}
      <Button title="All polls" kind="secondary" onPress={() => router.replace(`/trip/${id}/polls`)} />
    </Screen>
  );
}
