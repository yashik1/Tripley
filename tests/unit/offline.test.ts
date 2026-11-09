import { describe, expect, it } from 'vitest';

import { isNetworkError } from '../../src/lib/errors';
import { newClientId } from '../../src/lib/ids';

describe('isNetworkError', () => {
  it('spots failed requests', () => {
    expect(isNetworkError({ message: 'TypeError: Failed to fetch', code: '' }, true)).toBe(true);
    expect(isNetworkError(new TypeError('Network request failed'), true)).toBe(true);
    expect(isNetworkError({ message: 'Load failed' }, true)).toBe(true);
  });
  it('is always true while the device says it is offline', () => {
    expect(isNetworkError({ message: 'anything', code: '22023' }, false)).toBe(true);
  });
  it('is false for answers from the server', () => {
    expect(isNetworkError({ message: "The shares don't add up to the total.", code: '22023' }, true)).toBe(false);
    expect(isNetworkError({ message: 'permission denied', code: '42501' }, true)).toBe(false);
    expect(isNetworkError(null, true)).toBe(false);
  });
});

describe('newClientId', () => {
  it('makes distinct v4 UUIDs', () => {
    const a = newClientId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(Array.from({ length: 200 }, newClientId)).size).toBe(200);
  });
});
