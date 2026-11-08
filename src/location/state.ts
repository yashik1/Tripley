import AsyncStorage from '@react-native-async-storage/async-storage';

import { isTripActive } from '@/lib/api';
import type { SharingMode } from '@/lib/types';

/** What the background task needs to know, persisted so it works with the app closed. */
export type SharingTrip = { id: string; name: string; ends_on: string | null; ended_at: string | null };
export type SharingState = { trips: SharingTrip[]; mode: SharingMode };

const KEY = 'tripley.sharing.v1';

export async function saveSharingState(state: SharingState): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(state));
}

export async function loadSharingState(): Promise<SharingState | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SharingState) : null;
  } catch {
    return null;
  }
}

export async function clearSharingState(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

export function stillActive(trips: SharingTrip[]): SharingTrip[] {
  return trips.filter((t) => isTripActive({ ended_at: t.ended_at, ends_on: t.ends_on }));
}

/** Pick which trips to share with, and how often, from my memberships. */
export function sharingPlan(
  memberships: {
    trip_id: string;
    location_sharing: boolean;
    sharing_mode: SharingMode;
    trip: { id: string; name: string; ended_at: string | null; ends_on: string | null } | null;
  }[],
): SharingState {
  const active = memberships.filter(
    (m) => m.location_sharing && m.trip && isTripActive({ ended_at: m.trip.ended_at, ends_on: m.trip.ends_on }),
  );
  return {
    trips: active.map((m) => ({ id: m.trip_id, name: m.trip!.name, ends_on: m.trip!.ends_on, ended_at: m.trip!.ended_at })),
    mode: active.some((m) => m.sharing_mode === 'live') ? 'live' : 'saver',
  };
}

export type SharingStatus =
  | 'idle' // not on any active trip with sharing on
  | 'needs-permission' // sharing is on but we haven't been allowed location yet
  | 'background' // sharing even when the app is closed
  | 'foreground' // sharing only while the app is open
  | 'denied' // location permission refused
  | 'unavailable'; // location services off / unsupported
