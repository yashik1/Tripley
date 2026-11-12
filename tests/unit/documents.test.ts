import { describe, expect, it } from 'vitest';

import { documentTitle, extensionFor, formFromRead, mimeFromName, sortBookings, type ReadBooking } from '../../src/lib/documents';

const read: ReadBooking = {
  kind: 'flight',
  title: 'TP1350 Lisbon → Porto',
  provider: 'TAP',
  reference: 'ABC123',
  start_day: '2026-12-02',
  start_time: '09:40',
  end_day: '2026-12-02',
  end_time: '10:35',
  from_place: 'Lisbon LIS',
  to_place: 'Porto OPO',
  address: null,
  travellers: ['COSTA/ANA MS', 'Ortiz Ben', 'Somebody Else'],
  notes: null,
};
const members = [
  { id: 'ana', name: 'Ana Costa' },
  { id: 'ben', name: 'Ben Ortiz' },
  { id: 'ana2', name: 'Ana' },
];

describe('documents', () => {
  it('knows file types by name and gives safe extensions', () => {
    expect(mimeFromName('Ticket.PDF')).toBe('application/pdf');
    expect(mimeFromName('a.jpeg')).toBe('image/jpeg');
    expect(mimeFromName('a.svg')).toBeNull();
    expect(extensionFor('image/webp')).toBe('webp');
    expect(documentTitle('Boarding_pass  TP1350.pdf')).toBe('Boarding pass TP1350');
    expect(documentTitle('.pdf')).toBe('Document');
  });

  it('orders bookings by when they start; undated last, newest first', () => {
    const list = [
      { id: 'c', start_day: null, start_time: null, created_at: '2026-11-01' },
      { id: 'b', start_day: '2026-12-02', start_time: '18:00', created_at: '2026-11-01' },
      { id: 'a', start_day: '2026-12-02', start_time: '09:40', created_at: '2026-11-01' },
      { id: 'd', start_day: null, start_time: null, created_at: '2026-11-05' },
      { id: 'e', start_day: '2026-12-02', start_time: null, created_at: '2026-11-01' },
    ];
    expect(sortBookings(list).map((x) => x.id)).toEqual(['a', 'b', 'e', 'd', 'c']);
  });

  it('turns what the AI read into a form, matching travellers only when it’s clear', () => {
    const form = formFromRead(read, members);
    expect(form).toMatchObject({ kind: 'flight', reference: 'ABC123', startDay: '2026-12-02', startTime: '09:40', endTime: '10:35' });
    // "COSTA/ANA" is Ana Costa (the fuller match), not the other Ana.
    expect(form.travellerIds.sort()).toEqual(['ana', 'ben']);
    expect(formFromRead({ ...read, travellers: ['ANA'] }, [...members, { id: 'ana3', name: 'Ana' }]).travellerIds).toEqual([]);
  });

  it('drops malformed dates, times without a day, and an end before the start', () => {
    const form = formFromRead({ ...read, start_day: '2 Dec', start_time: '25:00', end_day: '2026-11-30', end_time: '10:00', title: '  ' }, members);
    expect(form).toMatchObject({ startDay: '', startTime: '', endDay: '2026-11-30', title: 'Flight' });
    const backwards = formFromRead({ ...read, end_day: '2026-12-01' }, members);
    expect(backwards.endDay).toBe('');
  });
});
