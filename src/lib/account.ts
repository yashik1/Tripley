/**
 * Email + password accounts: sign up, log in, reset a forgotten password, and
 * turn a guest account into a permanent one (same account, trips kept).
 */
import { createClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { config, isConfigured } from '@/config';
import { authErrorMessage, emailProblem, normalizeEmail, passwordProblem } from './credentials';
import { errorMessage } from './errors';
import { supabase } from './supabase';

/** Throws an Error with a message people can act on. */
function fail(e: unknown): never {
  throw new Error(authErrorMessage(e) ?? errorMessage(e));
}

function check(problem: string | null) {
  if (problem) throw new Error(problem);
}

/** The website's address: where email links should land. */
function webOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return `https://${config.appDomain}`;
}

export async function signUpWithPassword(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ needsEmailConfirmation: boolean }> {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new Error('Add your name so friends know who you are.');
  check(emailProblem(input.email));
  check(passwordProblem(input.password));
  const { data, error } = await supabase.auth.signUp({
    email: normalizeEmail(input.email),
    password: input.password,
    options: {
      data: { full_name: name },
      emailRedirectTo: Platform.OS === 'web' ? `${webOrigin()}/auth/callback` : Linking.createURL('auth/callback'),
    },
  });
  if (error) fail(error);
  // With email confirmation on, the service returns a user without a session
  // (and, for an address that's already registered, a user with no identities).
  if (!data.session && data.user && (data.user.identities?.length ?? 0) === 0) {
    fail({ code: 'user_already_exists' });
  }
  return { needsEmailConfirmation: !data.session };
}

export async function logInWithPassword(email: string, password: string): Promise<void> {
  check(emailProblem(email));
  if (!password) throw new Error('Enter your password.');
  const { error } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
  if (error) fail(error);
}

/**
 * Emails a reset link that opens /reset-password?token=…&type=recovery.
 * Requested without PKCE so the link works on any device, not only the
 * browser that asked for it. Says nothing about whether the account exists.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  check(emailProblem(email));
  if (!isConfigured) throw new Error('Tripley isn’t connected to its server.');
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.resetPasswordForEmail(normalizeEmail(email), {
    redirectTo: `${webOrigin()}/reset-password`,
  });
  if (error) fail(error);
}

/** Signs in with the one-time token from a reset email, so a new password can be set. */
export async function openResetLink(tokenHash: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
  if (error) fail(error);
}

export async function setNewPassword(password: string): Promise<void> {
  check(passwordProblem(password));
  const { error } = await supabase.auth.updateUser({ password });
  if (error) fail(error);
}

/**
 * Gives a guest account an email and password. It stays the same account, so
 * trips, bills and balances are kept, and it can now log in on any device.
 */
export async function saveGuestAccount(email: string, password: string): Promise<{ needsEmailConfirmation: boolean }> {
  check(emailProblem(email));
  check(passwordProblem(password));
  const address = normalizeEmail(email);
  const { data, error } = await supabase.auth.updateUser({ email: address, password });
  if (error) fail(error);
  // If the server asks to confirm the address first, the email waits in new_email.
  const confirmed = data.user?.email?.toLowerCase() === address;
  if (confirmed) await supabase.auth.refreshSession().catch(() => undefined);
  return { needsEmailConfirmation: !confirmed };
}
