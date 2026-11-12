/**
 * Phones: the sign-in session lives in secure storage. Readable after the
 * phone's first unlock (not only while unlocked), so background location
 * sharing keeps working with the screen locked; still encrypted at rest and
 * never in plain app storage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { createChunkedStorage } from './secure-session';

const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

export const sessionStorage = createChunkedStorage(
  {
    getItemAsync: (key) => SecureStore.getItemAsync(key, options),
    setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, options),
    deleteItemAsync: (key) => SecureStore.deleteItemAsync(key, options),
  },
  AsyncStorage,
);
