import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { CurrencyPicker } from '@/components/CurrencyPicker';
import { Avatar, Banner, Button, Card, Field, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { isPro, updateProfile } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { errorMessage } from '@/lib/errors';
import { normalizeHandles, type PaymentHandles } from '@/lib/payment-links';
import { useAccount } from '@/lib/queries';
import { useAuth } from '@/providers/AuthProvider';
import { space, useTheme } from '@/theme';

const HANDLE_FIELDS: { key: keyof PaymentHandles; label: string; placeholder: string }[] = [
  { key: 'upi', label: 'UPI ID', placeholder: 'name@okhdfcbank' },
  { key: 'venmo', label: 'Venmo username', placeholder: 'maya-r' },
  { key: 'paypal', label: 'PayPal.me username', placeholder: 'mayar' },
  { key: 'revolut', label: 'Revolut @tag', placeholder: 'mayar' },
  { key: 'cashapp', label: 'Cash App $cashtag', placeholder: 'mayar' },
  { key: 'wise', label: 'Wise pay link name', placeholder: 'mayar' },
  { key: 'other', label: 'Other (bank details, etc.)', placeholder: 'IBAN / account number' },
];

export default function Profile() {
  const t = useTheme();
  const qc = useQueryClient();
  const { profile, user, signOut, refreshProfile } = useAuth();
  const account = useAccount();
  // The profile is loaded before signed-in screens render.
  const [name, setName] = useState(profile?.display_name ?? '');
  const [currency, setCurrency] = useState(profile?.default_currency ?? 'USD');
  const [handles, setHandles] = useState<PaymentHandles>(profile?.payment_handles ?? {});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const save = async () => {
    if (!name.trim()) return setMessage({ tone: 'danger', text: 'Your name can’t be empty.' });
    setBusy(true);
    setMessage(null);
    try {
      await updateProfile({ display_name: name.trim(), default_currency: currency, payment_handles: normalizeHandles(handles) });
      await refreshProfile();
      await qc.invalidateQueries({ queryKey: ['members'] });
      setMessage({ tone: 'success', text: 'Saved.' });
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const pro = isPro(account.data);
  const contact = user?.phone ? `+${user.phone.replace(/^\+/, '')}` : user?.email ?? '';

  return (
    <Screen footer={<Button title="Save" onPress={save} loading={busy} testID="save-profile" />}>
      <Row gap={space.md}>
        <Avatar id={user?.id ?? ''} name={name || '?'} url={profile?.avatar_url} size={56} />
        <Stack gap={2} style={{ flex: 1 }}>
          <Text variant="heading">{name || 'Your profile'}</Text>
          <Text variant="caption" muted>{contact}</Text>
        </Stack>
      </Row>

      <Card>
        <Field label="Name" value={name} onChangeText={setName} maxLength={60} />
        <CurrencyPicker label="Usual currency (for new trips)" value={currency} onChange={setCurrency} />
      </Card>

      <Stack gap={space.sm}>
        <SectionTitle>How friends can pay you</SectionTitle>
        <Text variant="caption" muted>
          Shown to people on your trips when they settle up, so their payment app opens with the amount filled in.
        </Text>
        <Card>
          {HANDLE_FIELDS.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              value={handles[f.key] ?? ''}
              onChangeText={(v) => setHandles((h) => ({ ...h, [f.key]: v }))}
              placeholder={f.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              multiline={f.key === 'other'}
            />
          ))}
        </Card>
      </Stack>

      <Stack gap={space.sm}>
        <SectionTitle>Plan</SectionTitle>
        <Card>
          <Text variant="heading">{pro ? 'Tripley Pro' : 'Free'}</Text>
          <Text muted>
            {pro
              ? `AI receipt reading is on.${account.data?.plan_expires_at ? ` Renews or ends ${new Date(account.data.plan_expires_at).toLocaleDateString()}.` : ''}`
              : 'Everything except AI receipt reading. Upgrade to have bills read for you.'}
          </Text>
          <Button title={pro ? 'Manage subscription' : 'See Pro'} kind={pro ? 'secondary' : 'primary'} small onPress={() => router.push('/pro')} />
        </Card>
      </Stack>

      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}

      <Button
        title="Sign out"
        icon="logout"
        kind="ghost"
        onPress={async () => {
          if (await confirm('Sign out?', 'Location sharing stops on this device until you sign in again.', 'Sign out')) {
            await signOut();
          }
        }}
      />
      <Text variant="caption" faint center style={{ color: t.textFaint }}>
        To delete your account and data, contact support from the app store listing.
      </Text>
    </Screen>
  );
}
