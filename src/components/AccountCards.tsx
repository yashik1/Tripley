import { useState } from 'react';
import { Switch, View } from 'react-native';

import { saveGuestAccount, setNewPassword } from '@/lib/account';
import { updateNotificationPrefs } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import type { NotificationPrefs } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { space, useTheme } from '@/theme';
import { PasswordField } from './AuthLayout';
import { Banner, Button, Card, Field, Row, Stack, Text } from './ui';

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

/** Which feed notifications this person wants. Saved on their profile; the server checks it before notifying. */
export function NotificationPrefsCard() {
  const t = useTheme();
  const { profile, user, refreshProfile } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prefs = profile?.notification_prefs ?? {};
  const rows: { key: keyof NotificationPrefs; label: string; detail: string; def: boolean }[] = [
    { key: 'posts', label: 'New posts and photos', detail: 'When someone posts in a trip', def: true },
    { key: 'announcements', label: 'Announcements', detail: 'From the trip organizer', def: true },
    { key: 'comments', label: 'Comments on your posts', detail: 'When someone replies to you', def: true },
    { key: 'reactions', label: 'Reactions to your posts', detail: 'Off unless you want them', def: false },
  ];
  const toggle = async (key: keyof NotificationPrefs, value: boolean) => {
    if (!user) return;
    setBusy(key);
    setError(null);
    try {
      await updateNotificationPrefs(user.id, { ...prefs, [key]: value });
      await refreshProfile();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card testID="notification-prefs">
      <Text variant="heading">Notifications</Text>
      {rows.map((r) => {
        const on = prefs[r.key] ?? r.def;
        return (
          <Row key={r.key} gap={space.md}>
            <View style={{ flex: 1 }}>
              <Text variant="label">{r.label}</Text>
              <Text variant="caption" muted>{r.detail}</Text>
            </View>
            <Switch
              value={on}
              disabled={busy === r.key}
              onValueChange={(v) => toggle(r.key, v)}
              trackColor={{ true: t.primary, false: t.border }}
              thumbColor="#fff"
              accessibilityLabel={r.label}
              testID={`pref-${r.key}`}
            />
          </Row>
        );
      })}
      <Text variant="caption" faint>Bills, payments and invitations are always sent; they affect your money and trips.</Text>
      {error ? <Text variant="caption" color={t.danger}>{error}</Text> : null}
    </Card>
  );
}
