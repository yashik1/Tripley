/** Checks and messages for email + password accounts. No app imports, so it's unit-testable. */

export const MIN_PASSWORD_LENGTH = 8;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function emailProblem(raw: string): string | null {
  const email = normalizeEmail(raw);
  if (!email) return 'Enter your email address.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'That email address doesn’t look right.';
  return null;
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.trim().length === 0) return 'A password can’t be only spaces.';
  if (password.length > 72) return 'Use 72 characters or fewer.';
  return null;
}

/** Turns sign-in service errors into what to do next. Returns null for errors it doesn't know. */
export function authErrorMessage(e: unknown): string | null {
  const err = (e ?? {}) as { code?: string; message?: string; status?: number };
  const code = err.code ?? '';
  const msg = err.message ?? '';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) {
    return 'Wrong email or password. Check them, or reset your password.';
  }
  if (code === 'user_already_exists' || code === 'email_exists' || /already (been )?registered/i.test(msg)) {
    return 'There’s already an account with this email. Log in instead.';
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) {
    return 'Confirm your email first. Open the link we sent you, then log in.';
  }
  if (code === 'weak_password' || /password should be/i.test(msg)) {
    return msg || `Use a longer password (at least ${MIN_PASSWORD_LENGTH} characters).`;
  }
  if (code === 'same_password' || /different from the old password/i.test(msg)) {
    return 'That’s your current password. Choose a new one.';
  }
  if (code === 'otp_expired' || /invalid or has expired/i.test(msg)) {
    return 'This reset link has expired or was already used. Ask for a new one.';
  }
  if (code === 'over_email_send_rate_limit' || /rate limit|too many/i.test(msg) || err.status === 429) {
    return 'Too many tries. Wait a few minutes, then try again.';
  }
  if (code === 'signup_disabled' || /signups not allowed/i.test(msg)) {
    return 'New accounts are turned off right now.';
  }
  if (code === 'email_provider_disabled' || /email logins are disabled|email signups are disabled/i.test(msg)) {
    return 'Email accounts aren’t turned on yet.';
  }
  return null;
}
