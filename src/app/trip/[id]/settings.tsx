import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';

import { Banner, Button, Card, Field, Loading, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { deleteTrip, leaveTrip, regenerateInviteCode, updateTrip } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { errorMessage } from '@/lib/errors';
import { isISODate } from '@/lib/format';
import { keys } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import type { Trip } from '@/lib/types';
import { useSharing } from '@/providers/SharingProvider';
import { space, useTheme } from '@/theme';

export default function TripSettings() {
  const id = useTripId();
  const data = useTripData(id);
  if (!data.trip) return <Loading />;
  return <TripSettingsForm key={data.trip.id} id={id} trip={data.trip} isOrganizer={data.isOrganizer} active={data.active} />;
}

function TripSettingsForm({ id, trip, isOrganizer, active }: { id: string; trip: Trip; isOrganizer: boolean; active: boolean }) {
  const t = useTheme();
  const qc = useQueryClient();
  const sharing = useSharing();
  const [name, setName] = useState(trip.name);
  const [start, setStart] = useState(trip.starts_on ?? '');
  const [end, setEnd] = useState(trip.ends_on ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: keys.trip(id) }),
      qc.invalidateQueries({ queryKey: keys.trips }),
      qc.invalidateQueries({ queryKey: keys.sharing }),
    ]);
    await sharing.refresh();
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setSaved(false);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run('save', async () => {
      if (!name.trim()) throw new Error('Give the trip a name.');
      if ((start && !isISODate(start)) || (end && !isISODate(end))) throw new Error('Dates should look like 2026-12-20.');
      await updateTrip(id, { name: name.trim(), starts_on: start || null, ends_on: end || null });
      setSaved(true);
    });

  if (!isOrganizer) {
    return (
      <Screen>
        <Text muted>Only the organizer can change trip details.</Text>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Button
          title="Leave trip"
          kind="danger"
          loading={busy === 'leave'}
          onPress={async () => {
            if (!(await confirm('Leave this trip?', 'You will stop sharing your location and lose access to its bills.', 'Leave', true))) return;
            await run('leave', () => leaveTrip(id));
            router.dismissTo('/');
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {saved ? <Banner tone="success">Saved.</Banner> : null}
      <Card>
        <Field label="Trip name" value={name} onChangeText={setName} maxLength={80} />
        <Row gap={space.md}>
          <Field label="Starts" value={start} onChangeText={setStart} placeholder="YYYY-MM-DD" style={{ flex: 1 }} autoCapitalize="none" />
          <Field label="Ends" value={end} onChangeText={setEnd} placeholder="YYYY-MM-DD" style={{ flex: 1 }} autoCapitalize="none" />
        </Row>
        <Text variant="caption" faint>Currency: {trip.base_currency} (can&apos;t change once bills are added)</Text>
        <Button title="Save" onPress={save} loading={busy === 'save'} />
      </Card>

      <Stack gap={space.sm}>
        <SectionTitle>Invite link</SectionTitle>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '500' }}>Anyone with the link can join</Text>
              <Text variant="caption" muted>Turn off once everyone is in.</Text>
            </View>
            <Switch
              value={trip.invite_enabled}
              onValueChange={(v) => run('link', () => updateTrip(id, { invite_enabled: v }))}
              trackColor={{ true: t.primary }}
            />
          </Row>
          <Button
            title="Make a new link"
            kind="secondary"
            small
            loading={busy === 'regen'}
            onPress={async () => {
              if (!(await confirm('Make a new link?', 'The old link will stop working.', 'New link'))) return;
              run('regen', async () => {
                await regenerateInviteCode(id);
              });
            }}
          />
        </Card>
      </Stack>

      <Stack gap={space.sm}>
        <SectionTitle>End of trip</SectionTitle>
        <Card>
          {active ? (
            <>
              <Text muted>Ending the trip stops everyone&apos;s location sharing. Bills and balances stay so people can settle up.</Text>
              <Button
                title="End trip now"
                kind="danger"
                loading={busy === 'end'}
                onPress={async () => {
                  if (!(await confirm('End this trip?', 'Location sharing stops for everyone.', 'End trip', true))) return;
                  run('end', () => updateTrip(id, { ended_at: new Date().toISOString() }));
                }}
              />
            </>
          ) : (
            <>
              <Text muted>This trip has ended.</Text>
              {trip.ended_at ? (
                <Button title="Reopen trip" kind="secondary" loading={busy === 'reopen'} onPress={() => run('reopen', () => updateTrip(id, { ended_at: null }))} />
              ) : null}
            </>
          )}
          <Button
            title="Delete trip"
            kind="ghost"
            loading={busy === 'delete'}
            onPress={async () => {
              if (!(await confirm('Delete this trip?', 'All bills, balances and payments in it are deleted for everyone. This cannot be undone.', 'Delete', true))) return;
              await run('delete', () => deleteTrip(id));
              router.dismissTo('/');
            }}
          />
        </Card>
      </Stack>
    </Screen>
  );
}
