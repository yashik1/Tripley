import { z } from 'zod';

// Keep in sync with src/lib/receipt.ts (ScannedReceipt).
export const ReceiptSchema = z.object({
  merchant: z.string().nullable(),
  date: z.string().nullable(),
  currency: z.string().nullable(),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      line_total: z.number(),
    }),
  ),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  service_charge: z.number().nullable(),
  tip: z.number().nullable(),
  discount: z.number().nullable(),
  total: z.number().nullable(),
  notes: z.string().nullable(),
});

export type Receipt = z.infer<typeof ReceiptSchema>;

const nullable = (type: 'string' | 'number') => ({ anyOf: [{ type }, { type: 'null' }] });

/** JSON Schema given to Claude's structured output (all fields required, no extras). */
export const receiptJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'merchant', 'date', 'currency', 'items', 'subtotal', 'tax',
    'service_charge', 'tip', 'discount', 'total', 'notes',
  ],
  properties: {
    merchant: { ...nullable('string'), description: 'Business name as printed' },
    date: { ...nullable('string'), description: 'Date of the bill as YYYY-MM-DD' },
    currency: { ...nullable('string'), description: 'ISO 4217 code, e.g. INR, EUR, USD' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'quantity', 'line_total'],
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number' },
          line_total: { type: 'number', description: 'Amount charged for this line (quantity x unit price)' },
        },
      },
    },
    subtotal: nullable('number'),
    tax: { ...nullable('number'), description: 'Taxes added on top of item prices only' },
    service_charge: nullable('number'),
    tip: nullable('number'),
    discount: { ...nullable('number'), description: 'Total discounts as a positive number' },
    total: { ...nullable('number'), description: 'Final amount paid' },
    notes: { ...nullable('string'), description: 'Anything unclear, else null' },
  },
} as const;

export const RECEIPT_PROMPT = `You read photos of receipts and bills for a group trip expense-splitting app. Friends will assign each line item to the people who had it, so accuracy of the items and amounts matters most.

Extract:
- items: one entry per purchased line, in the order printed. quantity as printed (1 if not shown). line_total is the amount charged for that line (quantity x unit price) as a positive number in the receipt's currency, without currency symbols or thousands separators. Translate nothing; keep item names as printed but fix obvious OCR noise.
- Do not list subtotal, tax, service charge, tip, discount, total, change, or payment-method lines as items.
- tax: the sum of taxes (sales tax, VAT, GST, CGST + SGST, etc.) only when they are added on top of the item prices. If prices already include tax and the receipt just states the included amount, set tax to null so it isn't counted twice.
- service_charge: a service charge added on top, else null. tip: a tip or gratuity added, else null.
- discount: total of all discounts as a positive number, else null.
- total: the final amount paid. subtotal: the printed subtotal, else null.
- currency: ISO 4217 code inferred from symbols, language and address. If the symbol is ambiguous (e.g. "$" or "Rs"), use the address/language to decide; use the hint below only if nothing on the receipt settles it.
- date: YYYY-MM-DD if printed, else null. merchant: the business name, else null.
- notes: one short sentence about anything you could not read or are unsure about, else null.

If the image is not a receipt or bill, return an empty items list and say so in notes.`;
