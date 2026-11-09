// Small HTTP helpers shared by the edge functions. No Deno APIs here, so the
// request handlers that use them can be unit tested under Node.

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders, ...extraHeaders },
  });
}

export function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

/** Constant-time comparison for shared secrets in webhook headers. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  // Compare against the expected length every time so timing doesn't reveal it.
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) diff |= (x[i] ?? 0) ^ y[i];
  return diff === 0;
}

export class BodyError extends Error {
  constructor(
    public status: 400 | 413,
    public code: string,
  ) {
    super(code);
  }
}

/** Reads a JSON object body, refusing anything larger than `maxBytes`. */
export async function readJsonObject(req: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new BodyError(413, 'too_large');
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new BodyError(413, 'too_large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BodyError(400, 'bad_request');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new BodyError(400, 'bad_request');
  return parsed as Record<string, unknown>;
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Best-effort per-IP limiter (in memory, so per function instance). The real
 * limits live in the database; this only blunts floods before they reach it.
 */
export function ipLimiter(perMinute: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (ip: string): boolean => {
    const t = now();
    const recent = (hits.get(ip) ?? []).filter((x) => t - x < 60_000);
    if (recent.length >= perMinute) {
      hits.set(ip, recent);
      return false;
    }
    recent.push(t);
    hits.set(ip, recent);
    if (hits.size > 10_000) hits.clear();
    return true;
  };
}

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
}
