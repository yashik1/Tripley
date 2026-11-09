import { Platform } from 'react-native';

/**
 * Web only: register the service worker (public/sw.js) so the app opens
 * without a connection after the first visit and can be installed to the home
 * screen. Skipped in development, where it would cache the dev server.
 */
export function registerServiceWorker(): void {
  if (Platform.OS !== 'web' || __DEV__) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const register = () => navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
