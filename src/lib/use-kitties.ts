import { useMemo } from 'react';

import { kittySummary, type KittySummary } from './kitty';
import { useBills, useKitties, useKittyOwnCash, useSettlements } from './queries';
import type { Kitty } from './types';

/** Each kitty on the trip with how much cash is in it and its history. */
export function useKittySummaries(tripId: string): { kitty: Kitty; summary: KittySummary }[] {
  const kitties = useKitties(tripId);
  const settlements = useSettlements(tripId);
  const bills = useBills(tripId);
  const own = useKittyOwnCash(tripId);
  return useMemo(
    () =>
      (kitties.data ?? []).map((kitty) => ({
        kitty,
        summary: kittySummary(kitty.id, settlements.data ?? [], bills.data ?? [], own.data ?? []),
      })),
    [kitties.data, settlements.data, bills.data, own.data],
  );
}
