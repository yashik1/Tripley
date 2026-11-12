import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { flushOutbox } from './outbox';
import { flushPlanOutbox } from './plan-outbox';
import { keys } from './queries';

/** Send bills saved offline whenever we're (back) online, then refresh those trips. */
export function useOutboxSync(userId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    let stopped = false;
    const run = async () => {
      if (stopped || !onlineManager.isOnline()) return;
      const plan = await flushPlanOutbox(userId);
      for (const tripId of plan.tripIds) qc.invalidateQueries({ queryKey: keys.itinerary(tripId) });
      const { saved } = await flushOutbox(userId);
      for (const tripId of new Set(saved.map((s) => s.tripId))) {
        qc.invalidateQueries({ queryKey: keys.bills(tripId) });
        qc.invalidateQueries({ queryKey: keys.shares(tripId) });
        qc.invalidateQueries({ queryKey: keys.kitties(tripId) });
      }
    };
    run();
    const unsubscribeOnline = onlineManager.subscribe((online) => {
      if (online) run();
    });
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    const timer = setInterval(run, 30_000);
    return () => {
      stopped = true;
      unsubscribeOnline();
      appState.remove();
      clearInterval(timer);
    };
  }, [userId, qc]);
}
