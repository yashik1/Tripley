import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import { Icon } from '@/components/Icon';
import { LegalLinks } from '@/components/Legal';
import { Banner, Button, Card, Row, Screen, Stack, Text } from '@/components/ui';
import { isPro } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { keys, useAccount } from '@/lib/queries';
import { useAuth } from '@/providers/AuthProvider';
import { buyPackage, getProPackages, manageSubscriptionUrl, purchasesAvailable, restorePurchases, setupPurchases } from '@/purchases/purchases';
import { space, useTheme } from '@/theme';

const FEATURES = [
  'Snap a receipt and Tripley reads every item, price, tax and tip',
  'Works with receipts in most languages and currencies',
  'Just tap who had what. No typing.',
  'Up to 60 receipts a month',
];

export default function Pro() {
  const t = useTheme();
  const qc = useQueryClient();
  const { user } = useAuth();
  const account = useAccount();
  const pro = isPro(account.data);
  const available = purchasesAvailable();
  const packages = useQuery({
    queryKey: ['pro-packages', user?.id],
    queryFn: async () => {
      await setupPurchases(user!.id);
      return getProPackages();
    },
    enabled: available && !!user && !pro,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);

  // The server learns about the purchase from RevenueCat a moment later.
  const waitForPro = async () => {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const fresh = await qc.fetchQuery({ queryKey: keys.account, queryFn: () => import('@/lib/api').then((m) => m.getAccount()) });
      if (isPro(fresh)) return true;
    }
    return false;
  };

  const buy = async (pkg: PurchasesPackage) => {
    setBusy(pkg.identifier);
    setMessage(null);
    try {
      const ok = await buyPackage(pkg);
      if (!ok) return;
      const synced = await waitForPro();
      setMessage(
        synced
          ? { tone: 'success', text: 'Welcome to Pro! Receipt reading is on.' }
          : { tone: 'info', text: 'Purchase complete. Pro will switch on in a minute.' },
      );
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    setBusy('restore');
    setMessage(null);
    try {
      await setupPurchases(user!.id);
      const ok = await restorePurchases();
      if (ok) await waitForPro();
      setMessage(ok ? { tone: 'success', text: 'Pro restored.' } : { tone: 'info', text: 'No Pro purchase found for this account.' });
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Stack gap={space.sm} style={{ alignItems: 'center', paddingVertical: space.lg }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkles" size={30} color={t.primary} />
        </View>
        <Text variant="title" center>Tripley Pro</Text>
        <Text muted center>Stop typing bills in. Take a photo and you&apos;re done.</Text>
      </Stack>
      <Card>
        {FEATURES.map((f) => (
          <Row key={f} gap={space.sm} align="flex-start">
            <Icon name="check" size={18} color={t.success} />
            <Text style={{ flex: 1 }}>{f}</Text>
          </Row>
        ))}
        <Text variant="caption" faint>Everything else in Tripley stays free: live map, invites, splitting and settling up.</Text>
      </Card>

      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}

      {pro ? (
        <Stack>
          <Banner tone="success" title="You have Pro">AI receipt reading is on for your account.</Banner>
          <Button
            title="Manage subscription"
            kind="secondary"
            onPress={async () => {
              const url = available ? await manageSubscriptionUrl().catch(() => null) : null;
              if (url) Linking.openURL(url);
              else setMessage({ tone: 'info', text: 'Manage your subscription in the App Store or Google Play settings.' });
            }}
          />
        </Stack>
      ) : !available ? (
        <Banner tone="info" title="Coming soon">Pro isn&apos;t available on this device yet.</Banner>
      ) : packages.isLoading ? (
        <Button title="Loading prices…" loading onPress={() => undefined} />
      ) : (packages.data ?? []).length === 0 ? (
        <Banner tone="warning">Couldn&apos;t load prices right now. Try again later.</Banner>
      ) : (
        <Stack gap={space.sm}>
          {packages.data!.map((pkg) => (
            <Button
              key={pkg.identifier}
              title={`${pkg.product.title || 'Tripley Pro'} · ${pkg.product.priceString}`}
              onPress={() => buy(pkg)}
              loading={busy === pkg.identifier}
            />
          ))}
          <Text variant="caption" faint center>Cancel anytime. Billed through your app store or card.</Text>
        </Stack>
      )}
      {!pro && available ? <Button title="Restore purchase" kind="ghost" onPress={restore} loading={busy === 'restore'} /> : null}
      <Button title="Not now" kind="ghost" onPress={() => router.back()} />
      <LegalLinks center />
    </Screen>
  );
}
