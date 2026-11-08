// RevenueCat webhook -> keeps public.accounts.plan in sync with the "pro"
// entitlement bought through the App Store, Google Play or the web (Stripe).
//
// In RevenueCat: Project settings -> Integrations -> Webhooks, URL
//   https://<project>.supabase.co/functions/v1/revenuecat-webhook
// and set the Authorization header value to "Bearer <REVENUECAT_WEBHOOK_SECRET>".
// The app configures RevenueCat with the Supabase user id as the app user id.

import { errorResponse, json, requireEnv, safeEqual } from '../_shared/http.ts';
import { adminClient, isUuid } from '../_shared/supabase.ts';

const ENTITLEMENT = Deno.env.get('REVENUECAT_ENTITLEMENT_ID') ?? 'pro';

type RcEvent = {
  type: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  entitlement_ids?: string[] | null;
  expiration_at_ms?: number | null;
  transferred_from?: string[];
  transferred_to?: string[];
};

const GRANTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
]);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST.');
  const expected = `Bearer ${requireEnv('REVENUECAT_WEBHOOK_SECRET')}`;
  if (!safeEqual(req.headers.get('Authorization') ?? '', expected)) {
    return errorResponse(401, 'unauthorized', 'Bad secret.');
  }

  let event: RcEvent;
  try {
    event = ((await req.json()) as { event: RcEvent }).event;
  } catch {
    return errorResponse(400, 'bad_request', 'Send JSON.');
  }
  if (!event?.type) return errorResponse(400, 'bad_request', 'Missing event.');
  if (event.entitlement_ids && !event.entitlement_ids.includes(ENTITLEMENT) && event.type !== 'TRANSFER') {
    return json({ ignored: 'other entitlement' });
  }

  const admin = adminClient();
  const setPlan = async (userId: string, plan: 'free' | 'pro', expiresAtMs: number | null | undefined) => {
    const { error } = await admin.from('accounts').upsert(
      {
        user_id: userId,
        plan,
        plan_expires_at: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) throw error;
  };

  // The Supabase user id may be the app user id, the original id or an alias.
  const userId = [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])].find(isUuid);

  if (event.type === 'TRANSFER') {
    for (const id of (event.transferred_from ?? []).filter(isUuid)) await setPlan(id, 'free', null);
    // The receiving user gets a fresh event with the expiry; nothing else to do here.
    return json({ ok: true });
  }
  if (!userId) return json({ ignored: 'no supabase user id' });

  if (GRANTS.has(event.type)) {
    await setPlan(userId, 'pro', event.expiration_at_ms);
  } else if (event.type === 'EXPIRATION') {
    await setPlan(userId, 'free', null);
  } else if (event.type === 'CANCELLATION' || event.type === 'BILLING_ISSUE') {
    // Still Pro until it expires; keep the latest expiry.
    if (event.expiration_at_ms) await setPlan(userId, 'pro', event.expiration_at_ms);
  }
  // TEST and other events: acknowledge.
  return json({ ok: true });
});
