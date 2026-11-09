/**
 * The device's saved copy of trip data (for offline use) and the rules that
 * keep it to one account: it is tied to the account that made it, cleared on
 * sign-out, and thrown away if a different account signs in.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { QueryClient } from '@tanstack/react-query';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';

import { clearSharingState } from '@/location/state';
import { CACHE_MAX_AGE_MS, cacheBelongsToSomeoneElse, shouldPersistQuery } from './cache-policy';
import { clearOutboxFor } from './outbox';
import { clearPendingJoin } from './pending-join';

const CACHE_KEY = 'tripley.cache.v2';
const OWNER_KEY = 'tripley.cache.owner';
// Earlier versions saved live positions too; that copy is deleted on start.
const OLD_KEYS = ['tripley.cache.v1'];

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: CACHE_KEY, throttleTime: 2000 });

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: CACHE_MAX_AGE_MS,
  buster: 'v2',
  dehydrateOptions: {
    shouldDehydrateQuery: (q) => shouldPersistQuery(q.queryKey, q.state.status),
  },
};

AsyncStorage.multiRemove(OLD_KEYS).catch(() => undefined);

/** Call when the signed-in account is known: drops another account's saved data. */
export async function adoptDeviceData(qc: QueryClient, userId: string): Promise<void> {
  let owner: string | null = null;
  try {
    owner = await AsyncStorage.getItem(OWNER_KEY);
  } catch {
    // Unreadable storage: treat as someone else's to be safe.
    owner = 'unknown';
  }
  if (cacheBelongsToSomeoneElse(owner, userId)) {
    qc.clear();
    await persister.removeClient();
  }
  await AsyncStorage.setItem(OWNER_KEY, userId).catch(() => undefined);
}

/** Sign-out (or a session that ended): nothing of this account stays on the device. */
export async function forgetDeviceData(qc: QueryClient, userId: string | null): Promise<void> {
  qc.clear();
  await Promise.all([
    persister.removeClient(),
    AsyncStorage.removeItem(OWNER_KEY).catch(() => undefined),
    userId ? clearOutboxFor(userId) : Promise.resolve(),
    clearPendingJoin().catch(() => undefined),
    clearSharingState().catch(() => undefined),
  ]);
}
