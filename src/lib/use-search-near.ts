import { useMemo } from 'react';

import { centreOf } from './geocode';
import { usePlaces, useTrip } from './queries';

/**
 * Where place searches for a trip should look first: the destination picked
 * from search, else the middle of the group's pins. Never anyone's live
 * location, and nothing that would ask for location permission.
 */
export function useSearchNear(tripId: string): { lat: number; lng: number } | null {
  const trip = useTrip(tripId);
  const places = usePlaces(tripId);
  const lat = trip.data?.destination_lat ?? null;
  const lng = trip.data?.destination_lng ?? null;
  return useMemo(() => {
    if (lat != null && lng != null) return { lat, lng };
    return centreOf((places.data ?? []).map((p) => ({ lat: p.lat, lng: p.lng })));
  }, [lat, lng, places.data]);
}
