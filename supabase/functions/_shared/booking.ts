import { z } from 'zod';

// Keep in sync with src/lib/bookings.ts (ReadBooking).
export const BOOKING_KINDS = ['flight', 'train', 'bus', 'ferry', 'car', 'stay', 'ticket', 'other'] as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const time = z.string().regex(/^\d{2}:\d{2}$/).nullable();

export const BookingSchema = z.object({
  kind: z.enum(BOOKING_KINDS),
  title: z.string(),
  provider: z.string().nullable(),
  reference: z.string().nullable(),
  start_day: day,
  start_time: time,
  end_day: day,
  end_time: time,
  from_place: z.string().nullable(),
  to_place: z.string().nullable(),
  address: z.string().nullable(),
  travellers: z.array(z.string()),
  notes: z.string().nullable(),
});

export type Booking = z.infer<typeof BookingSchema>;

const nullable = (type: 'string', description: string) => ({ anyOf: [{ type }, { type: 'null' }], description });

/** JSON Schema given to Claude's structured output (all fields required, no extras). */
export const bookingJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'title', 'provider', 'reference', 'start_day', 'start_time', 'end_day', 'end_time', 'from_place', 'to_place', 'address', 'travellers', 'notes'],
  properties: {
    kind: { type: 'string', enum: [...BOOKING_KINDS] },
    title: { type: 'string', description: 'Short title, e.g. "TP1350 Lisbon → Porto" or "Hotel Avenida, 3 nights"' },
    provider: nullable('string', 'Airline, rail company, hotel or venue'),
    reference: nullable('string', 'Booking or confirmation code exactly as printed'),
    start_day: nullable('string', 'Departure, check-in or event day as YYYY-MM-DD'),
    start_time: nullable('string', 'Local time as HH:MM (24 h)'),
    end_day: nullable('string', 'Arrival or check-out day as YYYY-MM-DD'),
    end_time: nullable('string', 'Local time as HH:MM (24 h)'),
    from_place: nullable('string', 'Where it starts: airport or station with its code, or the venue'),
    to_place: nullable('string', 'Where it ends, for journeys'),
    address: nullable('string', 'Street address for a stay or venue'),
    travellers: { type: 'array', items: { type: 'string' }, description: 'Passenger or guest names as printed' },
    notes: nullable('string', 'Seat, gate, terminal, check-in rules, or anything unclear; else null'),
  },
} as const;

export const BOOKING_PROMPT = `You read booking confirmations (flight, train, bus, ferry, car hire, hotel or rental stays, tickets for events or attractions) for a group trip app. The group keeps them in one place and may add them to the shared plan, so dates, times, places and the booking code matter most.

Extract one booking: the main one if several appear (for a return trip, the first leg; mention the return leg in notes).
- kind: flight, train, bus, ferry, car (car hire), stay (hotel, rental, hostel), ticket (event, museum, tour), or other.
- title: short and specific, like "TP1350 Lisbon → Porto", "Alfama flat, 3 nights", "Oceanário tickets".
- start_day / start_time: departure, check-in or event start, in the local time printed. end_day / end_time: arrival or check-out. Days as YYYY-MM-DD, times as HH:MM 24-hour. If the year isn't printed, use the trip details below to choose it. Null when not shown.
- reference: the booking or confirmation code exactly as printed (PNR, reservation number), else null.
- from_place / to_place: airports or stations with their codes where printed ("Lisbon LIS"); for a stay or ticket, put the venue in from_place and leave to_place null.
- address: the street address of a stay or venue when printed.
- travellers: passenger or guest names as printed; empty if none.
- notes: one or two short sentences with seat, terminal, gate, baggage, check-in rules, or anything you could not read; else null.

Never invent a code, time or name that isn't shown. If the file isn't a booking, set kind to other, title to "Not a booking", and say so in notes.`;
