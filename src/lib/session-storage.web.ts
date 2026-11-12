/**
 * Browsers have no secure storage for the page itself, so the session stays
 * in the site's local storage (protected by the browser and the site's
 * Content-Security-Policy, and removed on sign-out).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const sessionStorage = AsyncStorage;
