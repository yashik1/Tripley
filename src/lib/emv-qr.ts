/**
 * EMVCo merchant-presented QR codes, the format behind Brazil's Pix and
 * Thailand's PromptPay: tag-length-value fields, ending with a CRC-16/CCITT
 * checksum over everything before it (including the "6304" tag itself).
 */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;
const withCrc = (body: string) => `${body}6304${crc16(`${body}6304`)}`;

/** Plain ASCII, as banking apps expect in names and cities. */
const ascii = (s: string, max: number) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .\-]/g, '')
    .trim()
    .slice(0, max);

/** A Pix key as the Pix system expects it: email, +55 phone, CPF/CNPJ digits, or a random key. */
export function normalizePixKey(raw: string | undefined): string {
  const k = (raw ?? '').trim();
  if (!k) return '';
  if (k.includes('@')) return k.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return k.toLowerCase();
  if (k.startsWith('+')) return `+${k.replace(/\D/g, '')}`;
  return k.replace(/\D/g, '');
}

/** A static Pix QR ("copia e cola" code) for paying `key`, with the amount when given (in reais). */
export function pixPayload({ key, name, amount, city = 'BRASIL' }: { key: string; name: string; amount: string | null; city?: string }): string {
  const account = tlv('00', 'br.gov.bcb.pix') + tlv('01', normalizePixKey(key));
  const body =
    tlv('00', '01') +
    tlv('26', account) +
    tlv('52', '0000') +
    tlv('53', '986') +
    (amount && Number(amount) > 0 ? tlv('54', amount) : '') +
    tlv('58', 'BR') +
    tlv('59', ascii(name, 25) || 'Tripley') +
    tlv('60', ascii(city, 15) || 'BRASIL') +
    tlv('62', tlv('05', '***'));
  return withCrc(body);
}

/** A Thai phone (0812345678) or 13-digit national ID as PromptPay expects it; null if neither. */
export function promptPayTarget(raw: string | undefined): { tag: '01' | '02'; value: string } | null {
  const d = (raw ?? '').replace(/\D/g, '');
  if (/^0\d{9}$/.test(d)) return { tag: '01', value: `0066${d.slice(1)}` };
  if (/^66\d{9}$/.test(d)) return { tag: '01', value: `00${d}` };
  if (/^\d{13}$/.test(d)) return { tag: '02', value: d };
  return null;
}

/** A PromptPay QR for paying `target`, with the amount when given (in baht). */
export function promptPayPayload(raw: string, amount: string | null): string | null {
  const target = promptPayTarget(raw);
  if (!target) return null;
  const withAmount = !!amount && Number(amount) > 0;
  const body =
    tlv('00', '01') +
    tlv('01', withAmount ? '12' : '11') +
    tlv('29', tlv('00', 'A000000677010111') + tlv(target.tag, target.value)) +
    tlv('53', '764') +
    (withAmount ? tlv('54', amount!) : '') +
    tlv('58', 'TH');
  return withCrc(body);
}
