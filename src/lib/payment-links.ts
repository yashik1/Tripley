import { fromMinor, minorUnitExponent } from './currency';

/** Payment handles a person saves on their profile. All optional. */
export type PaymentHandles = {
  upi?: string; // e.g. name@okhdfcbank
  venmo?: string; // username
  paypal?: string; // paypal.me username
  revolut?: string; // revtag
  cashapp?: string; // $cashtag
  wise?: string; // wise.com/pay/me/<handle>
  other?: string; // free text, e.g. bank details
};

export type PaymentOption = {
  kind: keyof PaymentHandles;
  label: string;
  /** Link that opens the payment app/site. Absent for copy-only options. */
  url?: string;
  /** Text to copy (handle or details). */
  copyText: string;
  /** True when the link pre-fills the amount. */
  prefillsAmount: boolean;
};

const clean = (s: string | undefined, strip: RegExp) => (s ?? '').trim().replace(strip, '');

function amountString(minor: number, currency: string): string {
  return fromMinor(minor, currency).toFixed(minorUnitExponent(currency));
}

/**
 * Build "Pay" options for paying `payeeName` `amountMinor` in `currency`,
 * from the payee's saved handles.
 */
export function paymentOptions(
  handles: PaymentHandles | null | undefined,
  payeeName: string,
  amountMinor: number,
  currency: string,
  note: string,
): PaymentOption[] {
  if (!handles) return [];
  const out: PaymentOption[] = [];
  const amount = amountString(amountMinor, currency);
  const enc = encodeURIComponent;

  const upi = clean(handles.upi, /^upi:\/\//i);
  if (upi) {
    const inr = currency === 'INR';
    out.push({
      kind: 'upi',
      label: 'UPI (GPay, PhonePe, Paytm…)',
      url: inr
        ? `upi://pay?pa=${enc(upi)}&pn=${enc(payeeName)}&am=${amount}&cu=INR&tn=${enc(note)}`
        : `upi://pay?pa=${enc(upi)}&pn=${enc(payeeName)}&tn=${enc(note)}`,
      copyText: upi,
      prefillsAmount: inr,
    });
  }

  const venmo = clean(handles.venmo, /^(https?:\/\/)?(www\.)?(venmo\.com\/(u\/)?)?@?/i);
  if (venmo) {
    const usd = currency === 'USD';
    out.push({
      kind: 'venmo',
      label: 'Venmo',
      url: usd
        ? `https://venmo.com/${enc(venmo)}?txn=pay&amount=${amount}&note=${enc(note)}`
        : `https://venmo.com/${enc(venmo)}`,
      copyText: `@${venmo}`,
      prefillsAmount: usd,
    });
  }

  const paypal = clean(handles.paypal, /^(https?:\/\/)?(www\.)?(paypal\.me\/)?@?/i);
  if (paypal) {
    out.push({
      kind: 'paypal',
      label: 'PayPal',
      url: `https://paypal.me/${enc(paypal)}/${amount}${currency}`,
      copyText: `paypal.me/${paypal}`,
      prefillsAmount: true,
    });
  }

  const revolut = clean(handles.revolut, /^(https?:\/\/)?(www\.)?(revolut\.me\/)?@?/i);
  if (revolut) {
    out.push({
      kind: 'revolut',
      label: 'Revolut',
      url: `https://revolut.me/${enc(revolut)}`,
      copyText: `@${revolut}`,
      prefillsAmount: false,
    });
  }

  const cashapp = clean(handles.cashapp, /^(https?:\/\/)?(www\.)?(cash\.app\/)?\$?/i);
  if (cashapp) {
    const supported = currency === 'USD' || currency === 'GBP';
    out.push({
      kind: 'cashapp',
      label: 'Cash App',
      url: supported ? `https://cash.app/$${enc(cashapp)}/${amount}` : `https://cash.app/$${enc(cashapp)}`,
      copyText: `$${cashapp}`,
      prefillsAmount: supported,
    });
  }

  const wise = clean(handles.wise, /^(https?:\/\/)?(www\.)?(wise\.com\/pay\/me\/)?@?/i);
  if (wise) {
    out.push({
      kind: 'wise',
      label: 'Wise',
      url: `https://wise.com/pay/me/${enc(wise)}`,
      copyText: wise,
      prefillsAmount: false,
    });
  }

  const other = (handles.other ?? '').trim();
  if (other) {
    out.push({ kind: 'other', label: 'Other details', copyText: other, prefillsAmount: false });
  }

  return out;
}

/** Normalise handles from a profile form: trim and drop empty values. */
export function normalizeHandles(h: PaymentHandles): PaymentHandles {
  const out: PaymentHandles = {};
  for (const [k, v] of Object.entries(h) as [keyof PaymentHandles, string | undefined][]) {
    const t = (v ?? '').trim();
    if (t) out[k] = t;
  }
  return out;
}
