// RevenueCat webhook -> keeps public.accounts.plan in sync with the "pro"
// entitlement bought through the App Store, Google Play or the web (Stripe).
//
// In RevenueCat: Project settings -> Integrations -> Webhooks, URL
//   https://<project>.supabase.co/functions/v1/revenuecat-webhook
// and set the Authorization header value to "Bearer <REVENUECAT_WEBHOOK_SECRET>"
// (at least 16 random characters). The app configures RevenueCat with the
// Supabase user id as the app user id.
//
// Optional: REVENUECAT_ENTITLEMENT_ID (default "pro"), REVENUECAT_ALLOW_SANDBOX
// ("true" to let sandbox/TestFlight purchases grant Pro; off by default).

import { handleRevenueCatWebhook } from '../_shared/revenuecat.ts';
import { adminClient } from '../_shared/supabase.ts';

Deno.serve((req) =>
  handleRevenueCatWebhook(req, {
    secret: Deno.env.get('REVENUECAT_WEBHOOK_SECRET'),
    entitlement: Deno.env.get('REVENUECAT_ENTITLEMENT_ID') ?? 'pro',
    allowSandbox: Deno.env.get('REVENUECAT_ALLOW_SANDBOX') === 'true',
    apply: async (event, entitlement, allowSandbox) => {
      const { data, error } = await adminClient().rpc('apply_subscription_event', {
        p_event: event,
        p_entitlement: entitlement,
        p_allow_sandbox: allowSandbox,
      });
      if (error) throw error;
      return data as { outcome: string };
    },
    log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
  }),
);
