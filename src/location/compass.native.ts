/**
 * Live heading (which way the phone points) and position, for the friend finder.
 */
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export type Compass = {
  /** Degrees from north the top of the phone points to, or null if unknown. */
  heading: number | null;
  /** True if the device has a compass we can read. */
  available: boolean;
  /** Ask for access where the platform needs a tap first (iPhone Safari). */
  request: (() => Promise<void>) | null;
};

export function useCompass(): Compass {
  const [heading, setHeading] = useState<number | null>(null);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchHeadingAsync((h) => {
      const v = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
      if (!cancelled && Number.isFinite(v) && v >= 0) setHeading(v);
    })
      .then((s) => {
        if (cancelled) s.remove();
        else sub = s;
      })
      .catch(() => !cancelled && setAvailable(false));
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);
  return { heading, available, request: null };
}

export type Fix = { lat: number; lng: number; accuracy: number | null };

/** My position, updated often and accurately while the finder is open. */
export function useMyFix(): Fix | null {
  const [fix, setFix] = useState<Fix | null>(null);
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 2, timeInterval: 2000 },
      (p) => !cancelled && setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null }),
    )
      .then((s) => {
        if (cancelled) s.remove();
        else sub = s;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);
  return fix;
}
