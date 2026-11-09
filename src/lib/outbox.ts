/**
 * Bills saved without a connection wait here (on the device) and are sent when
 * the connection is back. Each carries a client id, so a retry after a dropped
 * response never adds the bill twice (save_bill returns the existing one).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { saveBill, type SaveBillPayload } from './api';
import { outboxItemExpired } from './cache-policy';
import { errorMessage, isNetworkError } from './errors';

const KEY = 'tripley.outbox.v1';

export type QueuedBill = {
  clientId: string;
  userId: string;
  tripId: string;
  title: string;
  totalMinor: number;
  currency: string;
  queuedAt: string;
  payload: SaveBillPayload;
  /** Set when the server refused it (not a connection problem). */
  error?: string;
};

let cache: QueuedBill[] | null = null;
const listeners = new Set<() => void>();

async function load(): Promise<QueuedBill[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as QueuedBill[]) : [];
    // Retention: bills that haven't synced in 30 days are dropped.
    cache = all.filter((x) => !outboxItemExpired(x.queuedAt));
    if (cache.length !== all.length) await AsyncStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    cache = [];
  }
  return cache;
}

async function save(list: QueuedBill[]): Promise<void> {
  cache = list;
  listeners.forEach((fn) => fn());
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or unavailable: the bill stays queued for this session.
  }
}

export async function queueBill(item: Omit<QueuedBill, 'queuedAt'>): Promise<void> {
  const list = await load();
  await save([...list.filter((x) => x.clientId !== item.clientId), { ...item, queuedAt: new Date().toISOString() }]);
}

/** On sign-out: this person's unsynced bills leave the device (others' stay). */
export async function clearOutboxFor(userId: string): Promise<void> {
  await save((await load()).filter((x) => x.userId !== userId));
}

/** How many bills this person has waiting to sync. */
export async function queuedCount(userId: string): Promise<number> {
  return (await load()).filter((x) => x.userId === userId).length;
}

export async function discardQueuedBill(clientId: string): Promise<void> {
  await save((await load()).filter((x) => x.clientId !== clientId));
}

let flushing: Promise<{ saved: { tripId: string; billId: string }[] }> | null = null;

/** Send queued bills for this person. Stops at the first connection failure. */
export function flushOutbox(userId: string): Promise<{ saved: { tripId: string; billId: string }[] }> {
  if (flushing) return flushing;
  flushing = (async () => {
    const saved: { tripId: string; billId: string }[] = [];
    try {
      for (const item of await load()) {
        if (item.userId !== userId || item.error) continue;
        try {
          const billId = await saveBill(item.payload);
          saved.push({ tripId: item.tripId, billId });
          await save((await load()).filter((x) => x.clientId !== item.clientId));
        } catch (e) {
          if (isNetworkError(e)) break;
          const message = errorMessage(e);
          await save((await load()).map((x) => (x.clientId === item.clientId ? { ...x, error: message } : x)));
        }
      }
    } finally {
      flushing = null;
    }
    return { saved };
  })();
  return flushing;
}

/** Retry a bill the server refused earlier (e.g. after fixing membership). */
export async function retryQueuedBill(clientId: string): Promise<void> {
  await save((await load()).map((x) => (x.clientId === clientId ? { ...x, error: undefined } : x)));
}

/** Bills waiting to sync, for one trip (or all), for the signed-in person. */
export function useOutbox(userId: string | undefined, tripId?: string): QueuedBill[] {
  const [list, setList] = useState<QueuedBill[]>(cache ?? []);
  useEffect(() => {
    let alive = true;
    const update = () => {
      if (alive) setList([...(cache ?? [])]);
    };
    listeners.add(update);
    load().then(update);
    return () => {
      alive = false;
      listeners.delete(update);
    };
  }, []);
  return list.filter((x) => x.userId === userId && (!tripId || x.tripId === tripId));
}
