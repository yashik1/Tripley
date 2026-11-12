/**
 * Plan stops added without a connection wait here (on the device) and are
 * sent when the connection is back. Each carries a client id, so a retry
 * after a dropped response never adds the stop twice (the server ignores a
 * second insert with the same id).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { addItineraryItemOnce, type ItineraryInput } from './api';
import { outboxItemExpired } from './cache-policy';
import { errorMessage, isNetworkError } from './errors';

const KEY = 'tripley.plan-outbox.v1';

export type QueuedStop = {
  clientId: string;
  userId: string;
  tripId: string;
  queuedAt: string;
  input: ItineraryInput;
  /** Set when the server refused it (not a connection problem). */
  error?: string;
};

let cache: QueuedStop[] | null = null;
const listeners = new Set<() => void>();

async function load(): Promise<QueuedStop[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as QueuedStop[]) : [];
    cache = all.filter((x) => !outboxItemExpired(x.queuedAt));
    if (cache.length !== all.length) await AsyncStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    cache = [];
  }
  return cache;
}

async function save(list: QueuedStop[]): Promise<void> {
  cache = list;
  listeners.forEach((fn) => fn());
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or unavailable: the stop still shows until the app closes.
  }
}

export async function queueStop(item: Omit<QueuedStop, 'queuedAt'>): Promise<void> {
  const list = await load();
  await save([...list.filter((x) => x.clientId !== item.clientId), { ...item, queuedAt: new Date().toISOString() }]);
}

export async function discardQueuedStop(clientId: string): Promise<void> {
  await save((await load()).filter((x) => x.clientId !== clientId));
}

/** On sign-out: this person's unsynced stops leave the device (others' stay). */
export async function clearPlanOutboxFor(userId: string): Promise<void> {
  await save((await load()).filter((x) => x.userId !== userId));
}

let flushing: Promise<{ tripIds: string[] }> | null = null;

/** Send queued stops for this person. Stops at the first connection failure. */
export function flushPlanOutbox(userId: string): Promise<{ tripIds: string[] }> {
  if (flushing) return flushing;
  flushing = (async () => {
    const tripIds = new Set<string>();
    for (const item of (await load()).filter((x) => x.userId === userId && !x.error)) {
      try {
        await addItineraryItemOnce(item.tripId, item.input, item.clientId);
        tripIds.add(item.tripId);
        await save((await load()).filter((x) => x.clientId !== item.clientId));
      } catch (e) {
        if (isNetworkError(e)) break;
        await save((await load()).map((x) => (x.clientId === item.clientId ? { ...x, error: errorMessage(e) } : x)));
      }
    }
    return { tripIds: [...tripIds] };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** This person's stops waiting to sync, for a trip (updates as they change). */
export function usePlanOutbox(userId: string | undefined, tripId?: string): QueuedStop[] {
  const [list, setList] = useState<QueuedStop[]>([]);
  useEffect(() => {
    let alive = true;
    const update = () => load().then((all) => alive && setList(all.filter((x) => x.userId === userId && (!tripId || x.tripId === tripId))));
    update();
    listeners.add(update);
    return () => {
      alive = false;
      listeners.delete(update);
    };
  }, [userId, tripId]);
  return list;
}
