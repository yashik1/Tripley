import { fromMinor, minorUnitExponent } from './currency';
import { normalizePixKey, pixPayload, promptPayPayload } from './emv-qr';

/** Payment handles a person saves on their profile. All optional. */
export type PaymentHandles = {
  upi?: string; // e.g. name@okhdfcbank (also used for PhonePe and Paytm)
  venmo?: string; // username
  zelle?: string; // email or US phone number registered with Zelle
  paypal?: string; // paypal.me username
  revolut?: string; // revtag
  monzo?: string; // monzo.me username
  cashapp?: string; // $cashtag
  wise?: string; // wise.com/pay/me/<handle>
  iban?: string; // for SEPA transfers (EUR)
  iban_name?: string; // account holder name for the IBAN
  pix?: string; // Brazil: Pix key (email, +55 phone, CPF/CNPJ or random key)
  promptpay?: string; // Thailand: phone number or 13-digit national ID
  other?: string; // free text, e.g. bank details
};

export type PaymentKind = Exclude<keyof PaymentHandles, 'iban_name'> | 'phonepe' | 'paytm' | 'sepa';

export type PaymentOption = {
  kind: PaymentKind;
  label: string;
  /** Link that opens the payment app/site. Absent for copy-only options. */
  url?: string;
  /** Text to copy (handle or details). */
  copyText: string;
  /** True when the link (or QR code) pre-fills the amount. */
  prefillsAmount: boolean;
  /** Text for a QR code the payer scans with their banking app (SEPA, Pix, PromptPay). */
  qr?: string;
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
    const query = inr
      ? `pa=${enc(upi)}&pn=${enc(payeeName)}&am=${amount}&cu=INR&tn=${enc(note)}`
      : `pa=${enc(upi)}&pn=${enc(payeeName)}&tn=${enc(note)}`;
    out.push({ kind: 'upi', label: 'UPI (GPay, BHIM, any UPI app)', url: `upi://pay?${query}`, copyText: upi, prefillsAmount: inr });
    if (inr) {
      // Same UPI request, opened straight in a specific app.
      out.push({ kind: 'phonepe', label: 'PhonePe', url: `phonepe://pay?${query}`, copyText: upi, prefillsAmount: true });
      out.push({ kind: 'paytm', label: 'Paytm', url: `paytmmp://pay?${query}`, copyText: upi, prefillsAmount: true });
    }
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

  const zelle = (handles.zelle ?? '').trim();
  if (zelle) {
    // Zelle has no public pay link; people send from their bank's app.
    out.push({ kind: 'zelle', label: 'Zelle (in your bank app)', copyText: zelle, prefillsAmount: false });
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

  const monzo = clean(handles.monzo, /^(https?:\/\/)?(www\.)?(monzo\.me\/)?@?/i).replace(/\/.*$/, '');
  if (monzo) {
    const gbp = currency === 'GBP';
    out.push({
      kind: 'monzo',
      label: 'Monzo',
      url: gbp ? `https://monzo.me/${enc(monzo)}/${amount}?d=${enc(note)}` : `https://monzo.me/${enc(monzo)}`,
      copyText: `monzo.me/${monzo}`,
      prefillsAmount: gbp,
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

  const iban = normalizeIban(handles.iban);
  if (iban) {
    const name = (handles.iban_name ?? payeeName).trim() || payeeName;
    const eur = currency === 'EUR';
    out.push({
      kind: 'sepa',
      label: eur ? 'Bank transfer (SEPA)' : 'Bank transfer (IBAN)',
      copyText: formatIban(iban),
      prefillsAmount: eur,
      qr: eur ? sepaQrPayload({ name, iban, amountMinor, note }) : undefined,
    });
  }

  const pix = normalizePixKey(handles.pix);
  if (pix) {
    const brl = currency === 'BRL';
    const code = pixPayload({ key: pix, name: payeeName, amount: brl ? amount : null });
    // The "copia e cola" code is what people paste into their bank app.
    out.push({ kind: 'pix', label: 'Pix', copyText: code, prefillsAmount: brl, qr: code });
  }

  const thb = currency === 'THB';
  const promptpay = promptPayPayload(handles.promptpay ?? '', thb ? amount : null);
  if (promptpay) {
    out.push({ kind: 'promptpay', label: 'PromptPay', copyText: (handles.promptpay ?? '').trim(), prefillsAmount: thb, qr: promptpay });
  }

  const other = (handles.other ?? '').trim();
  if (other) {
    out.push({ kind: 'other', label: 'Other details', copyText: other, prefillsAmount: false });
  }

  return sortForRegion(out, currency);
}

/** Which payment apps people use most, by the trip's currency. */
const REGION_ORDER: Record<string, PaymentKind[]> = {
  INR: ['upi', 'phonepe', 'paytm'],
  USD: ['venmo', 'zelle', 'cashapp', 'paypal'],
  EUR: ['sepa', 'revolut', 'wise', 'paypal'],
  GBP: ['monzo', 'revolut', 'wise', 'paypal'],
  BRL: ['pix', 'paypal'],
  THB: ['promptpay', 'wise'],
};

export function sortForRegion(options: PaymentOption[], currency: string): PaymentOption[] {
  const order = REGION_ORDER[currency] ?? [];
  const rank = (o: PaymentOption) => {
    const i = order.indexOf(o.kind);
    if (i >= 0) return i;
    return o.kind === 'other' ? 1000 : 100;
  };
  // Stable: keeps the original order within the same rank.
  return options.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).map((x) => x.o);
}

export function normalizeIban(raw: string | undefined): string {
  return (raw ?? '').replace(/\s+/g, '').toUpperCase();
}

export function formatIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})/g, '$1 ').trim();
}

/** IBAN check digits (ISO 13616 mod 97). */
export function isValidIban(raw: string | undefined): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/**
 * EPC QR code ("GiroCode"/"SEPA QR") for a euro credit transfer. European
 * banking apps scan it and fill in the name, IBAN, amount and reference.
 */
export function sepaQrPayload({ name, iban, amountMinor, note }: { name: string; iban: string; amountMinor: number; note: string }): string {
  const amount = amountMinor > 0 ? `EUR${(amountMinor / 100).toFixed(2)}` : '';
  return [
    'BCD', // service tag
    '002', // version
    '1', // UTF-8
    'SCT', // SEPA credit transfer
    '', // BIC (optional within the EEA)
    name.slice(0, 70),
    normalizeIban(iban),
    amount,
    '', // purpose
    '', // structured reference
    note.slice(0, 140),
  ].join('\n');
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
