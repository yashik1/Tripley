import { router } from 'expo-router';
import { useState } from 'react';

import { AuthLayout, AuthSwitch, PasswordField } from '@/components/AuthLayout';
import { AgreeNote } from '@/components/Legal';
import { Banner, Button, Field, Stack, Text } from '@/components/ui';
import { signUpWithPassword } from '@/lib/account';
import { hasAuth } from '@/lib/auth-methods';
import { errorMessage } from '@/lib/errors';
import { useLeaveWhenSignedIn } from '@/lib/use-leave-when-signed-in';
import { space } from '@/theme';

export default function SignUp() {
  useLeaveWhenSignedIn();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const { needsEmailConfirmation } = await signUpWithPassword({ name, email, password });
      // Signed in: the app moves on to your trips by itself.
      if (needsEmailConfirmation) {
        setCheckEmail(true);
        setBusy(false);
      }
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  if (checkEmail) {
    return (
      <AuthLayout title="Check your email" subtitle={`We sent a link to ${email.trim()}. Open it to finish creating your account.`}>
        <Button title="Back to log in" kind="secondary" onPress={() => router.replace('/sign-in')} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your account" subtitle="Save your trips, bills and balances, and log in from any device.">
      <Stack gap={space.md}>
        <Field
          label="Your name"
          testID="signup-name"
          value={name}
          onChangeText={setName}
          placeholder="So friends know who you are"
          autoComplete="name"
          textContentType="name"
          maxLength={60}
        />
        <Field
          label="Email"
          testID="signup-email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
        />
        <PasswordField value={password} onChangeText={setPassword} onSubmitEditing={submit} newPassword testID="signup-password" />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Button title="Create account" onPress={submit} loading={busy} testID="signup-submit" />
        <AgreeNote action="creating an account" />
        <Text variant="caption" faint center>
          Your location is shared only with people on trips you join, only while those trips are on.
        </Text>
      </Stack>
      <AuthSwitch prompt="Already have an account?" action="Log in" onPress={() => router.replace('/sign-in')} testID="go-login" />
      {hasAuth('guest') ? (
        <AuthSwitch prompt="Just trying it out?" action="Continue as a guest" onPress={() => router.replace({ pathname: '/sign-in', params: { guest: '1' } })} />
      ) : null}
    </AuthLayout>
  );
}
