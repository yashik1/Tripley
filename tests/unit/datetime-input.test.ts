import { describe, expect, it } from 'vitest';

import { combineLocal, fromPickerDate, parseDay, splitLocal, toBrowserValue, toPickerDate } from '../../src/lib/datetime-input';

describe('date and time fields', () => {
  it('only real calendar days are days', () => {
    expect(parseDay('2026-12-03')).toEqual({ y: 2026, m: 12, d: 3 });
    expect(parseDay('2026-02-30')).toBeNull();
    expect(parseDay('3/12/2026')).toBeNull();
  });

  it('a picker opens on the day typed, or today', () => {
    const d = toPickerDate('date', '2026-12-03');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 11, 3]);
    const fallback = new Date(2026, 10, 10, 15, 42);
    const t = toPickerDate('date', 'nonsense', fallback);
    expect([t.getFullYear(), t.getMonth(), t.getDate(), t.getHours()]).toEqual([2026, 10, 10, 0]);
  });

  it('a clock opens on the time typed (any common format), or the start of this hour', () => {
    const fallback = new Date(2026, 10, 10, 15, 42);
    expect(fromPickerDate('time', toPickerDate('time', '9:30pm', fallback))).toBe('21:30');
    expect(fromPickerDate('time', toPickerDate('time', '', fallback))).toBe('15:00');
  });

  it('picked values are written the way the forms expect', () => {
    const d = new Date(2026, 0, 5, 7, 5);
    expect(fromPickerDate('date', d)).toBe('2026-01-05');
    expect(fromPickerDate('time', d)).toBe('07:05');
  });

  it('the browser picker gets a clean value or nothing', () => {
    expect(toBrowserValue('date', ' 2026-12-03 ')).toBe('2026-12-03');
    expect(toBrowserValue('date', '2026-13-01')).toBe('');
    expect(toBrowserValue('time', '9.30')).toBe('09:30');
    expect(toBrowserValue('time', 'later')).toBe('');
  });

  it('a day and a time make a moment in local time, and back', () => {
    const iso = combineLocal('2026-12-03', '18:30')!;
    expect(new Date(iso).getHours()).toBe(18);
    expect(splitLocal(iso)).toEqual({ day: '2026-12-03', time: '18:30' });
    expect(combineLocal('2026-12-03', 'soon')).toBeNull();
    expect(splitLocal(null)).toEqual({ day: '', time: '' });
  });
});
