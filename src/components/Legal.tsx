import { Link, router } from 'expo-router';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';

import { contactBlocks, LEGAL_UPDATED, supportEmail, type LegalBlock, type LegalDoc } from '@/lib/legal';
import { space, useTheme } from '@/theme';
import { Card, Row, Screen, Stack, Text } from './ui';

function Block({ block }: { block: LegalBlock }) {
  const t = useTheme();
  if ('list' in block) {
    return (
      <Stack gap={space.xs}>
        {block.list.map((item) => (
          <Row key={item} gap={space.sm} style={{ alignItems: 'flex-start' }}>
            <Text color={t.textMuted} style={{ lineHeight: 24 }}>•</Text>
            <Text style={{ flex: 1, lineHeight: 24 }}>{item}</Text>
          </Row>
        ))}
      </Stack>
    );
  }
  return (
    <Text style={{ lineHeight: 24 }}>
      {block.lead ? <Text style={{ fontWeight: '700', lineHeight: 24 }}>{block.lead} </Text> : null}
      {block.text}
    </Text>
  );
}

/** A full Privacy Policy or Terms of Use page, readable signed in or out. */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  const t = useTheme();
  const email = supportEmail();
  // The browser tab (and links shared from app store listings) show the page's name.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const before = document.title;
    document.title = `${doc.title} · Tripley`;
    return () => {
      document.title = before;
    };
  }, [doc.title]);
  const other = doc.kind === 'privacy' ? { href: '/terms' as const, label: 'Terms of Use' } : { href: '/privacy' as const, label: 'Privacy Policy' };
  return (
    <Screen edges={['bottom']}>
      <View style={{ width: '100%', maxWidth: 760, alignSelf: 'center', gap: space.xl, paddingBottom: space.xl }} testID={`legal-${doc.kind}`}>
        <Stack gap={space.xs}>
          <Text variant="title" accessibilityRole="header">{doc.title}</Text>
          <Text variant="caption" muted>Last updated {LEGAL_UPDATED}</Text>
        </Stack>

        <Card style={{ backgroundColor: t.primarySoft, borderColor: t.primarySoft }}>
          <Text variant="heading">The short version</Text>
          <Block block={{ list: doc.summary }} />
        </Card>

        {doc.sections.map((s, i) => (
          <Stack key={s.id} gap={space.sm}>
            <Text variant="heading" accessibilityRole="header">{`${i + 1}. ${s.heading}`}</Text>
            {s.blocks.map((b, j) => (
              <Block key={j} block={b} />
            ))}
          </Stack>
        ))}

        <View style={{ gap: space.sm }} testID="legal-contact">
          <Text variant="heading" accessibilityRole="header">{`${doc.sections.length + 1}. Contact us`}</Text>
          {contactBlocks(email).map((b, j) => (
            <Block key={j} block={b} />
          ))}
        </View>

        <Row gap={space.lg} style={{ flexWrap: 'wrap' }}>
          <Link href={other.href} style={{ color: t.primary, fontWeight: '600' }} testID="legal-other">
            {`Read our ${other.label}`}
          </Link>
          <Text
            accessibilityRole="link"
            color={t.primary}
            style={{ fontWeight: '600' }}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
            Back to Tripley
          </Text>
        </Row>
      </View>
    </Screen>
  );
}

/** "Terms · Privacy" for page footers. */
export function LegalLinks({ center }: { center?: boolean }) {
  const t = useTheme();
  const style = { color: t.textMuted, fontSize: 13, textDecorationLine: 'underline' as const };
  return (
    <Row gap={space.md} style={center ? { justifyContent: 'center' } : undefined}>
      <Link href="/privacy" style={style} testID="link-privacy">Privacy Policy</Link>
      <Link href="/terms" style={style} testID="link-terms">Terms of Use</Link>
    </Row>
  );
}

/** "By continuing, you agree to …", under sign-up and sign-in buttons. */
export function AgreeNote({ action = 'continuing' }: { action?: string }) {
  const t = useTheme();
  const link = { color: t.primary, textDecorationLine: 'underline' as const };
  return (
    <Text variant="caption" faint center testID="agree-note">
      {`By ${action}, you agree to the `}
      <Link href="/terms" style={link}>Terms of Use</Link>
      {' and confirm you’ve read the '}
      <Link href="/privacy" style={link}>Privacy Policy</Link>.
    </Text>
  );
}
