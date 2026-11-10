import * as AppleAuthentication from 'expo-apple-authentication';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { AuthLayout, AuthSwitch, PasswordField } from '@/components/AuthLayout';
import { AgreeNote } from '@/components/Legal';
import { defaultCountry, PhoneInput, toE164 } from '@/components/PhoneInput';
import { Banner, Button, Divider, Field, Row, Segmented, Stack, Text } from '@/components/ui';
import { logInWithPassword } from '@/lib/account';
import { hasAuth } from '@/lib/auth-methods';
import { errorMessage } from '@/lib/errors';
import { useLeaveWhenSignedIn } from '@/lib/use-leave-when-signed-in';
import { signInAsGuest } from '@/lib/guest';
import { appleNativeAvailable, signInWithAppleNative, signInWithProvider } from '@/lib/oauth';
import { supabase } from '@/lib/supabase';
import { space, useTheme } from '@/theme';

export default function SignIn() {
  useLeaveWhenSignedIn();
  const t = useTheme();
  const params = useLocalSearchParams<{ guest?: string }>();
  const codeMethods = (['phone', 'email'] as const).filter((m) => hasAuth(m));
  const showPassword = hasAuth('password');
  const [method, setMethod] = useState<'phone' | 'email'>(codeMethods[0] ?? 'phone');
  const [loginEmail, setLoginEmail] = useState('');
  const [password, setPassword] = useState('');
  const [guestName, setGuestName] = useState('');
  const [country, setCountry] = useState(defaultCountry());
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appleNative, setAppleNative] = useState(false);

  const showGoogle = hasAuth('google');
  const showApple = hasAuth('apple') && (appleNative || Platform.OS !== 'android');
  const showGuest = hasAuth('guest');
  const guestOnly = showGuest && !showPassword && codeMethods.length === 0 && !showGoogle && !showApple;
  const [guestOpen, setGuestOpen] = useState(params.guest === '1');

  useEffect(() => {
    appleNativeAvailable().then(setAppleNative);
  }, []);

  const logIn = async () => {
    setError(null);
    setBusy('password');
    try {
      await logInWithPassword(loginEmail, password);
      // The auth listener moves on to your trips once the session exists.
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

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
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  const or = (label = 'or') => (
    <Row gap={space.md}>
      <View style={{ flex: 1 }}><Divider /></View>
      <Text variant="caption" faint>{label}</Text>
      <View style={{ flex: 1 }}><Divider /></View>
    </Row>
  );

  const passwordForm = showPassword ? (
    <Stack gap={space.md}>
      <Field
        label="Email"
        testID="login-email"
        value={loginEmail}
        onChangeText={setLoginEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
      />
      <PasswordField value={password} onChangeText={setPassword} onSubmitEditing={logIn} testID="login-password" />
      <Pressable accessibilityRole="link" onPress={() => router.push('/forgot-password')} hitSlop={8} style={{ alignSelf: 'flex-end' }} testID="forgot-link">
        <Text variant="caption" color={t.primary} style={{ fontWeight: '600' }}>Forgot password?</Text>
      </Pressable>
      <Button title="Log in" onPress={logIn} loading={busy === 'password'} testID="login-submit" />
    </Stack>
  ) : null;

  const codeForm =
    codeMethods.length > 0 ? (
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
              { value: 'email', label: 'Email code' },
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
        <Button title="Send me a code" kind={showPassword ? 'secondary' : 'primary'} onPress={sendCode} loading={busy === 'code'} testID="send-code" />
        <Text variant="caption" faint center>
          {method === 'phone' ? "We'll text you a 6-digit code. Standard SMS rates may apply." : "We'll email you a 6-digit code."}
        </Text>
      </Stack>
    ) : null;

  const providerButtons =
    showGoogle || showApple ? (
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
    ) : null;

  const guestForm = (
    <Stack>
      <Field
        label={guestOnly ? "What's your name?" : 'Your name'}
        testID="guest-name"
        value={guestName}
        onChangeText={setGuestName}
        placeholder="e.g. Maya"
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
        A guest account lives only in this browser. You can save it with an email and password later.
      </Text>
    </Stack>
  );

  const hasMain = !!passwordForm || !!codeForm || !!providerButtons;

  return (
    <AuthLayout
      title={showPassword ? 'Log in' : 'Welcome to Tripley'}
      subtitle={showPassword ? 'Welcome back. Your trips are waiting.' : 'See where your friends are on the trip and split bills without the maths.'}>
      {passwordForm}
      {passwordForm && (codeForm || providerButtons) ? or('or') : null}
      {codeForm}
      {codeForm && providerButtons ? or('or') : null}
      {providerButtons}

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {showPassword ? (
        <AuthSwitch prompt="New to Tripley?" action="Create an account" onPress={() => router.replace('/sign-up')} testID="go-signup" />
      ) : null}

      {showGuest ? (
        guestOnly || guestOpen || !hasMain ? (
          <>
            {hasMain ? or('or try it first') : null}
            {guestForm}
          </>
        ) : (
          <AuthSwitch prompt="Just trying it out?" action="Continue as a guest" onPress={() => setGuestOpen(true)} testID="open-guest" />
        )
      ) : null}
      <AgreeNote />
    </AuthLayout>
  );
}
