/**
 * What stays on the device: no live positions in the offline copy, the copy is
 * tied to one account, sign-out removes it and the person's unsynced bills,
 * and old copies expire. Storage is an in-memory stand-in for AsyncStorage.
 */
import { QueryClient } from '@tanstack/react-query';
import { persistQueryClientRestore, persistQueryClientSave } from '@tanstack/react-query-persist-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheBelongsToSomeoneElse, outboxItemExpired, shouldPersistQuery } from '../../src/lib/cache-policy';
import { adoptDeviceData, forgetDeviceData, persistOptions, persister } from '../../src/lib/device-data';
import { clearOutboxFor, flushOutbox, queueBill, queuedCount } from '../../src/lib/outbox';

const { store, saveBill } = vi.hoisted(() => ({ store: new Map<string, string>(), saveBill: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
    multiRemove: async (ks: string[]) => ks.forEach((k) => store.delete(k)),
  };
  return { default: api, ...api };
});
vi.mock('../../src/lib/api', () => ({ saveBill: (...a: unknown[]) => saveBill(...a) }));
vi.mock('../../src/location/state', () => ({ clearSharingState: async () => void store.delete('tripley.sharing.v1') }));
// Documents kept for offline use are cleared with everything else.
const offlineCleared = { count: 0 };
vi.mock('../../src/lib/offline-docs', () => ({ clearOfflineDocs: async () => void offlineCleared.count++ }));


const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const bill = (userId: string, clientId: string) => ({
  clientId,
  userId,
  tripId: 'trip-1',
  title: 'Dinner',
  totalMinor: 1000,
  currency: 'EUR',
  payload: { trip_id: 'trip-1', client_id: clientId } as never,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function filledClient(): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData(['trips'], [{ id: 'trip-1', name: 'Rome' }]);
  qc.setQueryData(['bills', 'trip-1'], [{ id: 'b1', title: 'Dinner' }]);
  qc.setQueryData(['locations', 'trip-1'], [{ user_id: B, lat: 41.9, lng: 12.5 }]);
  qc.setQueryData(['notifications'], [{ body: 'Sam arrived at the hotel' }]);
  return qc;
}

beforeEach(() => {
  saveBill.mockReset();
});

describe('rules', () => {
  it('positions, notifications and invitations are never saved', () => {
    for (const k of ['locations', 'notifications', 'invitations', 'sentInvites', 'friends', 'sharing']) {
      expect(shouldPersistQuery([k, 'trip-1'], 'success')).toBe(false);
    }
    expect(shouldPersistQuery(['bills', 'trip-1'], 'success')).toBe(true);
    expect(shouldPersistQuery(['bills', 'trip-1'], 'error')).toBe(false);
  });

  it('a saved copy from another account is someone else’s', () => {
    expect(cacheBelongsToSomeoneElse(A, B)).toBe(true);
    expect(cacheBelongsToSomeoneElse(A, A)).toBe(false);
    expect(cacheBelongsToSomeoneElse(null, A)).toBe(false);
  });

  it('queued bills expire after 30 days', () => {
    const now = Date.parse('2026-11-10T00:00:00Z');
    expect(outboxItemExpired('2026-11-01T00:00:00Z', now)).toBe(false);
    expect(outboxItemExpired('2026-10-01T00:00:00Z', now)).toBe(true);
    expect(outboxItemExpired('garbage', now)).toBe(true);
  });
});

describe('the saved copy on the device', () => {
  it('holds trips and bills but not where anyone is', async () => {
    store.clear();
    await persistQueryClientSave({ queryClient: filledClient(), ...persistOptions });
    await sleep(2200); // the persister writes at most every 2 s
    const saved = store.get('tripley.cache.v2') ?? '';
    expect(saved).toContain('Rome');
    expect(saved).toContain('Dinner');
    expect(saved).not.toContain('41.9');
    expect(saved).not.toContain('arrived at the hotel');
  });

  it('an expired copy is discarded instead of shown', async () => {
    const old = JSON.parse(store.get('tripley.cache.v2')!);
    old.timestamp = Date.now() - 8 * 24 * 60 * 60 * 1000;
    store.set('tripley.cache.v2', JSON.stringify(old));
    const qc = new QueryClient();
    await persistQueryClientRestore({ queryClient: qc, ...persistOptions });
    expect(qc.getQueryData(['trips'])).toBeUndefined();
    expect(store.has('tripley.cache.v2')).toBe(false);
  });

  it('switching accounts drops the other account’s copy', async () => {
    store.clear();
    const qc = filledClient();
    await adoptDeviceData(qc, A);
    await persistQueryClientSave({ queryClient: qc, ...persistOptions });
    await sleep(2200);
    expect(store.has('tripley.cache.v2')).toBe(true);

    const before = offlineCleared.count;
    await adoptDeviceData(qc, A); // same person again: kept
    expect(store.has('tripley.cache.v2')).toBe(true);
    expect(qc.getQueryData(['trips'])).toBeDefined();
    expect(offlineCleared.count).toBe(before);

    await adoptDeviceData(qc, B); // someone else: gone, offline documents too
    expect(offlineCleared.count).toBe(before + 1);
    expect(store.has('tripley.cache.v2')).toBe(false);
    expect(qc.getQueryData(['trips'])).toBeUndefined();
    expect(store.get('tripley.cache.owner')).toBe(B);
  });

  it('signing out removes the copy, the owner tag, the person’s queued bills and pending invite', async () => {
    store.clear();
    const qc = filledClient();
    await adoptDeviceData(qc, A);
    await persister.persistClient({ timestamp: Date.now(), buster: 'v2', clientState: { queries: [], mutations: [] } });
    await sleep(2200);
    await queueBill(bill(A, 'c-a1'));
    await queueBill(bill(B, 'c-b1'));
    store.set('tripley.pendingJoin', 'ABC123');
    expect(await queuedCount(A)).toBe(1);

    const before = offlineCleared.count;
    await forgetDeviceData(qc, A);
    expect(offlineCleared.count).toBe(before + 1); // documents kept offline are deleted
    expect(qc.getQueryData(['trips'])).toBeUndefined();
    expect(store.has('tripley.cache.v2')).toBe(false);
    expect(store.has('tripley.cache.owner')).toBe(false);
    expect(await queuedCount(A)).toBe(0);
    expect(store.has('tripley.pendingJoin')).toBe(false);
    expect(await queuedCount(B)).toBe(1); // another account's queue on a shared device isn't touched
    await clearOutboxFor(B);
  });
});

describe('queued bills when they sync', () => {
  it('a bill the server now refuses (removed from the trip) stays queued with the reason, not lost', async () => {
    await queueBill(bill(A, 'c-a2'));
    saveBill.mockRejectedValueOnce(Object.assign(new Error('You are not in this trip.'), { code: '42501' }));
    const r = await flushOutbox(A);
    expect(r.saved).toEqual([]);
    expect(await queuedCount(A)).toBe(1);
    const raw = JSON.parse(store.get('tripley.outbox.v1')!);
    expect(raw.find((x: { clientId: string }) => x.clientId === 'c-a2').error).toBe('You are not in this trip.');
    await clearOutboxFor(A);
  });

  it('only the signed-in person’s bills are sent', async () => {
    await queueBill(bill(A, 'c-a3'));
    await queueBill(bill(B, 'c-b3'));
    saveBill.mockResolvedValue('bill-id');
    await flushOutbox(B);
    expect(saveBill).toHaveBeenCalledTimes(1);
    expect(saveBill.mock.calls[0][0]).toEqual({ trip_id: 'trip-1', client_id: 'c-b3' });
    await clearOutboxFor(A);
  });
});
