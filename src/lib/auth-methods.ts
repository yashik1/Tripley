/**
 * Which sign-in methods the app offers, from EXPO_PUBLIC_AUTH_METHODS
 * (comma-separated: phone, email, google, apple, guest). Turn a method on only
 * once its provider is set up in Supabase (e.g. phone needs Twilio Verify).
 */
export type AuthMethod = 'phone' | 'email' | 'google' | 'apple' | 'guest';

const ALL: AuthMethod[] = ['phone', 'email', 'google', 'apple', 'guest'];

export function parseAuthMethods(raw: string | undefined | null): Set<AuthMethod> {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is AuthMethod => (ALL as string[]).includes(s));
  return new Set(list.length > 0 ? list : ALL);
}

export const authMethods = parseAuthMethods(process.env.EXPO_PUBLIC_AUTH_METHODS);
export const hasAuth = (m: AuthMethod) => authMethods.has(m);
