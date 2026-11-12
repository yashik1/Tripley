// AI first-draft plan (Tripley Pro).
//
// POST { trip_id: "<uuid>", request_id: "<uuid>", pace?: "relaxed" | "balanced" | "packed",
//        notes?: "museums and food, one beach day" }
// with the user's Authorization header. Reads the trip as the user (so only
// what they may see): dates, bucket-list ideas and votes, decided polls, the
// plan and shared bookings. Reserves one AI request from the monthly quota,
// asks Claude for a day-by-day draft as structured JSON, keeps only what the
// app can add (shared/plan-draft.ts cleanDraft) and returns { draft, scans_left }.
// Nothing is added to the plan here: the group reviews the draft first.
//
// Logs never include the trip's contents or tokens.

import Anthropic from '@anthropic-ai/sdk';
import { envNumber, requireEnv } from '../_shared/env.ts';
import { clientIp, ipLimiter } from '../_shared/http.ts';
import { draftJsonSchema, handlePlanDraft, type PlanContext } from '../_shared/plan-draft.ts';
import type { AiReadResult, ReserveResult } from '../_shared/scan.ts';
import { adminClient, userClient } from '../_shared/supabase.ts';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5';
const EFFORT = (Deno.env.get('PLAN_DRAFT_EFFORT') ?? 'medium') as 'low' | 'medium' | 'high';
const TIMEOUT_MS = envNumber('PLAN_DRAFT_TIMEOUT_MS', 120_000);

const anthropic = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY'), maxRetries: 1 });
const ipAllowed = ipLimiter(envNumber('AI_SCAN_PER_IP_PER_MINUTE', 20));

async function draft(prompt: string): Promise<AiReadResult> {
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
          format: { type: 'json_schema', schema: draftJsonSchema as unknown as Record<string, unknown> },
        },
        messages: [{ role: 'user', content: prompt }],
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
    console.warn(JSON.stringify({ event: 'plan_not_drafted', stop_reason: response.stop_reason }));
    return { ok: false, reason: 'unreadable' };
  }
  const text = response.content.find((b) => b.type === 'text');
  try {
    return { ok: true, data: JSON.parse(text && text.type === 'text' ? text.text : '') };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

async function loadContext(authorization: string, tripId: string): Promise<PlanContext | null> {
  const db = userClient(authorization);
  const trip = await db.from('trips').select('name, destination, starts_on, ends_on').eq('id', tripId).maybeSingle();
  if (trip.error) throw trip.error;
  if (!trip.data) return null;
  const today = new Date().toISOString().slice(0, 10);
  const [ideas, polls, stops, bookings] = await Promise.all([
    db.from('trip_suggestions').select('id, name, category, address, itinerary_item_id, suggestion_votes(user_id)').eq('trip_id', tripId).limit(60),
    db
      .from('trip_polls')
      .select('question, closed_at, closes_at, poll_options!poll_options_poll_id_fkey(id, label), poll_votes(option_id)')
      .eq('trip_id', tripId)
      .limit(30),
    db.from('itinerary_items').select('day, title, starts_at, ends_at').eq('trip_id', tripId).gte('day', today).limit(150),
    db.from('trip_bookings').select('kind, title, start_day, start_time, end_day, end_time').eq('trip_id', tripId).limit(60),
  ]);
  for (const r of [ideas, polls, stops, bookings]) if (r.error) throw r.error;
  type Idea = { id: string; name: string; category: string; address: string | null; itinerary_item_id: string | null; suggestion_votes: unknown[] };
  type PollRow = { question: string; closed_at: string | null; closes_at: string | null; poll_options: { id: string; label: string }[]; poll_votes: { option_id: string }[] };
  const now = Date.now();
  return {
    trip: trip.data,
    ideas: ((ideas.data ?? []) as Idea[])
      .map((i) => ({ id: i.id, name: i.name, category: i.category, address: i.address, votes: i.suggestion_votes?.length ?? 0, planned: !!i.itinerary_item_id }))
      .sort((a, b) => b.votes - a.votes),
    decided: ((polls.data ?? []) as PollRow[])
      .filter((p) => p.closed_at || (p.closes_at && Date.parse(p.closes_at) <= now))
      .map((p) => {
        const count = (id: string) => p.poll_votes.filter((v) => v.option_id === id).length;
        const best = [...p.poll_options].sort((a, b) => count(b.id) - count(a.id))[0];
        return best && count(best.id) > 0 ? { question: p.question, winner: best.label } : null;
      })
      .filter((x): x is { question: string; winner: string } => !!x),
    stops: (stops.data ?? []) as PlanContext['stops'],
    bookings: (bookings.data ?? []) as PlanContext['bookings'],
  };
}

Deno.serve((req) => {
  const admin = adminClient();
  return handlePlanDraft(
    req,
    {
      monthlyLimit: envNumber('AI_SCAN_MONTHLY_LIMIT', 60),
      perMinute: envNumber('AI_SCAN_PER_USER_PER_MINUTE', 6),
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
      finish: async (userId, requestId, result) => {
        const { error } = await admin.rpc('finish_ai_scan', { p_user: userId, p_request: requestId, p_result: result });
        if (error) throw error;
      },
      release: async (userId, requestId) => {
        const { error } = await admin.rpc('release_ai_scan', { p_user: userId, p_request: requestId });
        if (error) throw error;
      },
      loadContext,
      draft,
      today: () => new Date().toISOString().slice(0, 10),
      ipAllowed,
      log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
    },
    clientIp(req),
  );
});
