/**
 * Trip documents saved in this browser for offline use, in Cache Storage
 * (never under the signed link, which is a key to the private file). Deleted on
 * sign-out or when another account signs in (device-data.ts). Opening one
 * shows it in a new tab from a local blob.
 */
const CACHE = 'tripley-docs';
const keyFor = (userId: string, doc: { id: string }) => `/__tripley-docs/${userId}/${doc.id}`;

const available = () => typeof caches !== 'undefined';

export async function saveOffline(userId: string, doc: { id: string; mime: string }, url: string): Promise<void> {
  if (!available()) throw new Error('This browser can’t keep files offline.');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not download the file.');
  const cache = await caches.open(CACHE);
  await cache.put(keyFor(userId, doc), new Response(await res.blob(), { headers: { 'content-type': doc.mime } }));
}

export async function isSavedOffline(userId: string, doc: { id: string }): Promise<boolean> {
  if (!available()) return false;
  return !!(await (await caches.open(CACHE)).match(keyFor(userId, doc)));
}

export async function openOffline(userId: string, doc: { id: string; mime: string; name: string }): Promise<boolean> {
  if (!available()) return false;
  const hit = await (await caches.open(CACHE)).match(keyFor(userId, doc));
  if (!hit) return false;
  const url = URL.createObjectURL(new Blob([await hit.blob()], { type: doc.mime }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

export async function removeOffline(userId: string, doc: { id: string }): Promise<void> {
  if (!available()) return;
  await (await caches.open(CACHE)).delete(keyFor(userId, doc));
}

export async function clearOfflineDocs(): Promise<void> {
  if (!available()) return;
  await caches.delete(CACHE);
}
