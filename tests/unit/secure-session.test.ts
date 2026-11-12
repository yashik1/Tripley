import { describe, expect, it } from 'vitest';

import { CHUNK, createChunkedStorage, safeKey } from '../../src/lib/secure-session';

function stores() {
  const secure = new Map<string, string>();
  const plain = new Map<string, string>();
  return {
    secure,
    plain,
    storage: createChunkedStorage(
      {
        getItemAsync: async (k) => {
          if (!/^[\w.-]+$/.test(k)) throw new Error(`bad key ${k}`);
          return secure.get(k) ?? null;
        },
        setItemAsync: async (k, v) => {
          if (v.length > 2048) throw new Error('too big');
          secure.set(k, v);
        },
        deleteItemAsync: async (k) => {
          secure.delete(k);
        },
      },
      {
        getItem: async (k) => plain.get(k) ?? null,
        removeItem: async (k) => {
          plain.delete(k);
        },
      },
    ),
  };
}

const KEY = 'sb-supabase-production-4a6b-auth-token';
const session = (n: number) => JSON.stringify({ access_token: 'x'.repeat(n), user: { id: 'u1' } });

describe('secure session storage', () => {
  it('stores a large session in pieces small enough for secure storage, and reads it back', async () => {
    const { storage, secure } = stores();
    const value = session(5000);
    await storage.setItem(KEY, value);
    expect(Number(secure.get(`${KEY}.n`))).toBe(Math.ceil(value.length / CHUNK));
    expect([...secure.values()].every((v) => v.length <= CHUNK)).toBe(true);
    expect(await storage.getItem(KEY)).toBe(value);
  });

  it('a shorter session afterwards leaves no stale pieces', async () => {
    const { storage, secure } = stores();
    await storage.setItem(KEY, session(5000));
    await storage.setItem(KEY, session(10));
    expect(secure.get(`${KEY}.n`)).toBe('1');
    expect([...secure.keys()].sort()).toEqual([`${KEY}.0`, `${KEY}.n`]);
    expect(await storage.getItem(KEY)).toBe(session(10));
  });

  it('moves a session saved by the old version out of plain storage, so nobody is signed out', async () => {
    const { storage, plain, secure } = stores();
    plain.set(KEY, session(3000));
    expect(await storage.getItem(KEY)).toBe(session(3000));
    expect(plain.has(KEY)).toBe(false);
    expect(secure.has(`${KEY}.n`)).toBe(true);
    expect(await storage.getItem(KEY)).toBe(session(3000));
  });

  it('signing out removes every piece, and any plain copy', async () => {
    const { storage, plain, secure } = stores();
    await storage.setItem(KEY, session(4000));
    plain.set(KEY, 'old');
    await storage.removeItem(KEY);
    expect(secure.size).toBe(0);
    expect(plain.size).toBe(0);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('a half-written session reads as signed out, not as a broken session', async () => {
    const { storage, secure } = stores();
    await storage.setItem(KEY, session(5000));
    secure.delete(`${KEY}.1`);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('keys are made safe for secure storage', () => {
    expect(safeKey('sb-127.0.0.1:54321-auth-token')).toBe('sb-127.0.0.1_54321-auth-token');
  });
});
