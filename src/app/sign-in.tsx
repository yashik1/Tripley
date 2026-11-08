import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { defaultCountry, PhoneInput, toE164 } from '@/components/PhoneInput';
import { Banner, Button, Divider, Field, Row, Screen, Segmented, Stack, Text } from '@/components/ui';
import { hasAuth } from '@/lib/auth-methods';
import { errorMessage } from '@/lib/errors';
import { signInAsGuest } from '@/lib/guest';
import { appleNativeAvailable, signInWithAppleNative, signInWithProvider } from '@/lib/oauth';
import { supabase } from '@/lib/supabase';
import { space, useTheme } from '@/theme';

export default function SignIn() {
  const t = useTheme();
  const codeMethods = (['phone', 'email'] as const).filter((m) => hasAuth(m));
  const [method, setMethod] = useState<'phone' | 'email'>(codeMethods[0] ?? 'phone');
  const [guestName, setGuestName] = useState('');
  const [country, setCountry] = useState(defaultCountry());
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appleNative, setAppleNative] = useState(false);

  useEffect(() => {
    appleNativeAvailable().then(setAppleNative);
  }, []);

  const sendCode = async () => {
    setError(null);
    if (method === 'phone') {
      const e164 = toE164(country.dial, phone);
      if (!e164) return setError('Enter your full phone number.');
      setBusy('code');
      const { error: err } = await supabase.auth.signInWithOtp({ phone: e164 });
      setBusy(null);
      if (err) return setError(errorMessage(err));
      router.push({ pathname: '/verify', params: { phone: e164 } });
    } else {
      const value = email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return setError('Enter a valid email address.');
      setBusy('code');
      const { error: err } = await supabase.auth.signInWithOtp({ email: value, options: { shouldCreateUser: true } });
      setBusy(null);
      if (err) return setError(errorMessage(err));
      router.push({ pathname: '/verify', params: { email: value } });
    }
  };

  const oauth = async (provider: 'google' | 'apple') => {
    setError(null);
    setBusy(provider);
    try {
      if (provider === 'apple' && appleNative) await signInWithAppleNative();
      else await signInWithProvider(provider);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const continueAsGuest = async () => {
    setError(null);
    setBusy('guest');
    try {
      await signInAsGuest(guestName);
      // The auth listener switches screens once the session exists.
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  const showGoogle = hasAuth('google');
  const showApple = hasAuth('apple') && (appleNative || Platform.OS !== 'android');
  const showGuest = hasAuth('guest');
  const guestOnly = showGuest && codeMethods.length === 0 && !showGoogle && !showApple;
  const or = (
    <Row gap={space.md}>
      <View style={{ flex: 1 }}><Divider /></View>
      <Text variant="caption" faint>or</Text>
      <View style={{ flex: 1 }}><Divider /></View>
    </Row>
  );

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.xl, paddingVertical: space.xl }}>
        <Stack gap={space.sm}>
          <Text variant="title">Tripley</Text>
          <Text muted>See where your friends are on the trip and split bills without the maths.</Text>
        </Stack>

        {codeMethods.length > 0 ? (
          <Stack>
            {codeMethods.length > 1 ? (
              <Segmented
                value={method}
                onChange={(m) => {
                  setMethod(m);
                  setError(null);
                }}
                options={[
                  { value: 'phone', label: 'Phone' },
                  { value: 'email', label: 'Email' },
                ]}
              />
            ) : null}
            {method === 'phone' ? (
              <PhoneInput country={country} onCountry={setCountry} value={phone} onChangeText={setPhone} />
            ) : (
              <Field
                label="Email"
                testID="email-input"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
              />
            )}
            <Button title="Send me a code" onPress={sendCode} loading={busy === 'code'} testID="send-code" />
            <Text variant="caption" faint center>
              {method === 'phone'
                ? "We'll text you a 6-digit code. Standard SMS rates may apply."
                : "We'll email you a 6-digit code."}
            </Text>
          </Stack>
        ) : null}

        {codeMethods.length > 0 && (showGoogle || showApple) ? or : null}

        {showGoogle || showApple ? (
          <Stack gap={space.sm}>
            {showGoogle ? (
              <Button title="Continue with Google" kind="secondary" onPress={() => oauth('google')} loading={busy === 'google'} />
            ) : null}
            {!showApple ? null : appleNative ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={
                  t.scheme === 'dark'
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={12}
                style={{ height: 48 }}
                onPress={() => oauth('apple')}
              />
            ) : (
              <Button title="Continue with Apple" kind="secondary" onPress={() => oauth('apple')} loading={busy === 'apple'} />
            )}
          </Stack>
        ) : null}

        {showGuest && !guestOnly ? or : null}

        {showGuest ? (
          <Stack>
            <Field
              label={guestOnly ? "What's your name?" : 'Continue as a guest'}
              testID="guest-name"
              value={guestName}
              onChangeText={setGuestName}
              placeholder="Your name, e.g. Maya"
              autoComplete="name"
              maxLength={60}
              onSubmitEditing={continueAsGuest}
            />
            <Button
              title={guestOnly ? 'Continue' : 'Continue as guest'}
              kind={guestOnly ? 'primary' : 'secondary'}
              onPress={continueAsGuest}
              loading={busy === 'guest'}
              testID="guest-continue"
            />
            <Text variant="caption" faint center>
              No phone or email needed. Your account stays on this device.
            </Text>
          </Stack>
        ) : null}

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Text variant="caption" faint center>
          By continuing you agree to share your location with people on trips you join, only while those trips are on.
        </Text>
      </View>
    </Screen>
  );
}
