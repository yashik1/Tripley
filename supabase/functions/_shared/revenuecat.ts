// RevenueCat webhook handling, kept free of Deno APIs so it can be unit tested.
//
// RevenueCat sends the Authorization header value configured in its dashboard
// with every delivery; we compare it in constant time. It retries failed
// deliveries and can deliver an event more than once or out of order, so the
// database applies each event id once and ignores events older than the last
// one applied (public.apply_subscription_event).

import { BodyError, errorResponse, json, readJsonObject, safeEqual } from './http.ts';

export type ApplyResult = { outcome: string; user_id?: string | null };

export interface WebhookDeps {
  /** Shared secret; the header must be exactly `Bearer <secret>`. */
  secret: string | undefined;
  entitlement: string;
  allowSandbox: boolean;
  /** Applies the event in one database transaction. */
  apply: (event: Record<string, unknown>, entitlement: string, allowSandbox: boolean) => Promise<ApplyResult>;
  /** Structured log line without personal data. */
  log?: (event: string, fields: Record<string, string | number | boolean>) => void;
}

const MAX_BODY_BYTES = 64 * 1024;

/** Errors the database raises for a malformed event (SQLSTATE 22023). */
function isBadEvent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '22023';
}

export async function handleRevenueCatWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  const log = deps.log ?? (() => {});
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST.');
  if (!deps.secret || deps.secret.length < 16) {
    // Refuse everything rather than accept unauthenticated events.
    log('revenuecat_misconfigured', {});
    return errorResponse(503, 'not_configured', 'Webhook secret is not set.');
  }
  if (!safeEqual(req.headers.get('Authorization') ?? '', `Bearer ${deps.secret}`)) {
    log('revenuecat_unauthorized', {});
    return errorResponse(401, 'unauthorized', 'Bad secret.');
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(req, MAX_BODY_BYTES);
  } catch (e) {
    const status = e instanceof BodyError ? e.status : 400;
    return errorResponse(status, 'bad_request', 'Send a JSON event.');
  }
  const event = body.event;
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return errorResponse(400, 'bad_request', 'Missing event.');
  }
  const e = event as Record<string, unknown>;
  if (typeof e.id !== 'string' || typeof e.type !== 'string' || typeof e.event_timestamp_ms !== 'number') {
    return errorResponse(400, 'bad_request', 'Event needs an id, a type and a timestamp.');
  }

  try {
    const result = await deps.apply(e, deps.entitlement, deps.allowSandbox);
    log('revenuecat_event', { id: e.id, type: e.type, outcome: result.outcome });
    return json({ ok: true, outcome: result.outcome });
  } catch (err) {
    if (isBadEvent(err)) {
      log('revenuecat_bad_event', { id: e.id, type: e.type });
      return errorResponse(400, 'bad_request', 'Malformed event.');
    }
    // A 5xx makes RevenueCat retry later; the event id keeps that safe.
    log('revenuecat_apply_failed', { id: e.id, type: e.type });
    return errorResponse(500, 'server_error', 'Could not record the event.');
  }
}
