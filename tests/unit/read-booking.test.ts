/**
 * AI booking reading (supabase/functions/_shared/scan.ts with BOOKING_SPEC,
 * and the schema in _shared/booking.ts). Same quota and refunds as receipts.
 */
import { describe, expect, it, vi } from 'vitest';

import { BookingSchema, bookingJsonSchema } from '../../supabase/functions/_shared/booking.ts';
import { BOOKING_SPEC, documentPathOk, handleAiRead, sniffFile, type AiReadDeps, type ReserveResult } from '../../supabase/functions/_shared/scan.ts';

const TRIP = '3f1c2a4e-1111-4222-8333-444455556666';
const REQ = '9a8b7c6d-1111-4222-8333-444455556666';
const PDF = new TextEncoder().encode('%PDF-1.7\n%âãÏÓ\n1 0 obj');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const HTML = new TextEncoder().encode('<!doctype html><html></html>');
const BOOKING = {
  kind: 'flight',
  title: 'TP1350 Lisbon → Porto',
  provider: 'TAP Air Portugal',
  reference: 'ABC123',
  start_day: '2026-12-02',
  start_time: '09:40',
  end_day: '2026-12-02',
  end_time: '10:35',
  from_place: 'Lisbon LIS',
  to_place: 'Porto OPO',
  address: null,
  travellers: ['ANA COSTA'],
  notes: null,
};

function deps(over: Partial<AiReadDeps> = {}): AiReadDeps & { calls: string[]; hints: (string | null)[] } {
  const calls: string[] = [];
  const hints: (string | null)[] = [];
  return {
    calls,
    hints,
    monthlyLimit: 60,
    perMinute: 6,
    maxBytes: 1024,
    userIdFor: async (jwt) => (jwt === 'good' ? 'user-1' : null),
    reserve: vi.fn(async (): Promise<ReserveResult> => {
      calls.push('reserve');
      return { status: 'reserved', scans_left: 9 };
    }),
    finish: vi.fn(async () => void calls.push('finish')),
    release: vi.fn(async () => void calls.push('release')),
    download: async () => PDF,
    read: async (_file, hint) => {
      hints.push(hint);
      return { ok: true, data: BOOKING };
    },
    newRequestId: () => 'generated-id',
    ...over,
  } as AiReadDeps & { calls: string[]; hints: (string | null)[] };
}

const post = (body: unknown, auth = 'Bearer good') =>
  new Request('https://x/read-booking', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('reading a booking', () => {
  it('reads a PDF in the trip’s documents and returns it as booking, charging once', async () => {
    const d = deps();
    const res = await handleAiRead(post({ trip_id: TRIP, path: `${TRIP}/conf.pdf`, request_id: REQ, context: 'Lisbon,\n2–6 Dec 2026' }), d, 'ip', BOOKING_SPEC);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ booking: BOOKING, scans_left: 9 });
    expect(d.calls).toEqual(['reserve', 'finish']);
    expect(d.hints).toEqual(['Lisbon, 2–6 Dec 2026']);
  });

  it('only files in the trip’s folder; anything that isn’t a PDF or image is refused and refunded', async () => {
    for (const path of [`${TRIP}/a/b.pdf`, `${TRIP}/x.html`, `other/${TRIP}.pdf`, `${TRIP}/.pdf`]) {
      const res = await handleAiRead(post({ trip_id: TRIP, path, request_id: REQ }), deps(), 'ip', BOOKING_SPEC);
      expect(res.status).toBe(400);
    }
    const d = deps({ download: async () => HTML });
    const res = await handleAiRead(post({ trip_id: TRIP, path: `${TRIP}/conf.pdf`, request_id: REQ }), d, 'ip', BOOKING_SPEC);
    expect(res.status).toBe(415);
    expect(d.calls).toEqual(['reserve', 'release']);
  });

  it('a photo of a booking works too; an unreadable one is given back', async () => {
    expect((await handleAiRead(post({ trip_id: TRIP, path: `${TRIP}/shot.jpg` }), deps({ download: async () => JPEG }), 'ip', BOOKING_SPEC)).status).toBe(200);
    const d = deps({ read: async () => ({ ok: false, reason: 'unreadable' }) });
    const res = await handleAiRead(post({ trip_id: TRIP, path: `${TRIP}/conf.pdf`, request_id: REQ }), d, 'ip', BOOKING_SPEC);
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe("Couldn't read this booking. You can type it in.");
    expect(d.calls).toEqual(['reserve', 'release']);
  });

  it('needs Pro, says so in booking words', async () => {
    const d = deps({ reserve: async () => ({ status: 'pro_required' }) });
    const res = await handleAiRead(post({ trip_id: TRIP, path: `${TRIP}/conf.pdf` }), d, 'ip', BOOKING_SPEC);
    expect(res.status).toBe(402);
    expect((await res.json()).error.message).toBe('Reading bookings is part of Tripley Pro.');
  });

  it('knows a PDF from its first bytes, and the path rules', () => {
    expect(sniffFile(PDF)).toBe('application/pdf');
    expect(sniffFile(JPEG)).toBe('image/jpeg');
    expect(sniffFile(HTML)).toBeNull();
    expect(documentPathOk(TRIP, `${TRIP}/Booking_1.pdf`)).toBe(true);
    expect(documentPathOk(TRIP, `${TRIP}/x.svg`)).toBe(false);
  });

  it('the schema the model must fill matches what the app accepts', () => {
    expect(BookingSchema.parse(BOOKING)).toEqual(BOOKING);
    expect(() => BookingSchema.parse({ ...BOOKING, start_day: '2 Dec' })).toThrow();
    expect([...bookingJsonSchema.required].sort()).toEqual(Object.keys(BOOKING).sort());
  });
});
