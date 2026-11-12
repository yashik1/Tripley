import { describe, expect, it } from 'vitest';

import { crc16, normalizePixKey, pixPayload, promptPayPayload, promptPayTarget } from '../../src/lib/emv-qr';
import { paymentOptions } from '../../src/lib/payment-links';

describe('EMV QR codes (Pix, PromptPay)', () => {
  it('uses CRC-16/CCITT-FALSE (the standard check value)', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('builds the Pix example from the Brazilian central bank’s manual', () => {
    expect(pixPayload({ key: '123e4567-e12b-12d1-a456-426655440000', name: 'Fulano de Tal', amount: null, city: 'BRASILIA' })).toBe(
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D',
    );
  });

  it('Pix keys: email lower-cased, phone with +, CPF digits; amounts included', () => {
    expect(normalizePixKey(' Maria@Example.com ')).toBe('maria@example.com');
    expect(normalizePixKey('+55 (11) 98765-4321')).toBe('+5511987654321');
    expect(normalizePixKey('123.456.789-09')).toBe('12345678909');
    const p = pixPayload({ key: 'maria@example.com', name: 'Mária São', amount: '42.50' });
    expect(p).toContain('540542.50');
    expect(p).toContain('5909Maria Sao');
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });

  it('PromptPay: Thai phone or national ID, with a valid checksum', () => {
    expect(promptPayTarget('081-234-5678')).toEqual({ tag: '01', value: '0066812345678' });
    expect(promptPayTarget('1234567890123')).toEqual({ tag: '02', value: '1234567890123' });
    expect(promptPayTarget('12345')).toBeNull();
    const p = promptPayPayload('0812345678', '150.00')!;
    expect(p.startsWith('000201010212293700')).toBe(true);
    expect(p).toContain('0113006681234567853037645406150.005802TH6304');
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
    expect(promptPayPayload('0812345678', null)!.startsWith('000201010211')).toBe(true);
  });

  it('shows up when settling: Pix first for reais, PromptPay first for baht', () => {
    const brl = paymentOptions({ pix: 'maria@example.com', paypal: 'maria' }, 'Maria', 4250, 'BRL', 'Dinner');
    expect(brl[0].kind).toBe('pix');
    expect(brl[0].prefillsAmount).toBe(true);
    expect(brl[0].copyText).toBe(brl[0].qr);
    const thb = paymentOptions({ promptpay: '0812345678', paypal: 'som' }, 'Som', 15000, 'THB', 'Taxi');
    expect(thb[0].kind).toBe('promptpay');
    expect(thb[0].qr).toContain('5406150.00');
    const eur = paymentOptions({ pix: 'maria@example.com' }, 'Maria', 4250, 'EUR', 'Dinner');
    expect(eur[0].prefillsAmount).toBe(false);
    expect(eur[0].qr).not.toContain('5405');
  });
});
