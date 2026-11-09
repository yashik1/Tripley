/**
 * AI receipt scan request handling (supabase/functions/_shared/scan.ts).
 * The quota itself (atomic reservation, refunds, last-slot race) is tested in
 * tests/db/security.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';

import { handleScan, receiptPathOk, sniffImage, type ReserveResult, type ScanDeps } from '../../supabase/functions/_shared/scan.ts';

const TRIP = '3f1c2a4e-1111-4222-8333-444455556666';
const REQ = '9a8b7c6d-1111-4222-8333-444455556666';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = new TextEncoder().encode('<!doctype html><html></html>');

function deps(over: Partial<ScanDeps> = {}): ScanDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    monthlyLimit: 60,
    perMinute: 6,
    maxImageBytes: 1024,
    userIdFor: async (jwt) => (jwt === 'good' ? 'user-1' : null),
    reserve: vi.fn(async (): Promise<ReserveResult> => {
      calls.push('reserve');
      return { status: 'reserved', scans_left: 9 };
    }),
    finish: vi.fn(async () => void calls.push('finish')),
    release: vi.fn(async () => void calls.push('release')),
    download: async () => JPEG,
    read: async () => ({ ok: true, receipt: { merchant: 'Café' } }),
    newRequestId: () => 'generated-id',
    ...over,
  } as ScanDeps & { calls: string[] };
}

function scan(body: unknown, auth = 'Bearer good') {
  return new Request('https://x/scan-receipt', {
    method: 'POST',
    headers: { Authorization: auth, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const ok = { trip_id: TRIP, path: `${TRIP}/abc123.jpg`, request_id: REQ, currency_hint: 'EUR' };

describe('image and path checks', () => {
  it('recognises images by their bytes', () => {
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(WEBP)).toBe('image/webp');
    expect(sniffImage(SVG)).toBeNull();
    expect(sniffImage(HTML)).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });

  it('accepts only "<trip>/<safe name>.<image ext>"', () => {
    expect(receiptPathOk(TRIP, `${TRIP}/abc-1_2.jpeg`)).toBe(true);
    for (const p of [`${TRIP}/x.svg`, `${TRIP}/../x.jpg`, `${TRIP}/a/b.jpg`, `other/${TRIP}.jpg`, `${TRIP}/.jpg`, `${TRIP}/x.JPG.html`]) {
      expect(receiptPathOk(TRIP, p)).toBe(false);
    }
    expect(receiptPathOk('not-a-uuid', 'not-a-uuid/x.jpg')).toBe(false);
  });
});

describe('scan-receipt handler', () => {
  it('reads a receipt, charges the reservation and returns it', async () => {
    const d = deps();
    const res = await handleScan(scan(ok), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ receipt: { merchant: 'Café' }, scans_left: 9 });
    expect(d.reserve).toHaveBeenCalledWith({ userId: 'user-1', requestId: REQ, tripId: TRIP, path: ok.path, limit: 60, perMinute: 6 });
    expect(d.calls).toEqual(['reserve', 'finish']);
  });

  it('needs a valid sign-in', async () => {
    expect((await handleScan(scan(ok, ''), deps())).status).toBe(401);
    expect((await handleScan(scan(ok, 'Bearer forged'), deps())).status).toBe(401);
    const throws = deps({ userIdFor: async () => Promise.reject(new Error('auth down')) });
    expect((await handleScan(scan(ok), throws)).status).toBe(401);
  });

  it('rejects malformed requests before reserving anything', async () => {
    const d = deps();
    for (const body of ['{oops', [], { ...ok, trip_id: 'x' }, { ...ok, path: `${TRIP}/x.svg` }, { ...ok, path: `${TRIP}/../a.jpg` }, { ...ok, request_id: 'nope' }]) {
      expect((await handleScan(scan(body), d)).status).toBe(400);
    }
    expect((await handleScan(scan({ ...ok, pad: 'x'.repeat(5000) }), d)).status).toBe(413);
    expect(d.reserve).not.toHaveBeenCalled();
  });

  it('maps quota answers to clear errors', async () => {
    const cases: [ReserveResult, number, string][] = [
      [{ status: 'pro_required' }, 402, 'pro_required'],
      [{ status: 'not_member' }, 403, 'not_member'],
      [{ status: 'quota_exceeded', limit: 60 }, 429, 'quota_exceeded'],
      [{ status: 'rate_limited' }, 429, 'rate_limited'],
      [{ status: 'in_progress' }, 409, 'in_progress'],
    ];
    for (const [reservation, status, code] of cases) {
      const d = deps({ reserve: async () => reservation });
      const res = await handleScan(scan(ok), d);
      expect(res.status).toBe(status);
      expect((await res.json()).error.code).toBe(code);
      expect(d.release).not.toHaveBeenCalled();
    }
  });

  it('a retry of a finished scan returns the saved result without calling the AI', async () => {
    const read = vi.fn();
    const d = deps({ reserve: async () => ({ status: 'done', result: { merchant: 'Café' }, scans_left: 4 }), read });
    const res = await handleScan(scan(ok), d);
    expect(await res.json()).toEqual({ receipt: { merchant: 'Café' }, scans_left: 4 });
    expect(read).not.toHaveBeenCalled();
  });

  it('gives the scan back when the photo is missing, too big or not an image', async () => {
    const cases: [ScanDeps['download'], number][] = [
      [async () => null, 404],
      [async () => new Uint8Array(2048).fill(0xff), 413],
      [async () => SVG, 415],
      [async () => HTML, 415],
    ];
    for (const [download, status] of cases) {
      const d = deps({ download, read: vi.fn() });
      expect((await handleScan(scan(ok), d)).status).toBe(status);
      expect(d.calls).toEqual(['reserve', 'release']);
      expect(d.read).not.toHaveBeenCalled();
    }
  });

  it('gives the scan back when the AI times out, is busy, fails or can’t read it', async () => {
    const cases: ['unreadable' | 'busy' | 'timeout' | 'failed', number][] = [
      ['timeout', 504],
      ['busy', 503],
      ['failed', 502],
      ['unreadable', 422],
    ];
    for (const [reason, status] of cases) {
      const d = deps({ read: async () => ({ ok: false, reason }) });
      expect((await handleScan(scan(ok), d)).status).toBe(status);
      expect(d.calls).toEqual(['reserve', 'release']);
    }
  });

  it('an unexpected error gives the scan back and hides the details', async () => {
    const d = deps({ read: async () => Promise.reject(new Error('secret internal detail')) });
    const res = await handleScan(scan(ok), d);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret internal detail');
    expect(d.calls).toEqual(['reserve', 'release']);
  });

  it('per-IP flood limit', async () => {
    const d = deps({ ipAllowed: () => false });
    expect((await handleScan(scan(ok), d, '203.0.113.9')).status).toBe(429);
    expect(d.reserve).not.toHaveBeenCalled();
  });

  it('never logs the receipt or the image', async () => {
    const lines: string[] = [];
    const log = (e: string, f: Record<string, unknown>) => lines.push(JSON.stringify({ e, ...f }));
    await handleScan(scan(ok), deps({ log }));
    await handleScan(scan(ok), deps({ log, read: async () => ({ ok: false, reason: 'failed' }) }));
    expect(lines.join('\n')).not.toMatch(/Café|merchant|\/9j|ffd8/);
  });
});
