import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { ChangePasswordCard, NotificationPrefsCard, PassportCard, SaveAccountCard } from '@/components/AccountCards';
import { CurrencyPicker } from '@/components/CurrencyPicker';
import { LegalLinks } from '@/components/Legal';
import { Avatar, Banner, Button, Card, Field, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { isPro, updateProfile } from '@/lib/api';
import { queuedCount } from '@/lib/outbox';
import { hasAuth } from '@/lib/auth-methods';
import { confirm } from '@/lib/confirm';
import { errorMessage } from '@/lib/errors';
import { isGuest } from '@/lib/guest';
import { supportEmail } from '@/lib/legal';
import { isValidIban, normalizeHandles, type PaymentHandles } from '@/lib/payment-links';
import { useAccount } from '@/lib/queries';
import { useAuth } from '@/providers/AuthProvider';
import { space, useTheme } from '@/theme';

const HANDLE_FIELDS: { key: keyof PaymentHandles; label: string; placeholder: string; group: string }[] = [
  { key: 'upi', label: 'UPI ID (also opens PhonePe, Paytm, GPay)', placeholder: 'name@okhdfcbank', group: 'India' },
  { key: 'venmo', label: 'Venmo username', placeholder: 'maya-r', group: 'United States' },
  { key: 'zelle', label: 'Zelle email or phone', placeholder: 'maya@example.com', group: 'United States' },
  { key: 'cashapp', label: 'Cash App $cashtag', placeholder: 'mayar', group: 'United States' },
  { key: 'iban', label: 'IBAN (for a SEPA QR code)', placeholder: 'DE89 3704 0044 0532 0130 00', group: 'Europe & UK' },
  { key: 'iban_name', label: 'Name on the bank account', placeholder: 'Maya Rao', group: 'Europe & UK' },
  { key: 'monzo', label: 'Monzo.me username', placeholder: 'mayar', group: 'Europe & UK' },
  { key: 'revolut', label: 'Revolut @tag', placeholder: 'mayar', group: 'Europe & UK' },
  { key: 'wise', label: 'Wise pay link name', placeholder: 'mayar', group: 'Europe & UK' },
  { key: 'paypal', label: 'PayPal.me username', placeholder: 'mayar', group: 'Anywhere' },
  { key: 'other', label: 'Other (bank details, etc.)', placeholder: 'Account number, sort code…', group: 'Anywhere' },
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
  const [accountSaved, setAccountSaved] = useState(false);

  const save = async () => {
    if (!name.trim()) return setMessage({ tone: 'danger', text: 'Your name can’t be empty.' });
    if ((handles.iban ?? '').trim() && !isValidIban(handles.iban)) return setMessage({ tone: 'danger', text: 'Check your IBAN, or leave it empty.' });
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
  const guest = isGuest(user);
  const email = supportEmail();
  const contact = guest ? 'Guest account' : user?.phone ? `+${user.phone.replace(/^\+/, '')}` : user?.email ?? '';

  return (
    <Screen footer={<Button title="Save" onPress={save} loading={busy} testID="save-profile" />}>
      <Row gap={space.md}>
        <Avatar id={user?.id ?? ''} name={name || '?'} url={profile?.avatar_url} size={56} />
        <Stack gap={2} style={{ flex: 1 }}>
          <Text variant="heading">{name || 'Your profile'}</Text>
          <Text variant="caption" muted>{contact}</Text>
        </Stack>
      </Row>

      {guest && hasAuth('password') ? (
        <SaveAccountCard onSaved={() => setAccountSaved(true)} />
      ) : guest ? (
        <Banner tone="warning" title="Guest account" icon="person">
          Your account lives in this browser. If you sign out or clear this site&apos;s data, you won&apos;t be able to get back into your trips.
        </Banner>
      ) : null}
      {accountSaved && !guest ? (
        <Banner tone="success" title="Account saved" icon="check">
          {`You can now log in as ${user?.email ?? 'your email'} on any device. Your trips are all still here.`}
        </Banner>
      ) : null}

      <Card>
        <Field label="Name" value={name} onChangeText={setName} maxLength={60} />
        <CurrencyPicker label="Usual currency (for new trips)" value={currency} onChange={setCurrency} />
      </Card>

      <Stack gap={space.sm}>
        <SectionTitle>How friends can pay you</SectionTitle>
        <Text variant="caption" muted>
          Shown to people on your trips when they settle up, so their payment app opens with the amount filled in.
        </Text>
        {[...new Set(HANDLE_FIELDS.map((f) => f.group))].map((group) => (
          <Card key={group}>
            <Text variant="caption" muted style={{ fontWeight: '600' }}>{group}</Text>
            {HANDLE_FIELDS.filter((f) => f.group === group).map((f) => (
              <Field
                key={f.key}
                label={f.label}
                testID={`handle-${f.key}`}
                value={handles[f.key] ?? ''}
                onChangeText={(v) => setHandles((h) => ({ ...h, [f.key]: v }))}
                placeholder={f.placeholder}
                autoCapitalize={f.key === 'iban' ? 'characters' : f.key === 'iban_name' ? 'words' : 'none'}
                autoCorrect={false}
                multiline={f.key === 'other'}
                error={f.key === 'iban' && (handles.iban ?? '').trim() && !isValidIban(handles.iban) ? 'That IBAN doesn’t look right. Check the digits.' : null}
              />
            ))}
          </Card>
        ))}
      </Stack>

      <PassportCard />

      <NotificationPrefsCard />

      {!guest && user?.email && hasAuth('password') ? <ChangePasswordCard /> : null}

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
          const unsynced = user ? await queuedCount(user.id) : 0;
          const lose =
            unsynced > 0
              ? ` ${unsynced === 1 ? '1 bill hasn’t' : `${unsynced} bills haven’t`} synced yet and will be deleted from this device.`
              : '';
          const ok = guest
            ? await confirm(
                'Sign out of a guest account?',
                hasAuth('password')
                  ? `Guest accounts can't sign back in. Save your account with an email and password first, or you'll lose your trips and balances.${lose}`
                  : `Guest accounts can't sign back in. You'll lose access to your trips and balances on this device.${lose}`,
                'Sign out anyway',
                true,
              )
            : await confirm(
                'Sign out?',
                `Location sharing stops and your saved trip data is removed from this device.${lose}`,
                'Sign out',
                unsynced > 0,
              );
          if (ok) {
            // Go home first so signing out lands on the home page, not the log-in page.
            router.replace('/');
            await signOut();
          }
        }}
      />
      <Stack gap={space.sm} style={{ alignItems: 'center' }}>
        <LegalLinks center />
        <Text variant="caption" faint center style={{ color: t.textFaint }} testID="delete-account-help">
          {email
            ? `To get a copy of your data or delete your account, email ${email}.`
            : 'To get a copy of your data or delete your account, see “Contact us” in the Privacy Policy.'}
        </Text>
      </Stack>
    </Screen>
  );
}
