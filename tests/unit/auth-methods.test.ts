import { describe, expect, it } from 'vitest';
import { parseAuthMethods } from '../../src/lib/auth-methods';

describe('parseAuthMethods', () => {
  it('defaults to every method when unset or empty', () => {
    expect([...parseAuthMethods(undefined)]).toEqual(['phone', 'email', 'google', 'apple', 'guest']);
    expect([...parseAuthMethods('  ')]).toEqual(['phone', 'email', 'google', 'apple', 'guest']);
  });
  it('reads a comma-separated list, ignoring case, spaces and unknown names', () => {
    expect([...parseAuthMethods('guest')]).toEqual(['guest']);
    expect([...parseAuthMethods(' Email , guest,fax ')]).toEqual(['email', 'guest']);
  });
  it('falls back to everything if nothing valid is listed', () => {
    expect(parseAuthMethods('fax').size).toBe(5);
  });
});
