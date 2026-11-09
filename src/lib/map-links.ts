import { Platform } from 'react-native';

/** Turn-by-turn directions in the phone's maps app (or Google Maps on the web). */
export function directionsUrl(lat: number, lng: number): string {
  return Platform.OS === 'ios'
    ? `http://maps.apple.com/?daddr=${lat},${lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
