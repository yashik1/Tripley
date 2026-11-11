import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { CurrencyPicker } from '@/components/CurrencyPicker';
import { DateTimeField } from '@/components/DateTimeField';
import { FoundNote, PlaceField } from '@/components/PlaceField';
import { Banner, Button, Field, Row, Screen, Text } from '@/components/ui';
import { createTrip } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import type { GeoResult } from '@/lib/geocode';
import { isISODate } from '@/lib/format';
import { keys } from '@/lib/queries';
import { useAuth } from '@/providers/AuthProvider';
import { space } from '@/theme';

export default function NewTrip() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  // Pre-filled from a destination idea (Explore).
  const params = useLocalSearchParams<{ name?: string; destination?: string; currency?: string }>();
  const [name, setName] = useState(params.name ?? '');
  const [destination, setDestination] = useState(params.destination ?? '');
  const [found, setFound] = useState<GeoResult | null>(null);
  const [currency, setCurrency] = useState(params.currency && /^[A-Z]{3}$/.test(params.currency) ? params.currency : profile?.default_currency ?? 'USD');
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
        destination: destination.trim() || null,
        destination_lat: found ? found.lat : null,
        destination_lng: found ? found.lng : null,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.trips }),
        qc.invalidateQueries({ queryKey: keys.overview }),
        qc.invalidateQueries({ queryKey: keys.sharing }),
      ]);
      router.replace(`/trip/${trip.id}/invite`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button title="Create trip" onPress={create} loading={busy} testID="create-trip" />}>
      <Field label="Trip name" testID="trip-name" value={name} onChangeText={setName} placeholder="Goa with the gang" autoFocus maxLength={80} />
      <PlaceField
        label="Destination (optional)"
        testID="trip-destination"
        scope="area"
        value={destination}
        onChangeText={(text) => {
          setDestination(text);
          setFound(null);
        }}
        onPick={(r) => {
          setDestination(r.short.slice(0, 80));
          setFound(r);
        }}
        found={!!found}
        placeholder="Search a town, region or country"
        maxLength={80}
      />
      <FoundNote found={found} typed={destination} testID="trip-destination-note" />
      <CurrencyPicker label="Trip currency" value={currency} onChange={setCurrency} />
      <Text variant="caption" faint>
        Balances are shown in this currency. Bills in other currencies are converted automatically.
      </Text>
      <Row gap={space.md} align="flex-start">
        <DateTimeField mode="date" label="Starts (optional)" value={start} onChangeText={setStart} style={{ flex: 1 }} testID="trip-start" />
        <DateTimeField mode="date" label="Ends (optional)" value={end} onChangeText={setEnd} min={start || undefined} style={{ flex: 1 }} testID="trip-end" />
      </Row>
      <Text variant="caption" faint>Location sharing stops automatically a day after the end date.</Text>
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}
