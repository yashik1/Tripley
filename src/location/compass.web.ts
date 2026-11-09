/**
 * Browser compass: Chrome on Android sends "deviceorientationabsolute" events;
 * Safari on iPhone sends webkitCompassHeading after the person taps to allow it.
 * Desktops have no compass, so the arrow points relative to north there.
 */
import { useCallback, useEffect, useState } from 'react';

export type Compass = {
  heading: number | null;
  available: boolean;
  request: (() => Promise<void>) | null;
};

type OrientationEvt = DeviceOrientationEvent & { webkitCompassHeading?: number };
type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> };

export function useCompass(): Compass {
  const [heading, setHeading] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const needsPermission =
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof (DeviceOrientationEvent as unknown as PermissionApi).requestPermission === 'function';

  useEffect(() => {
    if (typeof window === 'undefined' || (needsPermission && !listening)) return;
    const onAbsolute = (e: Event) => {
      const alpha = (e as DeviceOrientationEvent).alpha;
      if (alpha != null) setHeading((360 - alpha) % 360);
    };
    const onIos = (e: Event) => {
      const h = (e as OrientationEvt).webkitCompassHeading;
      if (typeof h === 'number' && h >= 0) setHeading(h);
    };
    window.addEventListener('deviceorientationabsolute', onAbsolute);
    window.addEventListener('deviceorientation', onIos);
    return () => {
      window.removeEventListener('deviceorientationabsolute', onAbsolute);
      window.removeEventListener('deviceorientation', onIos);
    };
  }, [needsPermission, listening]);

  const request = useCallback(async () => {
    try {
      const res = await (DeviceOrientationEvent as unknown as PermissionApi).requestPermission?.();
      if (res === 'granted') setListening(true);
    } catch {
      // Not allowed; the arrow keeps pointing relative to north.
    }
  }, []);

  return { heading, available: heading != null || needsPermission, request: needsPermission && !listening ? request : null };
}

export type Fix = { lat: number; lng: number; accuracy: number | null };

export function useMyFix(): Fix | null {
  const [fix, setFix] = useState<Fix | null>(null);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null }),
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return fix;
}
