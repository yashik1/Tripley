// AI booking reading (Tripley Pro).
//
// POST { path: "<trip_id>/<file>.pdf|jpg|png|webp", trip_id: "<uuid>",
//        request_id: "<uuid>", context?: "Lisbon, 2–6 Dec 2026" }
// with the user's Authorization header. The file is a trip document the user
// uploaded (trip-docs bucket). Reserves one AI read from the same monthly
// quota as receipt scans, downloads the file as the user (storage rules check
// trip membership and document privacy), checks it really is a PDF or image,
// asks Claude to read it into structured JSON, and returns
// { booking, scans_left }. If anything fails the read is given back; a retry
// with the same request_id returns the same result without charging again.
//
// Logs never include the file, the booking's contents, or tokens.

import Anthropic from '@anthropic-ai/sdk';
import { BOOKING_PROMPT, BookingSchema, bookingJsonSchema } from '../_shared/booking.ts';
import { envNumber, requireEnv } from '../_shared/env.ts';
import { clientIp, ipLimiter } from '../_shared/http.ts';
import { BOOKING_SPEC, handleAiRead, type AiReadResult, type FileType, type ReserveResult } from '../_shared/scan.ts';
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

async function readBooking(file: { data: Uint8Array; mediaType: FileType }, context: string | null): Promise<AiReadResult> {
  const data = toBase64(file.data);
  const source: Anthropic.Beta.Messages.BetaContentBlockParam =
    file.mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: file.mediaType, data } };
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
          format: { type: 'json_schema', schema: bookingJsonSchema as unknown as Record<string, unknown> },
        },
        messages: [
          {
            role: 'user',
            content: [source, { type: 'text', text: `${BOOKING_PROMPT}\n\nTrip details: ${context ?? 'unknown'}.` }],
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
    console.warn(JSON.stringify({ event: 'booking_not_read', stop_reason: response.stop_reason }));
    return { ok: false, reason: 'unreadable' };
  }
  const text = response.content.find((b) => b.type === 'text');
  try {
    return { ok: true, data: BookingSchema.parse(JSON.parse(text && text.type === 'text' ? text.text : '')) };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

Deno.serve((req) => {
  const admin = adminClient();
  return handleAiRead(
    req,
    {
      monthlyLimit: envNumber('AI_SCAN_MONTHLY_LIMIT', 60),
      perMinute: envNumber('AI_SCAN_PER_USER_PER_MINUTE', 6),
      maxBytes: 10 * 1024 * 1024,
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
      finish: async (userId, requestId, booking) => {
        const { error } = await admin.rpc('finish_ai_scan', { p_user: userId, p_request: requestId, p_result: booking });
        if (error) throw error;
      },
      release: async (userId, requestId) => {
        const { error } = await admin.rpc('release_ai_scan', { p_user: userId, p_request: requestId });
        if (error) throw error;
      },
      download: async (authorization, path) => {
        const { data, error } = await userClient(authorization).storage.from('trip-docs').download(path);
        if (error || !data) return null;
        return new Uint8Array(await data.arrayBuffer());
      },
      read: readBooking,
      ipAllowed,
      newRequestId: () => crypto.randomUUID(),
      log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
    },
    clientIp(req),
    BOOKING_SPEC,
  );
});
