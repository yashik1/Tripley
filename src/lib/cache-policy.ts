/**
 * What Tripley keeps on the device for offline use, and for how long. Pure
 * rules (no storage access) so they can be unit tested.
 *
 * Kept (needed to use the trip offline): trips, members (names and the payment
 * handles people chose to share with the trip), bills, balances, payments,
 * places and kitties, your own profile and plan.
 * Never written to the device: everyone's live positions, notifications,
 * invitations, the friends list and location-sharing settings. Signed photo
 * links aren't in the cache at all and expire after 10 minutes.
 */

const DAY = 24 * 60 * 60 * 1000;

/** The saved copy is dropped if the app hasn't refreshed it for this long. */
export const CACHE_MAX_AGE_MS = 7 * DAY;
/** Bills waiting to sync are dropped after this long (the person is told before signing out). */
export const OUTBOX_MAX_AGE_MS = 30 * DAY;

// Signed photo links ('cover') expire, and are a key to a private photo: never saved.
export const NOT_PERSISTED = new Set(['locations', 'notifications', 'invitations', 'sentInvites', 'friends', 'sharing', 'cover', 'offlineDocs']);

export function shouldPersistQuery(queryKey: readonly unknown[], status: string): boolean {
  return status === 'success' && !NOT_PERSISTED.has(String(queryKey[0]));
}

/** The saved copy belongs to another account: it must not be shown to this one. */
export function cacheBelongsToSomeoneElse(owner: string | null, userId: string | null): boolean {
  return !!owner && !!userId && owner !== userId;
}

export function outboxItemExpired(queuedAt: string, now = Date.now()): boolean {
  const t = Date.parse(queuedAt);
  return !Number.isFinite(t) || now - t > OUTBOX_MAX_AGE_MS;
}
