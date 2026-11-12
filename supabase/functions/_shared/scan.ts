// AI receipt reading: request handling, kept free of Deno and SDK imports so it
// can be unit tested. The quota is reserved in the database before the AI call
// (one atomic step) and given back if the call fails; a retry with the same
// request_id returns the earlier result without charging again.

import { BodyError, corsHeaders, errorResponse, isUuid, json, readJsonObject } from './http.ts';

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';
export type FileType = ImageType | 'application/pdf';

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

/** An image, or a PDF (it starts with "%PDF-"). */
export function sniffFile(bytes: Uint8Array): FileType | null {
  const image = sniffImage(bytes);
  if (image) return image;
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'application/pdf';
  return null;
}

/** Trip documents live at "<trip id>/<name>.<pdf|jpg|jpeg|png|webp>" in the trip-docs bucket. */
export function documentPathOk(tripId: string, path: string): boolean {
  if (!isUuid(tripId) || typeof path !== 'string') return false;
  const prefix = `${tripId}/`;
  if (!path.startsWith(prefix)) return false;
  return /^[A-Za-z0-9_-]{1,64}\.(pdf|jpg|jpeg|png|webp)$/.test(path.slice(prefix.length));
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

export type AiReadResult = { ok: true; data: unknown } | { ok: false; reason: 'unreadable' | 'busy' | 'timeout' | 'failed' };

/** What the receipt and booking readers share: who you are, the quota, the file. */
interface BaseDeps {
  monthlyLimit: number;
  perMinute: number;
  /** Who the bearer token belongs to (null when invalid). */
  userIdFor: (jwt: string) => Promise<string | null>;
  reserve: (a: { userId: string; requestId: string; tripId: string; path: string; limit: number; perMinute: number }) => Promise<ReserveResult>;
  finish: (userId: string, requestId: string, result: unknown) => Promise<void>;
  release: (userId: string, requestId: string) => Promise<void>;
  /** Downloads the file as the user (storage rules check trip membership); null if not found. */
  download: (authorization: string, path: string) => Promise<Uint8Array | null>;
  /** Best-effort per-IP limit; false = too many requests. */
  ipAllowed?: (ip: string) => boolean;
  newRequestId: () => string;
  log?: (event: string, fields: Record<string, string | number | boolean>) => void;
}

export interface ScanDeps extends BaseDeps {
  maxImageBytes: number;
  read: (image: { data: Uint8Array; mediaType: ImageType }, currencyHint: string | null) => Promise<ReadResult>;
}

export interface AiReadDeps extends BaseDeps {
  maxBytes: number;
  read: (file: { data: Uint8Array; mediaType: FileType }, hint: string | null) => Promise<AiReadResult>;
}

/** What differs between reading a receipt and reading a booking. */
export interface AiReadSpec {
  /** The JSON key the result is returned under. */
  resultKey: string;
  pathOk: (tripId: string, path: string) => boolean;
  accepts: (type: FileType) => boolean;
  hint: (body: Record<string, unknown>) => string | null;
  messages: {
    missing: string;
    proRequired: string;
    inProgress: string;
    quota: (limit: number) => string;
    rateLimited: string;
    start: string;
    notFound: string;
    tooLarge: string;
    unsupported: string;
    unreadable: string;
    busy: string;
    timeout: string;
    failed: string;
    crashed: string;
  };
}

export const RECEIPT_SPEC: AiReadSpec = {
  resultKey: 'receipt',
  pathOk: receiptPathOk,
  accepts: (type) => type !== 'application/pdf',
  hint: (body) => (typeof body.currency_hint === 'string' && /^[A-Z]{3}$/.test(body.currency_hint) ? body.currency_hint : null),
  messages: {
    missing: 'Missing receipt photo.',
    proRequired: 'Receipt scanning is part of Tripley Pro.',
    inProgress: 'This receipt is still being read. Try again in a moment.',
    quota: (limit) => `You've used all ${limit} scans this month. You can still type the items in.`,
    rateLimited: 'Too many scans in a row. Try again in a minute.',
    start: 'Could not start reading the receipt. Try again.',
    notFound: 'Receipt photo not found.',
    tooLarge: 'That photo is too large. Try again with a smaller one.',
    unsupported: 'Use a JPEG, PNG or WebP photo.',
    unreadable: "Couldn't read this receipt. You can type the items in.",
    busy: 'Receipt reading is busy. Try again in a minute.',
    timeout: 'Reading the receipt took too long. Try again.',
    failed: 'Could not read the receipt right now. You can type the items in.',
    crashed: 'Something went wrong reading the receipt. You can type the items in.',
  },
};

export const BOOKING_SPEC: AiReadSpec = {
  resultKey: 'booking',
  pathOk: documentPathOk,
  accepts: () => true,
  // A line about the trip (where, when), so dates without a year come out right.
  hint: (body) => (typeof body.context === 'string' ? body.context.replace(/[\r\n]+/g, ' ').slice(0, 300) || null : null),
  messages: {
    missing: 'Missing booking file.',
    proRequired: 'Reading bookings is part of Tripley Pro.',
    inProgress: 'This booking is still being read. Try again in a moment.',
    quota: (limit) => `You've used all ${limit} AI reads this month. You can still type the booking in.`,
    rateLimited: 'Too many in a row. Try again in a minute.',
    start: 'Could not start reading the booking. Try again.',
    notFound: 'Booking file not found.',
    tooLarge: 'That file is too large. Try one under 10 MB.',
    unsupported: 'Use a PDF, or a JPEG, PNG or WebP image.',
    unreadable: "Couldn't read this booking. You can type it in.",
    busy: 'Reading is busy. Try again in a minute.',
    timeout: 'Reading the booking took too long. Try again.',
    failed: 'Could not read the booking right now. You can type it in.',
    crashed: 'Something went wrong reading the booking. You can type it in.',
  },
};

const MAX_BODY_BYTES = 4 * 1024;

/** AI receipt reading. */
export function handleScan(req: Request, deps: ScanDeps, ip = 'unknown'): Promise<Response> {
  const { maxImageBytes, read, ...rest } = deps;
  return handleAiRead(
    req,
    {
      ...rest,
      maxBytes: maxImageBytes,
      read: async (file, hint) => {
        const r = await read(file as { data: Uint8Array; mediaType: ImageType }, hint);
        return r.ok ? { ok: true, data: r.receipt } : r;
      },
    },
    ip,
    RECEIPT_SPEC,
  );
}

export async function handleAiRead(req: Request, deps: AiReadDeps, ip: string, spec: AiReadSpec): Promise<Response> {
  const log = deps.log ?? (() => {});
  const m = spec.messages;
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
  const hint = spec.hint(body);
  if (body.request_id !== undefined && !isUuid(body.request_id)) {
    return errorResponse(400, 'bad_request', 'Bad request id.');
  }
  // Older app versions don't send a request id; their retries are charged again.
  const requestId = (body.request_id as string | undefined) ?? deps.newRequestId();
  if (!isUuid(tripId) || typeof path !== 'string' || !spec.pathOk(tripId, path)) {
    return errorResponse(400, 'bad_request', m.missing);
  }

  let reservation: ReserveResult;
  try {
    reservation = await deps.reserve({ userId, requestId, tripId, path, limit: deps.monthlyLimit, perMinute: deps.perMinute });
  } catch {
    log('scan_reserve_failed', {});
    return errorResponse(500, 'server_error', m.start);
  }
  switch (reservation.status) {
    case 'reserved':
      break;
    case 'done':
      return json({ [spec.resultKey]: reservation.result, scans_left: reservation.scans_left });
    case 'in_progress':
      return errorResponse(409, 'in_progress', m.inProgress);
    case 'pro_required':
      return errorResponse(402, 'pro_required', m.proRequired);
    case 'not_member':
      return errorResponse(403, 'not_member', 'You are not in this trip.');
    case 'quota_exceeded':
      return errorResponse(429, 'quota_exceeded', m.quota(reservation.limit));
    case 'rate_limited':
      return errorResponse(429, 'rate_limited', m.rateLimited);
    default:
      return errorResponse(400, 'bad_request', m.missing);
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
    if (!bytes) return await giveBack(404, 'not_found', m.notFound);
    if (bytes.length > deps.maxBytes) return await giveBack(413, 'too_large', m.tooLarge);
    const mediaType = sniffFile(bytes);
    if (!mediaType || !spec.accepts(mediaType)) return await giveBack(415, 'unsupported', m.unsupported);

    const read = await deps.read({ data: bytes, mediaType }, hint);
    if (!read.ok) {
      switch (read.reason) {
        case 'unreadable':
          return await giveBack(422, 'unreadable', m.unreadable);
        case 'busy':
          return await giveBack(503, 'busy', m.busy);
        case 'timeout':
          return await giveBack(504, 'timeout', m.timeout);
        default:
          return await giveBack(502, 'ai_error', m.failed);
      }
    }
    await deps.finish(userId, requestId, read.data);
    log('scan_done', {});
    const scansLeft = (reservation as { scans_left: number }).scans_left;
    return json({ [spec.resultKey]: read.data, scans_left: scansLeft });
  } catch {
    return await giveBack(500, 'server_error', m.crashed);
  }
}
