/**
 * Who paid and whose share it was, per person: two bars each, in the trip
 * currency. Neutral wording; nobody is ranked or called out for owing.
 */
import { View } from 'react-native';

import { formatMoney } from '@/lib/currency';
import { firstName } from '@/lib/format';
import { radius, space, useTheme } from '@/theme';
import { Avatar, Row, Stack, Text } from './ui';

export type SpendRow = { userId: string; name: string; url?: string | null; paid: number; share: number };

export function SpendingChart({ rows, currency, me }: { rows: SpendRow[]; currency: string; me: string }) {
  const t = useTheme();
  const max = Math.max(1, ...rows.flatMap((r) => [r.paid, r.share]));
  const bar = (value: number, color: string) => (
    <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: t.surfaceAlt, overflow: 'hidden' }}>
      <View style={{ width: `${(value / max) * 100}%`, height: 8, borderRadius: radius.pill, backgroundColor: color }} />
    </View>
  );
  return (
    <Stack gap={space.md}>
      <Row gap={space.md}>
        <Row gap={6}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.accent }} />
          <Text variant="caption" muted>Paid for the group</Text>
        </Row>
        <Row gap={6}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.coral }} />
          <Text variant="caption" muted>Their share</Text>
        </Row>
      </Row>
      {rows.map((r) => (
        <View
          key={r.userId}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
          accessible
          accessibilityLabel={`${r.userId === me ? 'You' : r.name}: paid ${formatMoney(r.paid, currency)}, share ${formatMoney(r.share, currency)}`}>
          <Avatar id={r.userId} name={r.name} url={r.url} size={32} />
          <View style={{ flex: 1, gap: 4 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="label">{r.userId === me ? 'You' : firstName(r.name)}</Text>
              <Text variant="caption" muted>
                {formatMoney(r.paid, currency)} / {formatMoney(r.share, currency)}
              </Text>
            </Row>
            {bar(r.paid, t.accent)}
            {bar(r.share, t.coral)}
          </View>
        </View>
      ))}
    </Stack>
  );
}
