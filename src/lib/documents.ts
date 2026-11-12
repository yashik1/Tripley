/**
 * Bookings and documents: pure helpers (file types, booking kinds, ordering,
 * and turning an AI-read booking into form values).
 */
export const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type PickedDocument = { name: string; mime: string; bytes: ArrayBuffer };

export function mimeFromName(name: string): DocumentType | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return ext === 'pdf' ? 'application/pdf' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : null;
}

export function extensionFor(mime: string): string {
  return mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
}

/** A file name to show: the original without its extension, tidied, at most 120 characters. */
export function documentTitle(fileName: string): string {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (base || 'Document').slice(0, 120);
}

export const BOOKING_KINDS = [
  { kind: 'flight', label: 'Flight', emoji: '✈️' },
  { kind: 'train', label: 'Train', emoji: '🚆' },
  { kind: 'bus', label: 'Bus', emoji: '🚌' },
  { kind: 'ferry', label: 'Ferry', emoji: '⛴️' },
  { kind: 'car', label: 'Car hire', emoji: '🚗' },
  { kind: 'stay', label: 'Stay', emoji: '🏨' },
  { kind: 'ticket', label: 'Ticket', emoji: '🎟️' },
  { kind: 'other', label: 'Other', emoji: '📄' },
] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number]['kind'];

export const kindInfo = (kind: string) => BOOKING_KINDS.find((k) => k.kind === kind) ?? BOOKING_KINDS[BOOKING_KINDS.length - 1];

/** Earliest first; bookings without a day go last, newest added first among them. */
export function sortBookings<B extends { start_day: string | null; start_time: string | null; created_at: string }>(list: B[]): B[] {
  return [...list].sort((a, b) => {
    if (a.start_day && b.start_day) {
      return a.start_day.localeCompare(b.start_day) || (a.start_time ?? '99').localeCompare(b.start_time ?? '99');
    }
    if (a.start_day) return -1;
    if (b.start_day) return 1;
    return b.created_at.localeCompare(a.created_at);
  });
}

/** What the AI read from a confirmation (supabase/functions/_shared/booking.ts). */
export type ReadBooking = {
  kind: BookingKind;
  title: string;
  provider: string | null;
  reference: string | null;
  start_day: string | null;
  start_time: string | null;
  end_day: string | null;
  end_time: string | null;
  from_place: string | null;
  to_place: string | null;
  address: string | null;
  travellers: string[];
  notes: string | null;
};

export type BookingForm = {
  kind: BookingKind;
  title: string;
  provider: string;
  reference: string;
  startDay: string;
  startTime: string;
  endDay: string;
  endTime: string;
  fromPlace: string;
  toPlace: string;
  address: string;
  notes: string;
  travellerIds: string[];
};

const isDay = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isTime = (s: string | null) => !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/).filter((w) => w.length > 1);

/**
 * Turns an AI-read booking into form values to review. Times without a day,
 * malformed dates and over-long text are dropped or trimmed; traveller names
 * are matched to people on the trip by first and last name, when that's clear.
 */
export function formFromRead(read: ReadBooking, members: { id: string; name: string }[]): BookingForm {
  const startDay = isDay(read.start_day) ? read.start_day! : '';
  const endDay = isDay(read.end_day) ? read.end_day! : '';
  const travellerIds = new Set<string>();
  for (const printed of read.travellers ?? []) {
    const p = new Set(words(printed));
    // Everyone whose whole name is in the printed one; the fullest match wins
    // ("ANA COSTA" is Ana Costa, not another Ana), and a tie matches nobody.
    const hits = members
      .map((m) => ({ id: m.id, n: words(m.name).length, ok: words(m.name).every((x) => p.has(x)) }))
      .filter((h) => h.ok && h.n > 0)
      .sort((a, b) => b.n - a.n);
    if (hits.length && (hits.length === 1 || hits[0].n > hits[1].n)) travellerIds.add(hits[0].id);
  }
  const clip = (s: string | null, n: number) => (s ?? '').trim().slice(0, n);
  return {
    kind: BOOKING_KINDS.some((k) => k.kind === read.kind) ? read.kind : 'other',
    title: clip(read.title, 120) || kindInfo(read.kind).label,
    provider: clip(read.provider, 80),
    reference: clip(read.reference, 60),
    startDay,
    startTime: startDay && isTime(read.start_time) ? read.start_time! : '',
    endDay: endDay && (!startDay || endDay >= startDay) ? endDay : '',
    endTime: endDay && isTime(read.end_time) ? read.end_time! : '',
    fromPlace: clip(read.from_place, 120),
    toPlace: clip(read.to_place, 120),
    address: clip(read.address, 300),
    notes: clip(read.notes, 1000),
    travellerIds: [...travellerIds],
  };
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

/** "2 Dec 09:40 – 10:35", or "2 Dec 15:00 → 5 Dec 11:00". */
export function bookingWhen(
  b: { start_day: string | null; start_time: string | null; end_day: string | null; end_time: string | null },
  formatDay: (iso: string) => string,
): string | null {
  if (!b.start_day) return null;
  const start = [formatDay(b.start_day), hhmm(b.start_time)].filter(Boolean).join(' ');
  if (!b.end_day) return start;
  if (b.end_day === b.start_day) return b.end_time ? `${start} – ${hhmm(b.end_time)}` : start;
  return `${start} → ${[formatDay(b.end_day), hhmm(b.end_time)].filter(Boolean).join(' ')}`;
}
