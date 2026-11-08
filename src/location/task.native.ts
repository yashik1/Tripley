/**
 * Background location task. This file is imported at app start (root layout)
 * so the task is defined even when the OS wakes the app in the background
 * with a new location while it is closed.
 */
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { uploadMyLocation } from '@/lib/api';
import { currentUserId } from '@/lib/supabase';
import { loadSharingState, stillActive } from './state';

export const LOCATION_TASK = 'tripley-location-updates';

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const latest = data.locations[data.locations.length - 1];
  const state = await loadSharingState();
  const trips = stillActive(state?.trips ?? []);
  if (trips.length === 0 || !(await currentUserId())) {
    // Trip over, sharing paused everywhere, or signed out: stop tracking.
    await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
    return;
  }
  const battery = await Battery.getBatteryLevelAsync().catch(() => null);
  await uploadMyLocation(
    trips.map((t) => t.id),
    {
      latitude: latest.coords.latitude,
      longitude: latest.coords.longitude,
      accuracy: latest.coords.accuracy,
      heading: latest.coords.heading,
      speed: latest.coords.speed,
      timestamp: latest.timestamp,
      battery: battery != null && battery >= 0 ? battery : null,
    },
  ).catch(() => undefined);
});
