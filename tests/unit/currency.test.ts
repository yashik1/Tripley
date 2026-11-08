import { describe, expect, it } from 'vitest';
import {
  convertMinor,
  fetchExchangeRate,
  formatMoney,
  fromMinor,
  minorToInput,
  minorUnitExponent,
  parseAmount,
  toMinor,
} from '../../src/lib/currency';

describe('minor units', () => {
  it('knows currency exponents', () => {
    expect(minorUnitExponent('USD')).toBe(2);
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(minorUnitExponent('KWD')).toBe(3);
    expect(minorUnitExponent('inr')).toBe(2);
  });
  it('converts without float noise', () => {
    expect(toMinor(1.005, 'USD')).toBe(101);
    expect(toMinor(0.1 + 0.2, 'USD')).toBe(30);
    expect(toMinor(1234, 'JPY')).toBe(1234);
    expect(toMinor(1.2345, 'KWD')).toBe(1235);
    expect(fromMinor(12345, 'USD')).toBe(123.45);
    expect(minorToInput(500, 'USD')).toBe('5.00');
    expect(minorToInput(500, 'JPY')).toBe('500');
  });
});

describe('parseAmount', () => {
  it.each([
    ['12.50', 'USD', 1250],
    ['12,5', 'EUR', 1250],
    ['1,234.56', 'USD', 123456],
    ['1.234,56', 'EUR', 123456],
    ['1,234', 'INR', 123400],
    ['₹ 450', 'INR', 45000],
    ['450', 'JPY', 450],
    ['1.234', 'KWD', 1234],
    ['0.005', 'USD', 1],
    ['.75', 'USD', 75],
    ['-3.20', 'USD', -320],
    ['1 234,50', 'EUR', 123450],
  ])('parses %s %s', (text, code, expected) => {
    expect(parseAmount(text, code)).toBe(expected);
  });
  it.each(['', 'abc', '-', '1,2,3'])('rejects %s', (text) => {
    expect(parseAmount(text, 'USD')).toBeNull();
  });
});

describe('formatMoney', () => {
  it('formats with currency symbols and decimals', () => {
    expect(formatMoney(123450, 'USD', 'en-US')).toBe('$1,234.50');
    expect(formatMoney(1500, 'JPY', 'en-US')).toBe('¥1,500');
    expect(formatMoney(1234, 'KWD', 'en-US')).toContain('1.234');
  });
});

describe('convertMinor', () => {
  it('converts across currencies with different exponents', () => {
    expect(convertMinor(10000, 'EUR', 'INR', 90.5)).toBe(905000);
    expect(convertMinor(10000, 'USD', 'JPY', 150)).toBe(15000);
    expect(convertMinor(15000, 'JPY', 'USD', 1 / 150)).toBe(10000);
    expect(convertMinor(500, 'USD', 'USD', 3)).toBe(500);
  });
});

describe('fetchExchangeRate', () => {
  it('reads the rate from the API response', async () => {
    const fakeFetch = (async (url: string) => {
      expect(url).toBe('https://api.frankfurter.dev/v1/2026-05-01?base=EUR&symbols=INR');
      return new Response(JSON.stringify({ rates: { INR: 95.12 } }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchExchangeRate('EUR', 'INR', '2026-05-01', fakeFetch)).toBe(95.12);
  });
  it('returns null on errors and 1 for the same currency', async () => {
    const failing = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchExchangeRate('EUR', 'XYZ', undefined, failing)).toBeNull();
    expect(await fetchExchangeRate('EUR', 'EUR')).toBe(1);
  });
});
