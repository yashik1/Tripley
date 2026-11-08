import { describe, expect, it } from 'vitest';

import { authErrorMessage, emailProblem, normalizeEmail, passwordProblem } from '../../src/lib/credentials';

describe('emailProblem', () => {
  it('accepts normal addresses, ignoring case and spaces', () => {
    expect(emailProblem(' Maya@Example.com ')).toBeNull();
    expect(normalizeEmail(' Maya@Example.com ')).toBe('maya@example.com');
  });
  it('rejects empty and malformed addresses', () => {
    expect(emailProblem('')).toMatch(/enter your email/i);
    expect(emailProblem('maya@')).toMatch(/doesn’t look right/);
    expect(emailProblem('maya example.com')).toMatch(/doesn’t look right/);
  });
});

describe('passwordProblem', () => {
  it('needs at least 8 characters', () => {
    expect(passwordProblem('short')).toMatch(/at least 8/);
    expect(passwordProblem('long enough')).toBeNull();
  });
  it('rejects only-spaces and over-long passwords', () => {
    expect(passwordProblem('         ')).toMatch(/only spaces/);
    expect(passwordProblem('x'.repeat(73))).toMatch(/72/);
  });
});

describe('authErrorMessage', () => {
  it('explains the errors people hit', () => {
    expect(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toMatch(/wrong email or password/i);
    expect(authErrorMessage({ code: 'user_already_exists', message: 'User already registered' })).toMatch(/log in instead/i);
    expect(authErrorMessage({ code: 'otp_expired', message: 'Email link is invalid or has expired' })).toMatch(/expired or was already used/);
    expect(authErrorMessage({ status: 429, message: 'For security purposes…' })).toMatch(/too many tries/i);
    expect(authErrorMessage({ code: 'email_provider_disabled' })).toMatch(/aren’t turned on/);
  });
  it('returns null for errors it does not know', () => {
    expect(authErrorMessage({ code: 'unexpected', message: 'boom' })).toBeNull();
    expect(authErrorMessage(undefined)).toBeNull();
  });
});
