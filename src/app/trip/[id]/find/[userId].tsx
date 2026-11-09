/**
 * "Lost friend" finder: a big arrow to a friend and how far they are, for busy
 * places (festivals, markets, stations). Turns with the phone's compass when
 * there is one; otherwise it points relative to north (N at the top).
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Avatar, Banner, Button, Screen, Stack as Col, Text } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { arrowAngle, bearingDegrees, compassWord, distanceMeters, formatMeters } from '@/lib/geo';
import { directionsUrl } from '@/lib/map-links';
import { useLocations } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { useCompass, useMyFix } from '@/location/compass';
import { space, useTheme } from '@/theme';

const DIAL = 260;

export default function FindFriend() {
  const id = useTripId();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const t = useTheme();
  const { me, nameOf, byId } = useTripData(id);
  const locations = useLocations(id);
  const compass = useCompass();
  const fix = useMyFix();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const name = nameOf(userId);
  const first = name.split(' ')[0];
  const theirs = locations.data?.find((l) => l.user_id === userId);
  const mineShared = locations.data?.find((l) => l.user_id === me);
  const mine = fix ?? (mineShared ? { lat: mineShared.lat, lng: mineShared.lng, accuracy: mineShared.accuracy_m } : null);
  const member = byId.get(userId);

  if (!theirs || !mine) {
    return (
      <Screen>
        <Stack.Screen options={{ title: `Find ${first}` }} />
        <Banner tone="info" icon="location" title={!theirs ? `${first} isn't sharing a location` : 'Waiting for your location'}>
          {!theirs
            ? `When ${first} shares their location on this trip, an arrow here points to them.`
            : 'Allow location for Tripley so the arrow knows where you are.'}
        </Banner>
        <Button title="Back to the map" kind="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const dist = distanceMeters(mine, theirs);
  const bearing = bearingDegrees(mine, theirs);
  const angle = arrowAngle(bearing, compass.heading);
  const close = dist < 15;
  const fuzz = Math.round((theirs.accuracy_m ?? 0) + (mine.accuracy ?? 0));

  return (
    <Screen>
      <Stack.Screen options={{ title: `Find ${first}` }} />
      <View style={{ alignItems: 'center', gap: space.md, paddingTop: space.md }}>
        <Avatar id={userId} name={name} url={member?.profile.avatar_url} size={56} />
        <Text variant="caption" muted>
          {first}&apos;s location updated {timeAgo(theirs.updated_at, now)}
        </Text>

        <View
          testID="finder-dial"
          style={{
            width: DIAL,
            height: DIAL,
            borderRadius: DIAL / 2,
            borderWidth: 2,
            borderColor: t.border,
            backgroundColor: t.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          {/* North marker: fixed at the top without a compass; turns with the phone when there is one. */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              width: DIAL,
              height: DIAL,
              alignItems: 'center',
              transform: [{ rotate: `${-(compass.heading ?? 0)}deg` }],
            }}>
            <Text variant="label" color={t.danger} style={{ marginTop: 8 }}>N</Text>
          </View>
          {close ? (
            <Text style={{ fontSize: 44 }}>👋</Text>
          ) : (
            <View testID="finder-arrow" style={{ transform: [{ rotate: `${angle}deg` }] }}>
              <View
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: 60,
                  backgroundColor: t.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Icon name="arrowUp" size={72} color={t.primaryText} />
              </View>
            </View>
          )}
        </View>

        <Col gap={2} style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 40, lineHeight: 48, fontWeight: '800' }} testID="finder-distance">
            {close ? 'Right here' : formatMeters(dist)}
          </Text>
          {!close ? (
            <Text muted style={{ fontSize: 18, lineHeight: 24 }} center>
              {compass.heading != null ? `Follow the arrow · ${compassWord(bearing)}` : `${first} is ${compassWord(bearing)} of you`}
            </Text>
          ) : (
            <Text muted>Look around, {first} should be close.</Text>
          )}
          {fuzz > 30 ? <Text variant="caption" faint>Locations are accurate to about {formatMeters(fuzz)}.</Text> : null}
        </Col>
      </View>

      {compass.request ? (
        <Button title="Use my phone's compass" icon="navigate" onPress={compass.request} />
      ) : compass.heading == null ? (
        <Text variant="caption" faint center>
          No compass on this device, so the arrow points relative to north (N at the top).
        </Text>
      ) : null}
      <Button
        title={`Directions to ${first}`}
        icon="directions"
        kind="secondary"
        onPress={() => Linking.openURL(directionsUrl(theirs.lat, theirs.lng))}
      />
    </Screen>
  );
}
