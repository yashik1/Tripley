/**
 * Public page: why a group would use Tripley instead of a group chat, a shared
 * spreadsheet and a handful of separate apps. About Tripley only; no claims
 * about other products.
 */
import { Link, Stack as RouterStack } from 'expo-router';
import { View } from 'react-native';

import { Card, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { space, useTheme } from '@/theme';

const ROWS: { job: string; usual: string; tripley: string }[] = [
  { job: 'Deciding what to do', usual: 'Long chat threads and “thumbs up if…”', tripley: 'Bucket list with votes, polls (single, multiple or ranked), the winner into the plan in two taps' },
  { job: 'Picking dates', usual: 'Everyone lists their free days in the chat', tripley: 'Tap the days you can go; the best stretches show who can make them' },
  { job: 'The plan', usual: 'A doc nobody keeps up to date', tripley: 'A shared day-by-day plan with RSVPs, clash warnings, the best walking order and directions' },
  { job: 'Bookings', usual: 'Screenshots scattered across chats and inboxes', tripley: 'Flights, stays and tickets in one place, with codes and files you can open offline' },
  { job: 'Where everyone is', usual: '“Where are you?” texts', tripley: 'A live map while the trip is on, a finder arrow, arrival alerts; sharing stops when the trip ends' },
  { job: 'Rooms', usual: 'Arguing over the big bedroom', tripley: 'Everyone picks a bed; split the stay by room size' },
  { job: 'Money', usual: 'A spreadsheet at the end, and awkward reminders', tripley: 'Bills split by who had what, any currency, a cash kitty, pay links (UPI, Venmo, Pix, SEPA QR and more) and gentle reminders' },
];

export default function WhyTripley() {
  const t = useTheme();
  return (
    <Screen>
      <RouterStack.Screen options={{ title: 'Why Tripley' }} />
      <Stack gap={space.xs}>
        <Text variant="title">One app for the whole group trip</Text>
        <Text muted>
          Most group trips run on a chat, a spreadsheet and a few separate apps for maps, money and bookings. Tripley puts the decisions, the plan, the map and the money in one shared place, free for the group.
        </Text>
      </Stack>
      <SectionTitle>Instead of…</SectionTitle>
      {ROWS.map((r) => (
        <Card key={r.job}>
          <Text variant="heading">{r.job}</Text>
          <View style={{ gap: 2 }}>
            <Text variant="caption" muted>{`Usually: ${r.usual}`}</Text>
            <Text color={t.text}>{`With Tripley: ${r.tripley}`}</Text>
          </View>
        </Card>
      ))}
      <SectionTitle>What it costs</SectionTitle>
      <Text muted>
        Everything above is free. Tripley Pro adds AI helpers: reading receipts and booking confirmations, and drafting a plan from your bucket list. Invite a friend and you both get a month of Pro.
      </Text>
      <Stack gap={space.xs}>
        <Link href="/sign-up">
          <Text color={t.primary} style={{ fontWeight: '700' }}>Start a trip</Text>
        </Link>
        <Link href="/privacy">
          <Text color={t.primary}>How we handle your data</Text>
        </Link>
      </Stack>
    </Screen>
  );
}
