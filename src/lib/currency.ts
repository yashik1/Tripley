/**
 * Money helpers. All amounts in Tripley are stored as integers in the currency's
 * minor unit (cents, paise, yen...) so that splits always add up exactly.
 */

// ISO 4217 currencies whose minor unit is not 2 decimals.
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG',
  'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export type CurrencyInfo = { code: string; name: string };

/** Currencies offered in pickers. Any valid ISO code still works everywhere else. */
export const COMMON_CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'IDR', name: 'Indonesian Rupiah' },
  { code: 'MYR', name: 'Malaysian Ringgit' },
  { code: 'VND', name: 'Vietnamese Dong' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'PLN', name: 'Polish Zloty' },
  { code: 'CZK', name: 'Czech Koruna' },
  { code: 'HUF', name: 'Hungarian Forint' },
  { code: 'LKR', name: 'Sri Lankan Rupee' },
  { code: 'NPR', name: 'Nepalese Rupee' },
  { code: 'PHP', name: 'Philippine Peso' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'QAR', name: 'Qatari Riyal' },
  { code: 'KWD', name: 'Kuwaiti Dinar' },
  { code: 'BHD', name: 'Bahraini Dinar' },
  { code: 'OMR', name: 'Omani Rial' },
  { code: 'EGP', name: 'Egyptian Pound' },
  { code: 'MAD', name: 'Moroccan Dirham' },
  { code: 'ISK', name: 'Icelandic Krona' },
];

export function isCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

/** Number of decimal places for the currency's minor unit (JPY 0, USD 2, KWD 3). */
export function minorUnitExponent(code: string): number {
  const c = code.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

export function fromMinor(minor: number, code: string): number {
  return minor / 10 ** minorUnitExponent(code);
}

/** Convert a major-unit number (e.g. 12.5) to minor units, rounding half away from zero. */
export function toMinor(major: number, code: string): number {
  const factor = 10 ** minorUnitExponent(code);
  const scaled = major * factor;
  // Guard against float noise like 1.005 * 100 = 100.49999999999999
  const rounded = Math.round(Math.abs(scaled) + 1e-9);
  return scaled < 0 ? -rounded : rounded;
}

/**
 * Parse what a person typed ("12.50", "12,5", "1,234.56", "1.234,56", "₹ 450")
 * into minor units. Returns null when it is not a valid amount.
 */
export function parseAmount(text: string, code: string): number | null {
  const exp = minorUnitExponent(code);
  let s = text.trim().replace(/[\s ']/g, '').replace(/[^\d.,-]/g, '');
  if (!s || s === '-' ) return null;
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let intPart = s;
  let fracPart = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const decIdx = Math.max(lastDot, lastComma);
    intPart = s.slice(0, decIdx).replace(/[.,]/g, '');
    fracPart = s.slice(decIdx + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    // "1,234" or "1.234.567" with 3-digit groups is a thousands separator,
    // unless the currency itself has 3 decimals and there is a single separator.
    const looksGrouped =
      /^[1-9]\d{0,2}$/.test(parts[0]) &&
      (parts.length > 2 || (tail.length === 3 && !(exp === 3 && parts.length === 2)));
    if (looksGrouped && parts.slice(1).every((p) => p.length === 3)) {
      intPart = parts.join('');
    } else if (parts.length === 2) {
      intPart = parts[0];
      fracPart = tail;
    } else {
      return null;
    }
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (intPart === '' && fracPart === '') return null;
  if (fracPart.length > exp) {
    // More decimals than the currency allows: round.
    const value = Number(`${intPart || '0'}.${fracPart}`);
    if (!Number.isFinite(value)) return null;
    const minor = toMinor(value, code);
    return negative ? -minor : minor;
  }
  const minor =
    Number(intPart || '0') * 10 ** exp + Number((fracPart || '').padEnd(exp, '0') || '0');
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

/** Format minor units for display, e.g. formatMoney(123450, 'INR') -> "₹1,234.50". */
export function formatMoney(minor: number, code: string, locale?: string): string {
  const exp = minorUnitExponent(code);
  const value = fromMinor(minor, code);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(value);
  } catch {
    return `${code} ${value.toFixed(exp)}`;
  }
}

/** Plain number string without currency symbol, suitable for an input field. */
export function minorToInput(minor: number, code: string): string {
  const exp = minorUnitExponent(code);
  return fromMinor(minor, code).toFixed(exp);
}

/**
 * Convert an amount between currencies with a rate expressed as
 * "1 unit of `from` = rate units of `to`".
 */
export function convertMinor(minor: number, from: string, to: string, rate: number): number {
  if (from === to) return minor;
  const shift = minorUnitExponent(to) - minorUnitExponent(from);
  const value = minor * rate * 10 ** shift;
  const rounded = Math.round(Math.abs(value) + 1e-9);
  return value < 0 ? -rounded : rounded;
}

/**
 * Fetch a historical exchange rate (ECB data via Frankfurter, free, no key).
 * Returns null if the pair is not covered; the UI then asks for a manual rate.
 */
export async function fetchExchangeRate(
  from: string,
  to: string,
  date?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  if (from === to) return 1;
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : 'latest';
  const url = `https://api.frankfurter.dev/v1/${day}?base=${from}&symbols=${to}`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const json = (await res.json()) as { rates?: Record<string, number> };
    const rate = json.rates?.[to];
    return typeof rate === 'number' && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}
