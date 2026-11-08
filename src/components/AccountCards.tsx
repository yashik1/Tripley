import { useState } from 'react';

import { saveGuestAccount, setNewPassword } from '@/lib/account';
import { errorMessage } from '@/lib/errors';
import { space } from '@/theme';
import { PasswordField } from './AuthLayout';
import { Banner, Button, Card, Field, Stack, Text } from './ui';

/** For guests: add an email and password to keep this account (same trips) and log in anywhere. */
export function SaveAccountCard({ onSaved }: { onSaved?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const { needsEmailConfirmation } = await saveGuestAccount(email, password);
      if (needsEmailConfirmation) setPending(email.trim());
      else onSaved?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    return (
      <Banner tone="info" title="Check your email" icon="mail">
        {`We sent a link to ${pending}. Open it to finish saving your account. Until then, stay signed in here.`}
      </Banner>
    );
  }

  return (
    <Card>
      <Stack gap={space.xs}>
        <Text variant="heading">Save your account</Text>
        <Text muted>
          Guest accounts only live in this browser. Add an email and password to keep your trips, bills and balances,
          and log in from any device.
        </Text>
      </Stack>
      <Field
        label="Email"
        testID="save-email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
      />
      <PasswordField value={password} onChangeText={setPassword} onSubmitEditing={save} newPassword testID="save-password" />
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Button title="Save my account" onPress={save} loading={busy} testID="save-account" />
    </Card>
  );
}

/** For email accounts: set a new password while logged in. */
export function ChangePasswordCard() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const save = async () => {
    setMessage(null);
    setBusy(true);
    try {
      await setNewPassword(password);
      setPassword('');
      setOpen(false);
      setMessage({ tone: 'success', text: 'Password changed.' });
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text variant="heading">Password</Text>
      {open ? (
        <>
          <PasswordField label="New password" value={password} onChangeText={setPassword} onSubmitEditing={save} newPassword testID="new-password" />
          <Button title="Save new password" small onPress={save} loading={busy} testID="change-password-save" />
        </>
      ) : (
        <Button title="Change password" kind="secondary" small onPress={() => setOpen(true)} testID="change-password" />
      )}
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
    </Card>
  );
}
