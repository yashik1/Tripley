import { describe, expect, it } from 'vitest';
import { formatIban, isValidIban, normalizeHandles, paymentOptions, sepaQrPayload } from '../../src/lib/payment-links';
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
  it('offers PhonePe and Paytm for rupee payments, from the UPI ID', () => {
    const opts = paymentOptions({ upi: 'maya@ybl' }, 'Maya', 50000, 'INR', 'Goa');
    expect(opts.map((o) => o.kind)).toEqual(['upi', 'phonepe', 'paytm']);
    expect(opts[1].url).toBe('phonepe://pay?pa=maya%40ybl&pn=Maya&am=500.00&cu=INR&tn=Goa');
    expect(opts[2].url).toBe('paytmmp://pay?pa=maya%40ybl&pn=Maya&am=500.00&cu=INR&tn=Goa');
    expect(paymentOptions({ upi: 'maya@ybl' }, 'Maya', 500, 'USD', 'x').map((o) => o.kind)).toEqual(['upi']);
  });
  it('Zelle is copy-only; Monzo fills the amount in pounds', () => {
    const opts = paymentOptions({ zelle: 'sam@example.com', monzo: 'https://monzo.me/samp/12' }, 'Sam', 1234, 'GBP', 'Pub');
    const by = Object.fromEntries(opts.map((o) => [o.kind, o]));
    expect(by.zelle.url).toBeUndefined();
    expect(by.zelle.copyText).toBe('sam@example.com');
    expect(by.monzo.url).toBe('https://monzo.me/samp/12.34?d=Pub');
    expect(by.monzo.prefillsAmount).toBe(true);
  });
  it('puts the apps people use in the trip’s region first', () => {
    const handles = { paypal: 'p', venmo: 'v', zelle: 'z@x.com', revolut: 'r', monzo: 'm', iban: 'DE89 3704 0044 0532 0130 00', other: 'cash' };
    const kinds = (cur: string) => paymentOptions(handles, 'Ana', 1000, cur, 'n').map((o) => o.kind);
    expect(kinds('USD').slice(0, 3)).toEqual(['venmo', 'zelle', 'paypal']);
    expect(kinds('EUR').slice(0, 3)).toEqual(['sepa', 'revolut', 'paypal']);
    expect(kinds('GBP').slice(0, 2)).toEqual(['monzo', 'revolut']);
    expect(kinds('USD').at(-1)).toBe('other');
  });
  it('builds a SEPA QR code (EPC) for euro payments', () => {
    const [sepa] = paymentOptions({ iban: 'de89 3704 0044 0532 0130 00', iban_name: 'Ana Costa' }, 'Ana', 4250, 'EUR', 'Tripley: Lisbon');
    expect(sepa.kind).toBe('sepa');
    expect(sepa.copyText).toBe('DE89 3704 0044 0532 0130 00');
    expect(sepa.qr).toBe(['BCD', '002', '1', 'SCT', '', 'Ana Costa', 'DE89370400440532013000', 'EUR42.50', '', '', 'Tripley: Lisbon'].join('\n'));
    const [notEur] = paymentOptions({ iban: 'DE89370400440532013000' }, 'Ana', 4250, 'USD', 'x');
    expect(notEur.qr).toBeUndefined();
    expect(sepaQrPayload({ name: 'X'.repeat(80), iban: 'DE89370400440532013000', amountMinor: 0, note: '' }).split('\n')[5]).toHaveLength(70);
  });
  it('checks IBANs', () => {
    expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(isValidIban('DE88 3704 0044 0532 0130 00')).toBe(false);
    expect(isValidIban('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(isValidIban('hello')).toBe(false);
    expect(formatIban('gb82west12345698765432')).toBe('GB82 WEST 1234 5698 7654 32');
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
