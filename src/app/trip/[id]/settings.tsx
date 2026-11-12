import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';

import { DateTimeField } from '@/components/DateTimeField';
import { FoundNote, PlaceField } from '@/components/PlaceField';
import { Banner, Button, Card, Field, Loading, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { deleteTrip, leaveTrip, regenerateInviteCode, saveTripAsTemplate, setTripCover, updateMySharing, updateTrip } from '@/lib/api';
import { pickPhoto } from '@/lib/photos';
import { TripCover } from '@/components/Travel';
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
  const [destination, setDestination] = useState(trip.destination ?? '');
  const [destPoint, setDestPoint] = useState<{ lat: number; lng: number; address: string } | null>(
    trip.destination_lat != null && trip.destination_lng != null ? { lat: trip.destination_lat, lng: trip.destination_lng, address: trip.destination ?? '' } : null,
  );
  const [start, setStart] = useState(trip.starts_on ?? '');
  const [end, setEnd] = useState(trip.ends_on ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [templateNote, setTemplateNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: keys.trip(id) }),
      qc.invalidateQueries({ queryKey: keys.trips }),
      qc.invalidateQueries({ queryKey: keys.overview }),
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
      if (start && end && end < start) throw new Error('The trip ends before it starts.');
      await updateTrip(id, {
        name: name.trim(),
        destination: destination.trim() || null,
        destination_lat: destPoint?.lat ?? null,
        destination_lng: destPoint?.lng ?? null,
        starts_on: start || null,
        ends_on: end || null,
      });
      setSaved(true);
    });

  if (!isOrganizer) {
    return (
      <Screen>
        <ArrivalAlertsCard tripId={id} />
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
      <ArrivalAlertsCard tripId={id} />
      <Card>
        <Text variant="label">Cover photo</Text>
        <TripCover seed={trip.id} path={trip.cover_path} height={140} />
        <Row>
          <Button
            title={trip.cover_path ? 'Change photo' : 'Add a cover photo'}
            icon="photo"
            kind="secondary"
            small
            style={{ flex: 1 }}
            loading={busy === 'cover'}
            testID="cover-pick"
            onPress={() =>
              run('cover', async () => {
                const uri = await pickPhoto(false);
                if (uri) await setTripCover(id, uri);
              })
            }
          />
          {trip.cover_path ? (
            <Button title="Use the illustration" kind="ghost" small style={{ flex: 1 }} onPress={() => run('cover', () => updateTrip(id, { cover_path: null }))} />
          ) : null}
        </Row>
        <Text variant="caption" faint>Only people on the trip can see it.</Text>
      </Card>
      <Card>
        <Field label="Trip name" value={name} onChangeText={setName} maxLength={80} />
        <PlaceField
          label="Destination"
          testID="settings-destination"
          scope="area"
          value={destination}
          onChangeText={(text) => {
            setDestination(text);
            setDestPoint(null);
          }}
          onPick={(r) => {
            setDestination(r.short.slice(0, 80));
            setDestPoint({ lat: r.lat, lng: r.lng, address: r.address });
          }}
          found={!!destPoint}
          placeholder="Search a town, region or country"
          maxLength={80}
        />
        <FoundNote found={destPoint} typed={destination} />
        <Row gap={space.md} align="flex-start">
          <DateTimeField mode="date" label="Starts" value={start} onChangeText={setStart} style={{ flex: 1 }} testID="settings-start" />
          <DateTimeField mode="date" label="Ends" value={end} onChangeText={setEnd} min={start || undefined} style={{ flex: 1 }} testID="settings-end" />
        </Row>
        {isOrganizer && active ? (
          <Button
            title={trip.date_window_start ? 'See which dates work for everyone' : 'Not sure? Ask the group which days work'}
            icon="calendar"
            kind="ghost"
            small
            onPress={() => router.push(`/trip/${id}/dates`)}
            testID="settings-find-dates"
            style={{ alignSelf: 'flex-start' }}
          />
        ) : null}
        <Button
          title="Save as a template"
          icon="copyAll"
          kind="ghost"
          small
          loading={busy === 'template'}
          onPress={async () => {
            setBusy('template');
            setTemplateNote(null);
            try {
              await saveTripAsTemplate(id, trip.name);
              await qc.invalidateQueries({ queryKey: keys.templates });
              setTemplateNote('Saved as a template, just for you: the plan, ideas, group tasks and your packing list. Start a new trip from it any time.');
            } catch (e) {
              setTemplateNote(errorMessage(e));
            } finally {
              setBusy(null);
            }
          }}
          testID="settings-template"
          style={{ alignSelf: 'flex-start' }}
        />
        {templateNote ? <Text variant="caption" muted testID="settings-template-note">{templateNote}</Text> : null}
        {isOrganizer ? (
          <Button title="Trip insights" icon="insights" kind="ghost" small onPress={() => router.push(`/trip/${id}/insights`)} testID="settings-insights" style={{ alignSelf: 'flex-start' }} />
        ) : null}
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

/** Your own setting: hear when people arrive at the trip's places. */
function ArrivalAlertsCard({ tripId }: { tripId: string }) {
  const qc = useQueryClient();
  const { myMembership } = useTripData(tripId);
  const [error, setError] = useState<string | null>(null);
  const on = myMembership?.arrival_alerts ?? true;
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }} gap={space.md}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label">Arrival alerts</Text>
          <Text variant="caption" muted>Get told when someone arrives at a place pinned with alerts, like where you&apos;re staying.</Text>
        </View>
        <Switch
          testID="arrival-alerts-switch"
          value={on}
          onValueChange={async (value) => {
            setError(null);
            try {
              await updateMySharing(tripId, { arrival_alerts: value });
              await qc.invalidateQueries({ queryKey: keys.members(tripId) });
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        />
      </Row>
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Card>
  );
}
