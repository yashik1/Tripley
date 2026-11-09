/**
 * RevenueCat webhook request handling (supabase/functions/_shared/revenuecat.ts).
 * The database side (duplicates, ordering, event types) is in tests/db/security.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';

import { handleRevenueCatWebhook, type WebhookDeps } from '../../supabase/functions/_shared/revenuecat.ts';

const SECRET = 'a-long-random-webhook-secret';
const event = { id: 'evt_1', type: 'RENEWAL', event_timestamp_ms: 1_700_000_000_000, app_user_id: 'x' };

function deps(over: Partial<WebhookDeps> = {}): WebhookDeps {
  return { secret: SECRET, entitlement: 'pro', allowSandbox: false, apply: vi.fn(async () => ({ outcome: 'applied' })), ...over };
}

function post(body: unknown, auth: string | null = `Bearer ${SECRET}`, raw?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth !== null) headers.Authorization = auth;
  return new Request('https://x/webhook', { method: 'POST', headers, body: raw ?? JSON.stringify(body) });
}

describe('RevenueCat webhook', () => {
  it('applies a valid event and reports the outcome', async () => {
    const d = deps();
    const res = await handleRevenueCatWebhook(post({ event }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: 'applied' });
    expect(d.apply).toHaveBeenCalledWith(event, 'pro', false);
  });

  it('passes duplicates and stale events through as a 200 (so RevenueCat stops retrying)', async () => {
    const res = await handleRevenueCatWebhook(post({ event }), deps({ apply: async () => ({ outcome: 'duplicate' }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe('duplicate');
  });

  it('rejects a missing or wrong Authorization header without touching the database', async () => {
    for (const auth of [null, '', 'Bearer wrong', SECRET, `Bearer ${SECRET}x`, `bearer ${SECRET}`]) {
      const d = deps();
      const res = await handleRevenueCatWebhook(post({ event }, auth), d);
      expect(res.status).toBe(401);
      expect(d.apply).not.toHaveBeenCalled();
    }
  });

  it('refuses everything when no (or a weak) secret is configured', async () => {
    for (const secret of [undefined, '', 'short']) {
      const d = deps({ secret });
      const res = await handleRevenueCatWebhook(post({ event }, 'Bearer '), d);
      expect(res.status).toBe(503);
      expect(d.apply).not.toHaveBeenCalled();
    }
  });

  it('rejects malformed bodies and events', async () => {
    const d = deps();
    expect((await handleRevenueCatWebhook(post(null, undefined, '{not json'), d)).status).toBe(400);
    expect((await handleRevenueCatWebhook(post([event]), d)).status).toBe(400);
    expect((await handleRevenueCatWebhook(post({}), d)).status).toBe(400);
    expect((await handleRevenueCatWebhook(post({ event: { ...event, id: 5 } }), d)).status).toBe(400);
    expect((await handleRevenueCatWebhook(post({ event: { ...event, event_timestamp_ms: 'now' } }), d)).status).toBe(400);
    expect((await handleRevenueCatWebhook(post({ event: { ...event, pad: 'x'.repeat(70_000) } }), d)).status).toBe(413);
    expect(d.apply).not.toHaveBeenCalled();
    expect((await handleRevenueCatWebhook(new Request('https://x/webhook', { method: 'GET' }), d)).status).toBe(405);
  });

  it('a malformed event the database refuses is a 400; a database failure is a 500 so it is retried', async () => {
    const bad = deps({ apply: async () => Promise.reject(Object.assign(new Error('Malformed event id.'), { code: '22023' })) });
    expect((await handleRevenueCatWebhook(post({ event }), bad)).status).toBe(400);
    const down = deps({ apply: async () => Promise.reject(new Error('connection reset')) });
    const res = await handleRevenueCatWebhook(post({ event }), down);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('connection reset');
  });

  it('logs ids and outcomes only, never the secret or the user', async () => {
    const lines: string[] = [];
    await handleRevenueCatWebhook(post({ event }), deps({ log: (e, f) => lines.push(JSON.stringify({ e, ...f })) }));
    await handleRevenueCatWebhook(post({ event }, 'Bearer nope'), deps({ log: (e, f) => lines.push(JSON.stringify({ e, ...f })) }));
    const all = lines.join('\n');
    expect(all).toContain('evt_1');
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('nope');
    expect(all).not.toContain('app_user_id');
  });
});
