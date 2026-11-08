import { useQueryClient } from '@tanstack/react-query';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { TripMap } from '@/components/TripMap';
import type { MapPerson } from '@/components/TripMap.types';
import { Avatar, Banner, Button, Chip, initials, Row, Text } from '@/components/ui';
import { updateMySharing } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { isStale, timeAgo } from '@/lib/format';
import { keys, useLocations } from '@/lib/queries';
import { useTripData } from '@/lib/trip-hooks';
import type { Member } from '@/lib/types';
import { useSharing } from '@/providers/SharingProvider';
import { colorFor, radius, space, useTheme } from '@/theme';

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  if (km < 10) return `${km.toFixed(1)} km away`;
  return `${Math.round(km)} km away`;
}

function directionsUrl(lat: number, lng: number): string {
  return Platform.OS === 'ios'
    ? `http://maps.apple.com/?daddr=${lat},${lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export default function TripMapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const qc = useQueryClient();
  const { me, members, byId, myMembership, active } = useTripData(id);
  const locations = useLocations(id);
  const sharing = useSharing();
  const [now, setNow] = useState(Date.now());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [keepAwake, setKeepAwake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!keepAwake) return;
    activateKeepAwakeAsync('tripley-map').catch(() => undefined);
    return () => {
      deactivateKeepAwake('tripley-map').catch(() => undefined);
    };
  }, [keepAwake]);

  const people: MapPerson[] = useMemo(
    () =>
      (locations.data ?? [])
        .filter((l) => byId.has(l.user_id))
        .map((l) => {
          const m = byId.get(l.user_id)!;
          return {
            id: l.user_id,
            name: m.profile.display_name || 'Friend',
            initials: initials(m.profile.display_name || '?'),
            color: colorFor(l.user_id),
            lat: l.lat,
            lng: l.lng,
            ago: timeAgo(l.updated_at, now),
            stale: isStale(l.updated_at, m.sharing_mode, now),
            isMe: l.user_id === me,
          };
        }),
    [locations.data, byId, me, now],
  );
  const myPos = people.find((p) => p.isMe);
  const focused = people.find((p) => p.id === focusId);
  const sharingOn = myMembership?.location_sharing ?? false;

  const setMySharing = async (patch: { location_sharing?: boolean; sharing_mode?: 'live' | 'saver' }) => {
    setBusy(true);
    setError(null);
    try {
      await updateMySharing(id, patch);
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.members(id) }),
        qc.invalidateQueries({ queryKey: keys.locations(id) }),
        qc.invalidateQueries({ queryKey: keys.sharing }),
      ]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TripMap people={people} focusId={focusId} onSelect={setFocusId} fitToken={fitToken} />

      <View style={styles.topOverlay} pointerEvents="box-none">
        <StatusBanner
          active={active}
          sharingOn={sharingOn}
          busy={busy}
          onResume={() => setMySharing({ location_sharing: true })}
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </View>

      <View style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.border }]}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="heading">Who&apos;s where</Text>
          <Row gap={space.xs}>
            <Chip label={keepAwake ? 'Screen on' : 'Keep screen on'} selected={keepAwake} onPress={() => setKeepAwake((v) => !v)} />
            <Chip label="Fit all" onPress={() => { setFocusId(null); setFitToken((n) => n + 1); }} />
          </Row>
        </Row>

        <ScrollView style={{ maxHeight: 200 }} contentContainerStyle={{ gap: 2 }}>
          {members.map((m) => (
            <MemberRow
              key={m.user_id}
              m={m}
              me={me}
              location={people.find((p) => p.id === m.user_id)}
              myPos={myPos}
              focused={focusId === m.user_id}
              onPress={() => setFocusId(m.user_id)}
            />
          ))}
        </ScrollView>

        {focused && !focused.isMe ? (
          <Button
            title={`Directions to ${focused.name.split(' ')[0]}`}
            icon="directions"
            kind="secondary"
            small
            onPress={() => Linking.openURL(directionsUrl(focused.lat, focused.lng))}
          />
        ) : null}

        {active && sharingOn ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <Row gap={space.xs}>
              <Chip
                label="Live"
                selected={myMembership?.sharing_mode === 'live'}
                onPress={() => setMySharing({ sharing_mode: 'live' })}
              />
              <Chip
                label="Battery saver"
                selected={myMembership?.sharing_mode === 'saver'}
                onPress={() => setMySharing({ sharing_mode: 'saver' })}
              />
            </Row>
            <Button title="Pause" icon="pause" kind="secondary" small loading={busy} onPress={() => setMySharing({ location_sharing: false })} />
          </Row>
        ) : null}
        {!sharing.supportsBackground ? null : sharing.status === 'background' && sharingOn ? (
          <Text variant="caption" faint>Sharing even when Tripley is closed. Stops when the trip ends.</Text>
        ) : null}
      </View>
    </View>
  );
}

function StatusBanner({
  active,
  sharingOn,
  busy,
  onResume,
}: {
  active: boolean;
  sharingOn: boolean;
  busy: boolean;
  onResume: () => void;
}) {
  const sharing = useSharing();
  if (!active) {
    return <Banner tone="info" icon="location" title="This trip has ended">Location sharing is off for this trip.</Banner>;
  }
  if (!sharingOn) {
    return (
      <Banner
        tone="warning"
        icon="pause"
        title="You're hidden"
        action={<Button title="Resume sharing" small icon="play" onPress={onResume} loading={busy} />}>
        Friends can&apos;t see you on this trip until you resume.
      </Banner>
    );
  }
  switch (sharing.status) {
    case 'needs-permission':
      return (
        <Banner
          tone="info"
          icon="location"
          title="Share your location with the group"
          action={<Button title="Turn on location" small onPress={sharing.enable} testID="enable-location" />}>
          {sharing.supportsBackground
            ? 'Choose "Allow While Using", then "Change to Always Allow" so friends can still see you when the app is closed.'
            : 'Your browser will ask for permission.'}
        </Banner>
      );
    case 'denied':
      return (
        <Banner
          tone="danger"
          icon="location"
          title="Location is off for Tripley"
          action={sharing.supportsBackground ? <Button title="Open settings" small kind="secondary" onPress={sharing.openSettings} /> : undefined}>
          {sharing.supportsBackground
            ? 'Turn on location for Tripley in Settings (choose "Always").'
            : 'Allow location for this site in your browser settings, then reload.'}
        </Banner>
      );
    case 'foreground':
      return sharing.supportsBackground ? (
        <Banner
          tone="warning"
          icon="location"
          title="Only sharing while Tripley is open"
          action={<Button title="Allow always" small kind="secondary" onPress={sharing.enable} />}>
          Allow location &quot;Always&quot; so friends can see you when the app is closed.
        </Banner>
      ) : (
        <Banner tone="info" icon="location" title="Sharing while this page is open">
          Install the Tripley app to keep sharing when it&apos;s closed.
        </Banner>
      );
    case 'unavailable':
      return <Banner tone="warning" icon="location" title="Location services are off">Turn on location services on this device.</Banner>;
    default:
      return null;
  }
}

function MemberRow({
  m,
  me,
  location,
  myPos,
  focused,
  onPress,
}: {
  m: Member;
  me: string;
  location?: MapPerson;
  myPos?: MapPerson;
  focused: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const name = m.user_id === me ? 'You' : m.profile.display_name || 'Friend';
  let status: string;
  if (!m.location_sharing) status = 'Paused sharing';
  else if (!location) status = 'No location yet';
  else {
    const dist = myPos && !location.isMe ? ` · ${formatDistance(distanceKm(myPos, location))}` : '';
    status = `${location.stale ? 'Last seen' : 'Updated'} ${location.ago}${dist}`;
  }
  return (
    <Pressable
      onPress={location ? onPress : undefined}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md },
        focused && { backgroundColor: t.surfaceAlt },
        pressed && { opacity: 0.7 },
      ]}>
      <Avatar id={m.user_id} name={m.profile.display_name || '?'} url={m.profile.avatar_url} size={34} dimmed={!location || location.stale} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '500' }} numberOfLines={1}>{name}</Text>
        <Text variant="caption" muted numberOfLines={1}>{status}</Text>
      </View>
      {location ? <Icon name="myLocation" size={18} color={t.textFaint} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topOverlay: { position: 'absolute', top: space.md, left: space.md, right: space.md, gap: space.sm },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.md,
  },
});
