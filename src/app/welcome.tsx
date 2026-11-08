import { useState } from 'react';
import { View } from 'react-native';

import { CurrencyPicker } from '@/components/CurrencyPicker';
import { Banner, Button, Field, Screen, Stack, Text } from '@/components/ui';
import { updateProfile } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { space } from '@/theme';

function guessCurrency(): string {
  try {
    const region = Intl.DateTimeFormat().resolvedOptions().locale.split(/[-_]/)[1]?.toUpperCase();
    const map: Record<string, string> = {
      IN: 'INR', US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', AE: 'AED', JP: 'JPY',
      DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', PT: 'EUR', AT: 'EUR', BE: 'EUR', FI: 'EUR',
      CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', ZA: 'ZAR', BR: 'BRL', MX: 'MXN', TH: 'THB',
    };
    return (region && map[region]) || 'USD';
  } catch {
    return 'USD';
  }
}

export default function Welcome() {
  const { refreshProfile } = useAuth();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(guessCurrency());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return setError('Add your name so friends know who you are.');
    setBusy(true);
    setError(null);
    try {
      await updateProfile({ display_name: name.trim().slice(0, 60), default_currency: currency });
      await refreshProfile();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
        <Text variant="title">Welcome!</Text>
        <Text muted>What should your trip friends call you?</Text>
        <Stack>
          <Field label="Your name" testID="name-input" value={name} onChangeText={setName} placeholder="e.g. Maya" autoFocus autoComplete="name" />
          <CurrencyPicker label="Your usual currency" value={currency} onChange={setCurrency} />
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Button title="Get started" onPress={save} loading={busy} testID="save-name" />
        </Stack>
      </View>
    </Screen>
  );
}
