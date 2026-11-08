import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { listMySharingMemberships } from '@/lib/api';
import { keys } from '@/lib/queries';
import {
  applySharing,
  openLocationSettings,
  requestLocationPermission,
  supportsBackground,
  useForegroundSharing,
} from '@/location/sharing';
import { sharingPlan, type SharingState, type SharingStatus } from '@/location/state';

type SharingContextValue = {
  status: SharingStatus;
  plan: SharingState;
  supportsBackground: boolean;
  /** Ask for permission (from a button press), then start sharing. */
  enable: () => Promise<void>;
  /** Re-read memberships (e.g. after pausing a trip) and apply. */
  refresh: () => Promise<void>;
  openSettings: () => Promise<void>;
};

const SharingContext = createContext<SharingContextValue | null>(null);
const EMPTY: SharingState = { trips: [], mode: 'live' };

/**
 * Keeps location sharing in sync with the trips I'm on. Always mounted; when
 * signed out (userId null) the plan is empty, which stops sharing.
 */
export function SharingProvider({ children, userId }: { children: ReactNode; userId: string | null }) {
  const memberships = useQuery({
    queryKey: [...keys.sharing, userId ?? 'signed-out'],
    queryFn: listMySharingMemberships,
    refetchInterval: 5 * 60_000,
    enabled: !!userId,
  });
  const data = userId ? memberships.data : undefined;
  const plan = useMemo(() => (data ? sharingPlan(data as never) : EMPTY), [data]);
  const [status, setStatus] = useState<SharingStatus>('idle');

  const apply = useCallback(async () => {
    try {
      setStatus(await applySharing(plan));
    } catch {
      setStatus('unavailable');
    }
  }, [plan]);

  useEffect(() => {
    let cancelled = false;
    applySharing(plan)
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus('unavailable'));
    return () => {
      cancelled = true;
    };
  }, [plan]);

  // Permissions can change in system settings while we're away.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') apply();
    });
    return () => sub.remove();
  }, [apply]);

  useForegroundSharing(status === 'foreground', plan.trips.map((t) => t.id));

  const value = useMemo<SharingContextValue>(
    () => ({
      status,
      plan,
      supportsBackground,
      enable: async () => {
        await requestLocationPermission();
        await apply();
      },
      refresh: async () => {
        await memberships.refetch();
      },
      openSettings: openLocationSettings,
    }),
    [status, plan, apply, memberships],
  );

  return <SharingContext.Provider value={value}>{children}</SharingContext.Provider>;
}

export function useSharing(): SharingContextValue {
  const ctx = useContext(SharingContext);
  if (!ctx) {
    return {
      status: 'idle',
      plan: EMPTY,
      supportsBackground,
      enable: async () => undefined,
      refresh: async () => undefined,
      openSettings: async () => undefined,
    };
  }
  return ctx;
}
