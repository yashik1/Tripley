import { router } from 'expo-router';
import { useRef, type ComponentRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { hasAuth } from '@/lib/auth-methods';
import { useAuth } from '@/providers/AuthProvider';
import { radius, space, useTheme } from '@/theme';
import { Brand } from './AuthLayout';
import { Icon, type IconName } from './Icon';
import { Button, Row, Stack, Text } from './ui';

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'location',
    title: 'Live map of your group',
    body: 'See everyone on one map while the trip is on. Pause anytime. Sharing stops by itself when the trip ends.',
  },
  {
    icon: 'link',
    title: 'Invite with a link',
    body: 'Share a link or QR code on WhatsApp or text. Friends join in seconds, or accept an invite in the app.',
  },
  {
    icon: 'bills',
    title: 'Split bills item by item',
    body: 'Whoever paid adds the bill and taps who had what. Tax, tip and discounts are shared out fairly.',
  },
  {
    icon: 'balances',
    title: 'Settle up in a tap',
    body: 'See exactly who owes whom. Pay with UPI, Venmo, PayPal, Revolut and more, then mark it paid.',
  },
  {
    icon: 'refresh',
    title: 'Any currency',
    body: 'Add bills in the local currency. Balances stay in your trip’s currency, converted for you.',
  },
  {
    icon: 'sparkles',
    title: 'Receipts read for you',
    body: 'With Tripley Pro, snap a receipt and the items, prices, tax and tip are filled in.',
  },
];

const STEPS = [
  { title: 'Create a trip', body: 'Name it and pick the currency.' },
  { title: 'Invite friends', body: 'Send the link. They’re on the map once they join.' },
  { title: 'Add bills as you go', body: 'Tap who had what. Tripley does the maths.' },
  { title: 'Settle up', body: 'Everyone sees what they owe and marks it paid.' },
];

function Section({ children, alt }: { children: ReactNode; alt?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: alt ? t.surface : t.bg, paddingVertical: 56, paddingHorizontal: space.lg }}>
      <View style={styles.container}>{children}</View>
    </View>
  );
}

/** A small picture of the app: friends on a map and a bill split. Built from views, so it's crisp everywhere. */
function Preview() {
  const t = useTheme();
  const road = t.scheme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.85)';
  const pins = [
    { id: 'maya', name: 'MR', x: '22%', y: '30%', color: '#0E7C66' },
    { id: 'sam', name: 'SK', x: '58%', y: '20%', color: '#3B6FD8' },
    { id: 'lee', name: 'LT', x: '70%', y: '58%', color: '#C2410C' },
    { id: 'priya', name: 'PS', x: '36%', y: '64%', color: '#8B5CF6' },
  ] as const;
  return (
    <View style={{ width: '100%', maxWidth: 440, alignSelf: 'center' }}>
      <View
        style={{
          height: 300,
          borderRadius: 24,
          overflow: 'hidden',
          backgroundColor: t.scheme === 'dark' ? '#1C2A26' : '#E4F1EA',
          borderWidth: 1,
          borderColor: t.border,
        }}>
        {/* roads and a park */}
        <View style={[styles.road, { backgroundColor: road, top: '42%', left: -20, right: -20, transform: [{ rotate: '-8deg' }] }]} />
        <View style={[styles.roadV, { backgroundColor: road, left: '46%', transform: [{ rotate: '12deg' }] }]} />
        <View style={[styles.road, { backgroundColor: road, top: '78%', left: -20, right: -20, height: 8, transform: [{ rotate: '4deg' }] }]} />
        <View style={{ position: 'absolute', left: '62%', top: '8%', width: 90, height: 60, borderRadius: 18, backgroundColor: t.scheme === 'dark' ? '#23402F' : '#C9E6CF' }} />
        <View style={{ position: 'absolute', left: '6%', top: '70%', width: 110, height: 70, borderRadius: 30, backgroundColor: t.scheme === 'dark' ? '#1B3341' : '#CFE4F4' }} />
        {pins.map((p) => (
          <View key={p.id} style={{ position: 'absolute', left: p.x, top: p.y, alignItems: 'center' }}>
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: p.color,
                borderWidth: 3,
                borderColor: '#fff',
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: '#000',
                shadowOpacity: 0.25,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 2 },
              }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{p.name}</Text>
            </View>
          </View>
        ))}
      </View>
      <View
        style={{
          marginTop: -48,
          marginHorizontal: space.lg,
          backgroundColor: t.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: t.border,
          padding: space.lg,
          gap: space.sm,
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
        }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="label">Dinner at the beach shack</Text>
          <Text variant="label">₹4,200</Text>
        </Row>
        <Text variant="caption" muted>Pizza: Maya, Sam, Lee, Priya · Beer: Sam · Tax shared</Text>
        <Row style={{ justifyContent: 'space-between', marginTop: space.xs }}>
          <Text variant="caption" muted>Sam owes Maya</Text>
          <Text variant="money" color={t.primary}>₹1,636.36</Text>
        </Row>
      </View>
    </View>
  );
}

