import { router } from 'expo-router';
import { useState } from 'react';

import { AuthLayout, AuthSwitch } from '@/components/AuthLayout';
import { Banner, Button, Field, Stack } from '@/components/ui';
import { requestPasswordReset } from '@/lib/account';
import { normalizeEmail } from '@/lib/credentials';
import { errorMessage } from '@/lib/errors';
import { useLeaveWhenSignedIn } from '@/lib/use-leave-when-signed-in';
import { space } from '@/theme';

export default function ForgotPassword() {
  useLeaveWhenSignedIn();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setSentTo(normalizeEmail(email));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={`If there's a Tripley account for ${sentTo}, a link to choose a new password is on its way. It works once and expires in an hour.`}>
        <Banner tone="info">Nothing after a few minutes? Check your spam folder, or try again.</Banner>
        <Button title="Back to log in" onPress={() => router.replace('/sign-in')} testID="back-to-login" />
        <AuthSwitch prompt="Wrong address?" action="Try again" onPress={() => setSentTo(null)} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset your password" subtitle="Enter the email you signed up with and we'll send you a link to choose a new password.">
      <Stack gap={space.md}>
        <Field
          label="Email"
          testID="forgot-email"
          value={email}
          onChangeText={setEmail}
          onSubmitEditing={submit}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Button title="Send reset link" onPress={submit} loading={busy} testID="forgot-submit" />
      </Stack>
      <AuthSwitch prompt="Remembered it?" action="Log in" onPress={() => router.replace('/sign-in')} />
    </AuthLayout>
  );
}
