// AI receipt reading (Tripley Pro).
//
// POST { path: "<trip_id>/<file>.jpg", trip_id: "<uuid>", currency_hint?: "INR" }
// with the user's Authorization header. Downloads the receipt photo as the user
// (so storage RLS checks trip membership), checks the Pro plan and monthly
// quota, asks Claude to read it into structured JSON, and returns
// { receipt, scans_left }.

import Anthropic from '@anthropic-ai/sdk';
import { corsHeaders, errorResponse, json, requireEnv } from '../_shared/http.ts';
import { RECEIPT_PROMPT, ReceiptSchema, receiptJsonSchema } from '../_shared/receipt.ts';
import { adminClient, isUuid, userClient } from '../_shared/supabase.ts';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5';
const EFFORT = (Deno.env.get('ANTHROPIC_EFFORT') ?? 'low') as 'low' | 'medium' | 'high';
const MONTHLY_LIMIT = Number(Deno.env.get('AI_SCAN_MONTHLY_LIMIT') ?? '60');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const anthropic = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });

function mediaTypeFor(path: string, blobType: string): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | null {
  const t = blobType.toLowerCase();
  if (t === 'image/jpeg' || t === 'image/png' || t === 'image/webp' || t === 'image/gif') return t;
  const ext = path.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST.');

  const authorization = req.headers.get('Authorization') ?? '';
  const jwt = authorization.replace(/^Bearer\s+/i, '');
  if (!jwt) return errorResponse(401, 'unauthorized', 'Sign in first.');

  const admin = adminClient();
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData.user) return errorResponse(401, 'unauthorized', 'Sign in first.');
  const userId = userData.user.id;

  let body: { path?: unknown; trip_id?: unknown; currency_hint?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'bad_request', 'Send JSON.');
  }
  const path = typeof body.path === 'string' ? body.path : '';
  const tripId = body.trip_id;
  const currencyHint = typeof body.currency_hint === 'string' && /^[A-Z]{3}$/.test(body.currency_hint)
    ? body.currency_hint
    : null;
  if (!isUuid(tripId) || !path.startsWith(`${tripId}/`) || path.includes('..')) {
    return errorResponse(400, 'bad_request', 'Missing receipt photo.');
  }

  // Plan and quota.
  const { data: account } = await admin
    .from('accounts')
    .select('plan, plan_expires_at, ai_scans_used, ai_scans_period')
    .eq('user_id', userId)
    .maybeSingle();
  const isPro =
    account?.plan === 'pro' &&
    (!account.plan_expires_at || new Date(account.plan_expires_at).getTime() > Date.now());
  if (!isPro) {
    return errorResponse(402, 'pro_required', 'Receipt scanning is part of Tripley Pro.');
  }
  const period = new Date().toISOString().slice(0, 7);
  const used = account.ai_scans_period === period ? account.ai_scans_used : 0;
  if (used >= MONTHLY_LIMIT) {
    return errorResponse(429, 'quota_exceeded', `You've used all ${MONTHLY_LIMIT} scans this month. You can still type the items in.`);
  }

  // Download as the user: storage RLS only lets trip members read the trip folder.
  const { data: blob, error: downloadError } = await userClient(authorization)
    .storage.from('receipts')
    .download(path);
  if (downloadError || !blob) return errorResponse(404, 'not_found', 'Receipt photo not found.');
  if (blob.size > MAX_IMAGE_BYTES) return errorResponse(413, 'too_large', 'That photo is too large. Try again with a smaller one.');
  const mediaType = mediaTypeFor(path, blob.type);
  if (!mediaType) return errorResponse(415, 'unsupported', 'Use a JPEG or PNG photo.');
  const data = toBase64(new Uint8Array(await blob.arrayBuffer()));

  let response: Anthropic.Beta.Messages.BetaMessage;
  try {
    response = await anthropic.beta.messages.create({
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
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            {
              type: 'text',
              text: `${RECEIPT_PROMPT}\n\nCurrency hint (the trip's currency): ${currencyHint ?? 'unknown'}.`,
            },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return errorResponse(503, 'busy', 'Receipt reading is busy. Try again in a minute.');
    }
    if (err instanceof Anthropic.APIError) {
      console.error('anthropic error', err.status, err.message);
      return errorResponse(502, 'ai_error', 'Could not read the receipt right now. You can type the items in.');
    }
    throw err;
  }

  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
    console.warn('receipt not read', response.stop_reason, response.stop_details);
    return errorResponse(422, 'unreadable', "Couldn't read this receipt. You can type the items in.");
  }
  const text = response.content.find((b) => b.type === 'text');
  let parsed;
  try {
    parsed = ReceiptSchema.parse(JSON.parse(text && text.type === 'text' ? text.text : ''));
  } catch {
    return errorResponse(422, 'unreadable', "Couldn't read this receipt. You can type the items in.");
  }

  // Count the scan only once it worked.
  await admin
    .from('accounts')
    .update({ ai_scans_used: used + 1, ai_scans_period: period, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  return json({ receipt: parsed, scans_left: Math.max(0, MONTHLY_LIMIT - used - 1) });
});
