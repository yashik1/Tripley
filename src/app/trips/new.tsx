import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { CurrencyPicker } from '@/components/CurrencyPicker';
import { Banner, Button, Field, Row, Screen, Text } from '@/components/ui';
import { createTrip } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { isISODate } from '@/lib/format';
import { keys } from '@/lib/queries';
import { useAuth } from '@/providers/AuthProvider';
import { space } from '@/theme';

export default function NewTrip() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(profile?.default_currency ?? 'USD');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    if (!name.trim()) return setError('Give the trip a name.');
    if (start && !isISODate(start)) return setError('Start date should look like 2026-12-20.');
    if (end && !isISODate(end)) return setError('End date should look like 2026-12-27.');
    if (start && end && end < start) return setError('The trip ends before it starts.');
    setBusy(true);
    try {
      const trip = await createTrip({
        name: name.trim(),
        base_currency: currency,
        starts_on: start || null,
        ends_on: end || null,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.trips }),
        qc.invalidateQueries({ queryKey: keys.sharing }),
      ]);
      router.dismissTo(`/trip/${trip.id}/map`);
      router.push(`/trip/${trip.id}/invite`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button title="Create trip" onPress={create} loading={busy} testID="create-trip" />}>
      <Field label="Trip name" testID="trip-name" value={name} onChangeText={setName} placeholder="Goa with the gang" autoFocus maxLength={80} />
      <CurrencyPicker label="Trip currency" value={currency} onChange={setCurrency} />
      <Text variant="caption" faint>
        Balances are shown in this currency. Bills in other currencies are converted automatically.
      </Text>
      <Row gap={space.md}>
        <Field label="Starts (optional)" value={start} onChangeText={setStart} placeholder="YYYY-MM-DD" style={{ flex: 1 }} autoCapitalize="none" />
        <Field label="Ends (optional)" value={end} onChangeText={setEnd} placeholder="YYYY-MM-DD" style={{ flex: 1 }} autoCapitalize="none" />
      </Row>
      <Text variant="caption" faint>Location sharing stops automatically a day after the end date.</Text>
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}
