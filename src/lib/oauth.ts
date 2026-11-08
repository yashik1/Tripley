import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

/** Google (and Apple on Android/web) through Supabase OAuth with PKCE. */
export async function signInWithProvider(provider: 'google' | 'apple'): Promise<void> {
  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw error;
    return;
  }
  const redirectTo = Linking.createURL('auth/callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return;
  const code = new URL(result.url).searchParams.get('code');
  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) throw exchangeError;
  }
}

export async function appleNativeAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  return AppleAuthentication.isAvailableAsync().catch(() => false);
}

/** Native "Sign in with Apple" on iPhone. */
export async function signInWithAppleNative(): Promise<void> {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
    throw e;
  }
  if (!credential.identityToken) throw new Error('Apple did not return a sign-in token.');
  const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken });
  if (error) throw error;
  // Apple only shares the name on the first sign-in.
  const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
  if (name && data.user) {
    await supabase.from('profiles').update({ display_name: name }).eq('id', data.user.id);
  }
}
