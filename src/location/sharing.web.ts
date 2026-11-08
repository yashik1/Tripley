/**
 * Web: browsers only allow location while the page is open, so sharing runs
 * in the foreground. People are prompted to install the app for background.
 */
import { useEffect } from 'react';

import { uploadMyLocation } from '@/lib/api';
import { saveSharingState, type SharingState, type SharingStatus } from './state';

export const supportsBackground = false;

async function permissionState(): Promise<PermissionState | 'unsupported'> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported';
  try {
    const p = await navigator.permissions.query({ name: 'geolocation' });
    return p.state;
  } catch {
    return 'prompt';
  }
}

export async function applySharing(state: SharingState): Promise<SharingStatus> {
  await saveSharingState(state);
  if (state.trips.length === 0) return 'idle';
  const p = await permissionState();
  if (p === 'unsupported') return 'unavailable';
  if (p === 'denied') return 'denied';
  if (p === 'prompt') return 'needs-permission';
  return 'foreground';
}

export function requestLocationPermission(): Promise<'background' | 'foreground' | 'denied'> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve('denied');
    navigator.geolocation.getCurrentPosition(
      () => resolve('foreground'),
      () => resolve('denied'),
      { enableHighAccuracy: true, timeout: 20_000 },
    );
  });
}

export function useForegroundSharing(enabled: boolean, tripIds: string[]) {
  const key = tripIds.join(',');
  useEffect(() => {
    if (!enabled || !key || !navigator.geolocation) return;
    const ids = key.split(',');
    let last: { t: number; lat: number; lng: number } | null = null;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const { latitude, longitude } = pos.coords;
        if (last) {
          const moved = distanceMeters(last.lat, last.lng, latitude, longitude);
          if (now - last.t < 15_000 && moved < 25) return;
        }
        last = { t: now, lat: latitude, lng: longitude };
        uploadMyLocation(ids, {
          latitude,
          longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          timestamp: pos.timestamp,
        }).catch(() => undefined);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, key]);
}

export async function openLocationSettings(): Promise<void> {
  // Browsers manage this per site in their own settings.
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
