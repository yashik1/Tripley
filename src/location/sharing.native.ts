import * as Location from 'expo-location';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { uploadMyLocation } from '@/lib/api';
import { saveSharingState, type SharingState, type SharingStatus } from './state';
import { LOCATION_TASK } from './task';

export const supportsBackground = true;

const optionsFor = (state: SharingState): Location.LocationTaskOptions => {
  const names = state.trips.map((t) => t.name).join(', ');
  const common = {
    showsBackgroundLocationIndicator: true,
    activityType: Location.ActivityType.Other,
    foregroundService: {
      notificationTitle: `Sharing location with ${names}`,
      notificationBody: 'Your trip friends can see you. Pause anytime from the map in Tripley.',
      notificationColor: '#117C78',
      killServiceOnDestroy: false,
    },
  };
  return state.mode === 'live'
    ? {
        ...common,
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 30,
        timeInterval: 30_000,
        pausesUpdatesAutomatically: false,
      }
    : {
        ...common,
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 500,
        timeInterval: 5 * 60_000,
        deferredUpdatesDistance: 500,
        deferredUpdatesInterval: 5 * 60_000,
        pausesUpdatesAutomatically: true,
      };
};

let lastSignature = '';

/** Start, update or stop background sharing to match `state`. Never prompts. */
export async function applySharing(state: SharingState): Promise<SharingStatus> {
  await saveSharingState(state);
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (state.trips.length === 0) {
    if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
    lastSignature = '';
    return 'idle';
  }
  if (!(await Location.hasServicesEnabledAsync().catch(() => true))) return 'unavailable';
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return fg.canAskAgain ? 'needs-permission' : 'denied';
  const bg = await Location.getBackgroundPermissionsAsync();
  if (!bg.granted) {
    if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
    return 'foreground';
  }
  const signature = JSON.stringify([state.mode, state.trips.map((t) => t.id).sort()]);
  if (started && signature !== lastSignature) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
  }
  if (!started || signature !== lastSignature) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, optionsFor(state));
  }
  lastSignature = signature;
  return 'background';
}

/** Ask for location ("while using" first, then "always"). Call from a button press. */
export async function requestLocationPermission(): Promise<'background' | 'foreground' | 'denied'> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => null);
  return bg?.granted ? 'background' : 'foreground';
}

/**
 * While the app is open and we only have "while using" permission, keep
 * uploading from the foreground.
 */
export function useForegroundSharing(enabled: boolean, tripIds: string[]) {
  const key = tripIds.join(',');
  useEffect(() => {
    if (!enabled || !key) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    const ids = key.split(',');
    const start = async () => {
      if (sub || cancelled) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 25, timeInterval: 15_000 },
        (loc) => {
          uploadMyLocation(ids, {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy: loc.coords.accuracy,
            heading: loc.coords.heading,
            speed: loc.coords.speed,
            timestamp: loc.timestamp,
          }).catch(() => undefined);
        },
      ).catch(() => null);
      if (cancelled) sub?.remove();
    };
    start();
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') start();
      else {
        sub?.remove();
        sub = null;
      }
    });
    return () => {
      cancelled = true;
      sub?.remove();
      appSub.remove();
    };
  }, [enabled, key]);
}

export async function openLocationSettings(): Promise<void> {
  const { Linking } = await import('react-native');
  await Linking.openSettings();
}
