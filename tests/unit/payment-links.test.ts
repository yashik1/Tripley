import { describe, expect, it } from 'vitest';
import { normalizeHandles, paymentOptions } from '../../src/lib/payment-links';
import { receiptToDraft } from '../../src/lib/receipt';

describe('paymentOptions', () => {
  it('builds a UPI link with amount for INR', () => {
    const [upi] = paymentOptions({ upi: 'maya@okhdfc' }, 'Maya', 124050, 'INR', 'Goa trip');
    expect(upi.url).toBe('upi://pay?pa=maya%40okhdfc&pn=Maya&am=1240.50&cu=INR&tn=Goa%20trip');
    expect(upi.prefillsAmount).toBe(true);
  });
  it('does not prefill UPI amounts in other currencies', () => {
    const [upi] = paymentOptions({ upi: 'maya@okhdfc' }, 'Maya', 1000, 'EUR', 'x');
    expect(upi.url).not.toContain('am=');
    expect(upi.prefillsAmount).toBe(false);
  });
  it('cleans pasted handles and builds links', () => {
    const opts = paymentOptions(
      { venmo: '@sam-p', paypal: 'https://paypal.me/samp', cashapp: '$samp', revolut: 'revolut.me/samp', other: 'IBAN DE00 1234' },
      'Sam',
      2550,
      'USD',
      'Dinner',
    );
    const by = Object.fromEntries(opts.map((o) => [o.kind, o]));
    expect(by.venmo.url).toBe('https://venmo.com/sam-p?txn=pay&amount=25.50&note=Dinner');
    expect(by.paypal.url).toBe('https://paypal.me/samp/25.50USD');
    expect(by.cashapp.url).toBe('https://cash.app/$samp/25.50');
    expect(by.revolut.url).toBe('https://revolut.me/samp');
    expect(by.other.url).toBeUndefined();
    expect(by.other.copyText).toBe('IBAN DE00 1234');
  });
  it('returns nothing without handles', () => {
    expect(paymentOptions(null, 'X', 100, 'USD', '')).toEqual([]);
    expect(normalizeHandles({ upi: '  ', venmo: ' sam ' })).toEqual({ venmo: 'sam' });
  });
});

describe('receiptToDraft', () => {
  it('converts AI output into minor units', () => {
    const d = receiptToDraft(
      {
        merchant: ' Cafe Mondegar ',
        date: '2026-11-02',
        currency: 'inr',
        items: [
          { name: 'Masala chai', quantity: 2, line_total: 180 },
          { name: 'Club sandwich', quantity: 1, line_total: 349.5 },
        ],
        subtotal: 529.5,
        tax: 26.48,
        service_charge: null,
        tip: 50,
        discount: null,
        total: 605.98,
        notes: null,
      },
      'USD',
    );
    expect(d.title).toBe('Cafe Mondegar');
    expect(d.currency).toBe('INR');
    expect(d.items.map((i) => i.lineTotalMinor)).toEqual([18000, 34950]);
    expect(d.taxMinor).toBe(2648);
    expect(d.tipMinor).toBe(5000);
    expect(d.totalMinor).toBe(60598);
  });
  it('falls back to the trip currency when the receipt currency is unknown', () => {
    const d = receiptToDraft(
      { merchant: null, date: 'yesterday', currency: null, items: [], subtotal: null, tax: null, service_charge: null, tip: null, discount: null, total: null, notes: null },
      'EUR',
    );
    expect(d.currency).toBe('EUR');
    expect(d.date).toBeNull();
    expect(d.title).toBe('Receipt');
  });
});
