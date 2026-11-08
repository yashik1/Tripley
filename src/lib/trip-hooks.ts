import { useMemo } from 'react';

import { useMyId } from '@/providers/AuthProvider';
import { isTripActive } from './api';
import { useMembers, useTrip } from './queries';
import type { Member } from './types';

/** Trip + members + handy lookups, shared by all trip screens. */
export function useTripData(tripId: string) {
  const me = useMyId();
  const trip = useTrip(tripId);
  const members = useMembers(tripId);
  return useMemo(() => {
    const list = members.data ?? [];
    const byId = new Map<string, Member>(list.map((m) => [m.user_id, m]));
    const nameOf = (id: string) =>
      id === me ? 'You' : byId.get(id)?.profile.display_name?.trim() || 'Former member';
    return {
      me,
      trip: trip.data ?? null,
      members: list,
      byId,
      nameOf,
      myMembership: byId.get(me) ?? null,
      isOrganizer: trip.data?.organizer_id === me,
      // Treat the trip as active until it has loaded, so nothing flashes "ended".
      active: trip.data ? isTripActive(trip.data) : true,
      loading: trip.isLoading || members.isLoading,
      error: trip.error ?? members.error,
      refetch: async () => {
        await Promise.all([trip.refetch(), members.refetch()]);
      },
    };
  }, [me, trip, members]);
}
