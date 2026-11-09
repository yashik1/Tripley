/** Turn Supabase / network errors into a sentence we can show people. */
export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!e) return fallback;
  if (typeof e === 'string') return e;
  const err = e as { message?: string; code?: string; status?: number; name?: string };
  if (err.name === 'TypeError' && /fetch|network/i.test(err.message ?? '')) {
    return 'No connection. Check your internet and try again.';
  }
  if (err.code === '42501' && !err.message) return "You don't have permission to do that.";
  if (err.message && err.message.length < 200) return err.message;
  return fallback;
}

/**
 * True when a request failed because there's no connection (rather than the
 * server saying no). Server errors carry a code; network failures don't.
 */
export function isNetworkError(e: unknown, online: boolean | undefined = currentlyOnline()): boolean {
  if (online === false) return true;
  if (!e || typeof e !== 'object') return false;
  const err = e as { message?: string; code?: string; name?: string; status?: number };
  if (err.code && /^[0-9A-Z]{5}$|^P\d{4}$/.test(err.code)) return false;
  return /failed to fetch|network request failed|networkerror|load failed|fetch failed|the internet connection appears to be offline/i.test(
    `${err.name ?? ''} ${err.message ?? ''}`,
  );
}

function currentlyOnline(): boolean | undefined {
  return typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : undefined;
}
