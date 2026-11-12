/**
 * Keeps the sign-in session in the phone's secure storage (Keychain on
 * iPhone, Keystore-encrypted storage on Android) instead of plain app
 * storage. Pure: the stores are passed in, so it can be unit tested.
 *
 * - Values are split into small pieces: secure storage has rejected large
 *   values on some systems, and a session can be several kilobytes.
 * - A session saved by an older version in plain storage is moved across the
 *   first time it's read, so nobody is signed out by the update.
 */
export type SecureLike = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};
export type PlainLike = {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
};
export type SessionStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export const CHUNK = 1800;

/** Secure storage keys may only use letters, digits, ".", "-" and "_". */
export const safeKey = (key: string) => key.replace(/[^\w.-]/g, '_');

export function createChunkedStorage(secure: SecureLike, legacy: PlainLike): SessionStorage {
  const countKey = (key: string) => `${safeKey(key)}.n`;
  const partKey = (key: string, i: number) => `${safeKey(key)}.${i}`;

  async function clearParts(key: string, from: number, to: number) {
    for (let i = from; i < to; i++) await secure.deleteItemAsync(partKey(key, i));
  }

  async function write(key: string, value: string) {
    const before = Number((await secure.getItemAsync(countKey(key))) ?? 0) || 0;
    const parts = Math.max(1, Math.ceil(value.length / CHUNK));
    for (let i = 0; i < parts; i++) await secure.setItemAsync(partKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
    await secure.setItemAsync(countKey(key), String(parts));
    await clearParts(key, parts, before);
  }

  return {
    async getItem(key) {
      const n = Number((await secure.getItemAsync(countKey(key))) ?? 0) || 0;
      if (n > 0) {
        const parts: string[] = [];
        for (let i = 0; i < n; i++) {
          const part = await secure.getItemAsync(partKey(key, i));
          if (part == null) return null; // half-written: treat as signed out rather than use a broken session
          parts.push(part);
        }
        return parts.join('');
      }
      // Saved in plain storage by an older version: move it.
      const old = await legacy.getItem(key);
      if (old == null) return null;
      await write(key, old);
      await legacy.removeItem(key);
      return old;
    },
    async setItem(key, value) {
      await write(key, value);
      await legacy.removeItem(key).catch(() => undefined);
    },
    async removeItem(key) {
      const n = Number((await secure.getItemAsync(countKey(key))) ?? 0) || 0;
      await clearParts(key, 0, n);
      await secure.deleteItemAsync(countKey(key));
      await legacy.removeItem(key).catch(() => undefined);
    },
  };
}
