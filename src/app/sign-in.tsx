import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { defaultCountry, PhoneInput, toE164 } from '@/components/PhoneInput';
import { Banner, Button, Divider, Field, Row, Screen, Segmented, Stack, Text } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { appleNativeAvailable, signInWithAppleNative, signInWithProvider } from '@/lib/oauth';
import { supabase } from '@/lib/supabase';
import { space, useTheme } from '@/theme';

export default function SignIn() {
  const t = useTheme();
  const [method, setMethod] = useState<'phone' | 'email'>('phone');
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

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.xl, paddingVertical: space.xl }}>
        <Stack gap={space.sm}>
          <Text variant="title">Tripley</Text>
          <Text muted>See where your friends are on the trip and split bills without the maths.</Text>
        </Stack>

        <Stack>
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
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Button title="Send me a code" onPress={sendCode} loading={busy === 'code'} testID="send-code" />
          <Text variant="caption" faint center>
            {method === 'phone'
              ? "We'll text you a 6-digit code. Standard SMS rates may apply."
              : "We'll email you a 6-digit code."}
          </Text>
        </Stack>

        <Row gap={space.md}>
          <View style={{ flex: 1 }}><Divider /></View>
          <Text variant="caption" faint>or</Text>
          <View style={{ flex: 1 }}><Divider /></View>
        </Row>

        <Stack gap={space.sm}>
          <Button title="Continue with Google" kind="secondary" onPress={() => oauth('google')} loading={busy === 'google'} />
          {appleNative ? (
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
          ) : Platform.OS !== 'android' ? (
            <Button title="Continue with Apple" kind="secondary" onPress={() => oauth('apple')} loading={busy === 'apple'} />
          ) : null}
        </Stack>
        <Text variant="caption" faint center>
          By continuing you agree to share your location with people on trips you join, only while those trips are on.
        </Text>
      </View>
    </Screen>
  );
}
