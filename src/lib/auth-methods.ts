/**
 * Which sign-in methods the app offers, from EXPO_PUBLIC_AUTH_METHODS
 * (comma-separated: password, phone, email, google, apple, guest).
 * - password: email + password accounts (sign up, log in, reset password)
 * - email: a 6-digit code by email instead of a password
 * Turn a method on only once its provider is set up in Supabase (e.g. phone
 * needs Twilio Verify; email codes and password resets need SMTP).
 */
export type AuthMethod = 'password' | 'phone' | 'email' | 'google' | 'apple' | 'guest';

const ALL: AuthMethod[] = ['password', 'phone', 'email', 'google', 'apple', 'guest'];

export function parseAuthMethods(raw: string | undefined | null): Set<AuthMethod> {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is AuthMethod => (ALL as string[]).includes(s));
  return new Set(list.length > 0 ? list : ALL);
}

export const authMethods = parseAuthMethods(process.env.EXPO_PUBLIC_AUTH_METHODS);
export const hasAuth = (m: AuthMethod) => authMethods.has(m);

/**
 * Whether the auth server can send email (password reset links, email codes).
 * Set EXPO_PUBLIC_EMAIL_SENDING=on once SMTP is set up on the auth server.
 * Without SMTP the server accepts a reset request but quietly sends nothing,
 * so the app must not promise an email.
 */
export function parseEmailSending(raw: string | undefined | null): boolean {
  return ['on', 'true', '1', 'yes'].includes((raw ?? '').trim().toLowerCase());
}
export const emailSending = parseEmailSending(process.env.EXPO_PUBLIC_EMAIL_SENDING);
