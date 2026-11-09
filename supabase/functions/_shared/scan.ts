// AI receipt reading: request handling, kept free of Deno and SDK imports so it
// can be unit tested. The quota is reserved in the database before the AI call
// (one atomic step) and given back if the call fails; a retry with the same
// request_id returns the earlier result without charging again.

import { BodyError, corsHeaders, errorResponse, isUuid, json, readJsonObject } from './http.ts';

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Works out the image type from the file's first bytes, not its name or header. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return 'image/webp';
  }
  return null;
}

/** Receipt photos live at "<trip id>/<name>.<jpg|jpeg|png|webp>" (one folder, safe characters). */
export function receiptPathOk(tripId: string, path: string): boolean {
  if (!isUuid(tripId) || typeof path !== 'string') return false;
  const prefix = `${tripId}/`;
  if (!path.startsWith(prefix)) return false;
  return /^[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$/.test(path.slice(prefix.length));
}

export type ReserveResult =
  | { status: 'reserved'; scans_left: number }
  | { status: 'done'; result: unknown; scans_left: number }
  | { status: 'in_progress' | 'pro_required' | 'not_member' | 'rate_limited' | 'bad_request' }
  | { status: 'quota_exceeded'; limit: number };

export type ReadResult =
  | { ok: true; receipt: unknown }
  | { ok: false; reason: 'unreadable' | 'busy' | 'timeout' | 'failed' };

export interface ScanDeps {
  monthlyLimit: number;
  perMinute: number;
  maxImageBytes: number;
  /** Who the bearer token belongs to (null when invalid). */
  userIdFor: (jwt: string) => Promise<string | null>;
  reserve: (a: { userId: string; requestId: string; tripId: string; path: string; limit: number; perMinute: number }) => Promise<ReserveResult>;
  finish: (userId: string, requestId: string, receipt: unknown) => Promise<void>;
  release: (userId: string, requestId: string) => Promise<void>;
  /** Downloads the photo as the user (storage rules check trip membership); null if not found. */
  download: (authorization: string, path: string) => Promise<Uint8Array | null>;
  read: (image: { data: Uint8Array; mediaType: ImageType }, currencyHint: string | null) => Promise<ReadResult>;
  /** Best-effort per-IP limit; false = too many requests. */
  ipAllowed?: (ip: string) => boolean;
  newRequestId: () => string;
  log?: (event: string, fields: Record<string, string | number | boolean>) => void;
}

const MAX_BODY_BYTES = 4 * 1024;

export async function handleScan(req: Request, deps: ScanDeps, ip = 'unknown'): Promise<Response> {
  const log = deps.log ?? (() => {});
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST.');
  if (deps.ipAllowed && !deps.ipAllowed(ip)) {
    return errorResponse(429, 'rate_limited', 'Too many requests. Try again in a minute.');
  }

  const authorization = req.headers.get('Authorization') ?? '';
  const jwt = authorization.replace(/^Bearer\s+/i, '');
  if (!jwt) return errorResponse(401, 'unauthorized', 'Sign in first.');
  let userId: string | null;
  try {
    userId = await deps.userIdFor(jwt);
  } catch {
    userId = null;
  }
  if (!userId) return errorResponse(401, 'unauthorized', 'Sign in first.');

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(req, MAX_BODY_BYTES);
  } catch (e) {
    return errorResponse(e instanceof BodyError ? e.status : 400, 'bad_request', 'Send JSON.');
  }
  const tripId = body.trip_id;
  const path = body.path;
  const currencyHint = typeof body.currency_hint === 'string' && /^[A-Z]{3}$/.test(body.currency_hint) ? body.currency_hint : null;
  if (body.request_id !== undefined && !isUuid(body.request_id)) {
    return errorResponse(400, 'bad_request', 'Bad request id.');
  }
  // Older app versions don't send a request id; their retries are charged again.
  const requestId = (body.request_id as string | undefined) ?? deps.newRequestId();
  if (!isUuid(tripId) || typeof path !== 'string' || !receiptPathOk(tripId, path)) {
    return errorResponse(400, 'bad_request', 'Missing receipt photo.');
  }

  let reservation: ReserveResult;
  try {
    reservation = await deps.reserve({ userId, requestId, tripId, path, limit: deps.monthlyLimit, perMinute: deps.perMinute });
  } catch {
    log('scan_reserve_failed', {});
    return errorResponse(500, 'server_error', 'Could not start reading the receipt. Try again.');
  }
  switch (reservation.status) {
    case 'reserved':
      break;
    case 'done':
      return json({ receipt: reservation.result, scans_left: reservation.scans_left });
    case 'in_progress':
      return errorResponse(409, 'in_progress', 'This receipt is still being read. Try again in a moment.');
    case 'pro_required':
      return errorResponse(402, 'pro_required', 'Receipt scanning is part of Tripley Pro.');
    case 'not_member':
      return errorResponse(403, 'not_member', 'You are not in this trip.');
    case 'quota_exceeded':
      return errorResponse(429, 'quota_exceeded', `You've used all ${reservation.limit} scans this month. You can still type the items in.`);
    case 'rate_limited':
      return errorResponse(429, 'rate_limited', 'Too many scans in a row. Try again in a minute.');
    default:
      return errorResponse(400, 'bad_request', 'Missing receipt photo.');
  }

  // From here on, anything that goes wrong gives the scan back.
  const giveBack = async (status: number, code: string, message: string) => {
    try {
      await deps.release(userId, requestId);
    } catch {
      log('scan_release_failed', { code });
    }
    log('scan_failed', { code });
    return errorResponse(status, code, message);
  };

  try {
    const bytes = await deps.download(authorization, path);
    if (!bytes) return await giveBack(404, 'not_found', 'Receipt photo not found.');
    if (bytes.length > deps.maxImageBytes) return await giveBack(413, 'too_large', 'That photo is too large. Try again with a smaller one.');
    const mediaType = sniffImage(bytes);
    if (!mediaType) return await giveBack(415, 'unsupported', 'Use a JPEG, PNG or WebP photo.');

    const read = await deps.read({ data: bytes, mediaType }, currencyHint);
    if (!read.ok) {
      switch (read.reason) {
        case 'unreadable':
          return await giveBack(422, 'unreadable', "Couldn't read this receipt. You can type the items in.");
        case 'busy':
          return await giveBack(503, 'busy', 'Receipt reading is busy. Try again in a minute.');
        case 'timeout':
          return await giveBack(504, 'timeout', 'Reading the receipt took too long. Try again.');
        default:
          return await giveBack(502, 'ai_error', 'Could not read the receipt right now. You can type the items in.');
      }
    }
    await deps.finish(userId, requestId, read.receipt);
    log('scan_done', {});
    const scansLeft = (reservation as { scans_left: number }).scans_left;
    return json({ receipt: read.receipt, scans_left: scansLeft });
  } catch {
    return await giveBack(500, 'server_error', 'Something went wrong reading the receipt. You can type the items in.');
  }
}
