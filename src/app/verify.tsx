import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { Banner, Button, Field, Screen, Text } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useLeaveWhenSignedIn } from '@/lib/use-leave-when-signed-in';

export default function Verify() {
  useLeaveWhenSignedIn();
  const { phone, email } = useLocalSearchParams<{ phone?: string; email?: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(60);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const verify = async (value = code) => {
    const token = value.replace(/\D/g, '');
    if (token.length < 6) return;
    setBusy(true);
    setError(null);
    const { error: err } = phone
      ? await supabase.auth.verifyOtp({ phone, token, type: 'sms' })
      : await supabase.auth.verifyOtp({ email: email!, token, type: 'email' });
    setBusy(false);
    // On success the auth listener switches screens for us.
    if (err) setError(err.message.includes('expired') || err.message.includes('invalid') ? 'That code is wrong or has expired.' : errorMessage(err));
  };

  const resend = async () => {
    setError(null);
    const { error: err } = phone
      ? await supabase.auth.signInWithOtp({ phone })
      : await supabase.auth.signInWithOtp({ email: email! });
    if (err) setError(errorMessage(err));
    else setCooldown(60);
  };

  return (
    <Screen>
      <Text variant="heading">Enter the 6-digit code</Text>
      <Text muted>We sent it to {phone ?? email}.</Text>
      <Field
        testID="otp-input"
        value={code}
        onChangeText={(v) => {
          const digits = v.replace(/\D/g, '').slice(0, 6);
          setCode(digits);
          if (digits.length === 6) verify(digits);
        }}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        placeholder="123456"
        maxLength={6}
        autoFocus
      />
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Button title="Continue" onPress={() => verify()} loading={busy} disabled={code.length < 6} testID="verify-code" />
      <Button
        title={cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
        kind="ghost"
        onPress={resend}
        disabled={cooldown > 0}
      />
    </Screen>
  );
}
