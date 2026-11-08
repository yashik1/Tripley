import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { AuthLayout, PasswordField } from '@/components/AuthLayout';
import { Banner, Button, Loading, Stack } from '@/components/ui';
import { openResetLink, setNewPassword } from '@/lib/account';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { space } from '@/theme';

// The link's token works once. This screen can mount again when signing in
// rebuilds the navigator, so remember which token this page load already used.
let usedToken: string | null = null;

/** Opened from the reset email: /reset-password?token=…&type=recovery */
export default function ResetPassword() {
  const params = useLocalSearchParams<{ token?: string; token_hash?: string }>();
  const token = params.token ?? params.token_hash ?? '';
  const { session } = useAuth();
  const [linkError, setLinkError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(!!token && usedToken !== token);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token || usedToken === token) return;
    usedToken = token;
    openResetLink(token)
      .catch((e) => setLinkError(errorMessage(e)))
      .finally(() => setVerifying(false));
  }, [token]);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await setNewPassword(password);
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (verifying) return <Loading label="Checking your link…" />;

  if (done) {
    return (
      <AuthLayout title="Password changed" subtitle="You're logged in. Use your new password next time.">
        <Button title="Go to my trips" onPress={() => router.replace('/')} testID="reset-done" />
      </AuthLayout>
    );
  }

  if (linkError || !session) {
    return (
      <AuthLayout title="This link doesn't work" subtitle={linkError ?? 'Open the newest reset link from your email, or ask for a new one.'}>
        <Button title="Send a new link" onPress={() => router.replace('/forgot-password')} testID="reset-new-link" />
        <Button title="Back to log in" kind="ghost" onPress={() => router.replace('/sign-in')} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle={session.user.email ? `For ${session.user.email}` : undefined}>
      <Stack gap={space.md}>
        <PasswordField label="New password" value={password} onChangeText={setPassword} onSubmitEditing={save} newPassword testID="reset-password" />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Button title="Save new password" onPress={save} loading={busy} testID="reset-submit" />
      </Stack>
    </AuthLayout>
  );
}