/** The public home page. Signed-in visitors get "My trips" instead of sign up / log in. */
export function Landing() {
  const t = useTheme();
  const { session } = useAuth();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const cols = width >= 900 ? 3 : width >= 600 ? 2 : 1;
  const signedIn = !!session;
  const accounts = hasAuth('password');
  const signUp = () => router.push(accounts ? '/sign-up' : '/sign-in');
  const logIn = () => router.push('/sign-in');
  // Back to the trips page underneath if we came from it, else open it.
  const myTrips = () => router.dismissTo('/');

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView ref={scroll} contentContainerStyle={{ flexGrow: 1 }}>
        {/* Top bar */}
        <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border, backgroundColor: t.surface }}>
          <Row style={[styles.container, { justifyContent: 'space-between' }]}>
            <Brand onPress={() => scroll.current?.scrollTo({ y: 0, animated: true })} />
            {signedIn ? (
              <Button title="My trips" icon="trip" small onPress={myTrips} testID="nav-trips" />
            ) : (
              <Row gap={space.sm}>
                <Button title="Log in" kind="ghost" small onPress={logIn} testID="nav-login" />
                {accounts ? <Button title="Sign up" small onPress={signUp} testID="nav-signup" /> : null}
              </Row>
            )}
          </Row>
        </View>

        {/* Hero */}
        <Section>
          <View style={{ flexDirection: wide ? 'row' : 'column', gap: wide ? 56 : 40, alignItems: 'center' }}>
            <Stack gap={space.lg} style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%' }}>
              <View style={{ alignSelf: 'flex-start', backgroundColor: t.primarySoft, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 }}>
                <Text variant="caption" color={t.primary} style={{ fontWeight: '700' }}>For group trips</Text>
              </View>
              <Text style={{ fontSize: wide ? 52 : 36, lineHeight: wide ? 58 : 42, fontWeight: '800', letterSpacing: -1 }}>
                Know where everyone is. Split every bill fairly.
              </Text>
              <Text muted style={{ fontSize: 18, lineHeight: 27 }}>
                Tripley keeps your group together: a live map of your friends while the trip is on, and bills split by
                who had what, so nobody does the maths or chases payments.
              </Text>
              {signedIn ? (
                <Row gap={space.md} style={{ flexWrap: 'wrap' }}>
                  <Button title="Go to my trips" onPress={myTrips} testID="hero-trips" style={{ paddingHorizontal: space.xl }} />
                  <Button title="Start a new trip" kind="secondary" onPress={() => router.push('/trips/new')} style={{ paddingHorizontal: space.xl }} />
                </Row>
              ) : (
                <Row gap={space.md} style={{ flexWrap: 'wrap' }}>
                  <Button title={accounts ? 'Create a free account' : 'Get started'} onPress={signUp} testID="hero-signup" style={{ paddingHorizontal: space.xl }} />
                  {accounts ? <Button title="Log in" kind="secondary" onPress={logIn} testID="hero-login" style={{ paddingHorizontal: space.xl }} /> : null}
                </Row>
              )}
              <Text variant="caption" faint>Free to use. Works in any browser. No card needed.</Text>
            </Stack>
            <View style={{ flex: wide ? 1 : undefined, width: '100%' }}>
              <Preview />
            </View>
          </View>
        </Section>

        {/* Features */}
        <Section alt>
          <Stack gap={space.sm} style={{ marginBottom: space.xl }}>
            <Text variant="title" style={{ fontSize: 32 }}>Everything a group trip needs</Text>
            <Text muted style={{ fontSize: 17 }}>No more “where are you?” texts, and no spreadsheet at the end.</Text>
          </Stack>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.sm }}>
            {FEATURES.map((f) => (
              <View key={f.title} style={{ width: `${100 / cols}%`, padding: space.sm }}>
                <View style={{ flex: 1, backgroundColor: t.bg, borderRadius: radius.lg, padding: space.xl, gap: space.md, borderWidth: 1, borderColor: t.border }}>
                  <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={f.icon} size={22} color={t.primary} />
                  </View>
                  <Text variant="heading">{f.title}</Text>
                  <Text muted>{f.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </Section>

        {/* How it works */}
        <Section>
          <Text variant="title" style={{ fontSize: 32, marginBottom: space.xl }}>How it works</Text>
          <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.lg }}>
            {STEPS.map((s, i) => (
              <Row key={s.title} gap={space.md} style={{ flex: wide ? 1 : undefined, alignItems: 'flex-start' }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: t.primaryText, fontWeight: '800' }}>{i + 1}</Text>
                </View>
                <Stack gap={4} style={{ flex: 1 }}>
                  <Text variant="heading">{s.title}</Text>
                  <Text muted>{s.body}</Text>
                </Stack>
              </Row>
            ))}
          </View>
        </Section>

        {/* Closing call to action */}
        <Section alt>
          <View style={{ alignItems: 'center', gap: space.lg }}>
            <Text variant="title" center style={{ fontSize: 32 }}>Ready for your next trip?</Text>
            {signedIn ? (
              <Button title="Go to my trips" onPress={myTrips} style={{ paddingHorizontal: space.xl }} />
            ) : (
              <>
                <Text muted center style={{ fontSize: 17, maxWidth: 560 }}>
                  Make an account to keep your trips, bills and balances safe, and log in from your phone or laptop.
                </Text>
                <Row gap={space.md} style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                  <Button title={accounts ? 'Sign up free' : 'Get started'} onPress={signUp} testID="footer-signup" style={{ paddingHorizontal: space.xl }} />
                  {accounts ? <Button title="I have an account" kind="secondary" onPress={logIn} style={{ paddingHorizontal: space.xl }} /> : null}
                </Row>
              </>
            )}
          </View>
        </Section>

        <View style={{ paddingVertical: space.xl, paddingHorizontal: space.lg }}>
          <Stack gap={space.xs} style={styles.container}>
            <Text variant="caption" faint>
              Your location is shared only with people on your trips, only while the trip is on. You can pause anytime.
            </Text>
            <Text variant="caption" faint>© {new Date().getFullYear()} Tripley</Text>
          </Stack>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 1100, alignSelf: 'center' },
  road: { position: 'absolute', height: 12, borderRadius: 6 },
  roadV: { position: 'absolute', top: -20, bottom: -20, width: 14, borderRadius: 7 },
});
