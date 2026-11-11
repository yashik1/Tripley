/**
 * Converting between what date and time fields hold ("2026-12-03", "14:30")
 * and the Date objects pickers use. Everything is local time: a trip day is a
 * calendar day where you are, not a UTC instant.
 */
import { parseTime } from './itinerary';

export type PickerMode = 'date' | 'time';

const pad = (n: number) => String(n).padStart(2, '0');

/** A real calendar day written as YYYY-MM-DD, or null. */
export function parseDay(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? { y, m, d } : null;
}

/** The Date a picker should open on, from the field's text (or `fallback` when the text isn't a valid value yet). */
export function toPickerDate(mode: PickerMode, value: string, fallback: Date = new Date()): Date {
  if (mode === 'date') {
    const day = parseDay(value);
    return day ? new Date(day.y, day.m - 1, day.d) : new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }
  const time = parseTime(value);
  const base = new Date(fallback);
  if (time) base.setHours(Number(time.slice(0, 2)), Number(time.slice(3, 5)), 0, 0);
  else base.setMinutes(0, 0, 0);
  return base;
}

/** What the field should hold after picking `date`. */
export function fromPickerDate(mode: PickerMode, date: Date): string {
  return mode === 'date'
    ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The value a browser <input type="date|time"> accepts: valid, normalised, or empty. */
export function toBrowserValue(mode: PickerMode, value: string): string {
  if (mode === 'date') return parseDay(value) ? value.trim() : '';
  return parseTime(value) ?? '';
}

/** "2026-12-03" + "18:30" -> an ISO timestamp in local time, or null if either isn't valid. */
export function combineLocal(day: string, time: string): string | null {
  const d = parseDay(day);
  const t = parseTime(time);
  if (!d || !t) return null;
  return new Date(d.y, d.m - 1, d.d, Number(t.slice(0, 2)), Number(t.slice(3, 5))).toISOString();
}

/** An ISO timestamp -> the day and time fields, in local time. */
export function splitLocal(iso: string | null): { day: string; time: string } {
  if (!iso) return { day: '', time: '' };
  const d = new Date(iso);
  return { day: fromPickerDate('date', d), time: fromPickerDate('time', d) };
}
