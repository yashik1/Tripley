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
