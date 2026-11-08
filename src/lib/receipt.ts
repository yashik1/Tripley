import { isCurrencyCode, toMinor } from './currency';

/**
 * Shape returned by the `scan-receipt` server function (AI receipt reading).
 * Amounts are decimal numbers in the receipt's currency, as printed.
 * Keep in sync with supabase/functions/_shared/receipt.ts.
 */
export type ScannedReceipt = {
  merchant: string | null;
  date: string | null; // YYYY-MM-DD
  currency: string | null; // ISO 4217
  items: { name: string; quantity: number; line_total: number }[];
  subtotal: number | null;
  tax: number | null;
  service_charge: number | null;
  tip: number | null;
  discount: number | null;
  total: number | null;
  notes: string | null;
};

export type DraftItem = {
  key: string;
  name: string;
  quantity: number;
  priceText: string; // what the user sees/edits, in major units
  assignees: Record<string, number>; // userId -> weight
};

export type ReceiptDraft = {
  title: string;
  date: string | null;
  currency: string;
  items: { name: string; quantity: number; lineTotalMinor: number }[];
  taxMinor: number;
  serviceMinor: number;
  tipMinor: number;
  discountMinor: number;
  totalMinor: number | null;
  notes: string | null;
};

/** Turn the AI's receipt into a bill draft in minor units. */
export function receiptToDraft(r: ScannedReceipt, fallbackCurrency: string): ReceiptDraft {
  const currency = r.currency && isCurrencyCode(r.currency.toUpperCase())
    ? r.currency.toUpperCase()
    : fallbackCurrency;
  const m = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? toMinor(Math.abs(v), currency) : 0);
  return {
    title: (r.merchant ?? '').trim() || 'Receipt',
    date: r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
    currency,
    items: r.items
      .filter((i) => i.name?.trim() || i.line_total)
      .map((i) => ({
        name: i.name.trim(),
        quantity: Number.isFinite(i.quantity) && i.quantity > 0 ? i.quantity : 1,
        lineTotalMinor: m(i.line_total),
      })),
    taxMinor: m(r.tax),
    serviceMinor: m(r.service_charge),
    tipMinor: m(r.tip),
    discountMinor: m(r.discount),
    totalMinor: typeof r.total === 'number' ? m(r.total) : null,
    notes: r.notes,
  };
}
