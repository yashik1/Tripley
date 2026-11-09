// AI receipt reading (Tripley Pro).
//
// POST { path: "<trip_id>/<file>.jpg", trip_id: "<uuid>", request_id: "<uuid>",
//        currency_hint?: "INR" }
// with the user's Authorization header. Reserves one scan from the monthly
// quota (atomically, in the database), downloads the photo as the user (so
// storage rules check trip membership), checks it really is an image, asks
// Claude to read it into structured JSON, and returns { receipt, scans_left }.
// If anything fails the scan is given back. Retrying with the same request_id
// returns the same result without charging again.
//
// Logs never include the photo, the receipt's contents, or tokens.

import Anthropic from '@anthropic-ai/sdk';
import { envNumber, requireEnv } from '../_shared/env.ts';
import { clientIp, ipLimiter } from '../_shared/http.ts';
import { RECEIPT_PROMPT, ReceiptSchema, receiptJsonSchema } from '../_shared/receipt.ts';
import { handleScan, type ReadResult, type ReserveResult } from '../_shared/scan.ts';
import { adminClient, userClient } from '../_shared/supabase.ts';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5';
const EFFORT = (Deno.env.get('ANTHROPIC_EFFORT') ?? 'low') as 'low' | 'medium' | 'high';
const TIMEOUT_MS = envNumber('ANTHROPIC_TIMEOUT_MS', 60_000);

const anthropic = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY'), maxRetries: 1 });
const ipAllowed = ipLimiter(envNumber('AI_SCAN_PER_IP_PER_MINUTE', 20));

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function readReceipt(image: { data: Uint8Array; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }, currencyHint: string | null): Promise<ReadResult> {
  let response: Anthropic.Beta.Messages.BetaMessage;
  try {
    response = await anthropic.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: {
          effort: EFFORT,
          format: { type: 'json_schema', schema: receiptJsonSchema as unknown as Record<string, unknown> },
        },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: toBase64(image.data) } },
              {
                type: 'text',
                text: `${RECEIPT_PROMPT}\n\nCurrency hint (the trip's currency): ${currencyHint ?? 'unknown'}.`,
              },
            ],
          },
        ],
      },
      { timeout: TIMEOUT_MS },
    );
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: 'busy' };
    if (err instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, reason: 'timeout' };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, reason: 'failed' };
    if (err instanceof Anthropic.APIError) {
      console.error(JSON.stringify({ event: 'anthropic_error', status: err.status ?? 0 }));
      return { ok: false, reason: (err.status ?? 0) >= 500 ? 'busy' : 'failed' };
    }
    throw err;
  }

  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
    console.warn(JSON.stringify({ event: 'receipt_not_read', stop_reason: response.stop_reason }));
    return { ok: false, reason: 'unreadable' };
  }
  const text = response.content.find((b) => b.type === 'text');
  try {
    return { ok: true, receipt: ReceiptSchema.parse(JSON.parse(text && text.type === 'text' ? text.text : '')) };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

Deno.serve((req) => {
  const admin = adminClient();
  return handleScan(
    req,
    {
      monthlyLimit: envNumber('AI_SCAN_MONTHLY_LIMIT', 60),
      perMinute: envNumber('AI_SCAN_PER_USER_PER_MINUTE', 6),
      maxImageBytes: 5 * 1024 * 1024,
      userIdFor: async (jwt) => {
        const { data, error } = await admin.auth.getUser(jwt);
        return error || !data.user ? null : data.user.id;
      },
      reserve: async (a) => {
        const { data, error } = await admin.rpc('reserve_ai_scan', {
          p_user: a.userId,
          p_request: a.requestId,
          p_trip: a.tripId,
          p_path: a.path,
          p_limit: a.limit,
          p_per_minute: a.perMinute,
        });
        if (error) throw error;
        return data as ReserveResult;
      },
      finish: async (userId, requestId, receipt) => {
        const { error } = await admin.rpc('finish_ai_scan', { p_user: userId, p_request: requestId, p_result: receipt });
        if (error) throw error;
      },
      release: async (userId, requestId) => {
        const { error } = await admin.rpc('release_ai_scan', { p_user: userId, p_request: requestId });
        if (error) throw error;
      },
      download: async (authorization, path) => {
        const { data, error } = await userClient(authorization).storage.from('receipts').download(path);
        if (error || !data) return null;
        return new Uint8Array(await data.arrayBuffer());
      },
      read: readReceipt,
      ipAllowed,
      newRequestId: () => crypto.randomUUID(),
      log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
    },
    clientIp(req),
  );
});
