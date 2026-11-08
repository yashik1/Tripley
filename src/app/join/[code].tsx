import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';

import { Avatar, Banner, Button, Card, Field, Loading, Row, Screen, Stack, Text } from '@/components/ui';
import { isConfigured } from '@/config';
import { joinTripByCode, tripPreview } from '@/lib/api';
import { hasAuth } from '@/lib/auth-methods';
import { errorMessage } from '@/lib/errors';
import { formatDateRange } from '@/lib/format';
import { signInAsGuest } from '@/lib/guest';
import { clearPendingJoin, peekPendingJoin, setPendingJoin } from '@/lib/pending-join';
import { keys } from '@/lib/queries';
import { useAuth } from '@/providers/AuthProvider';
import { space } from '@/theme';

const accounts = hasAuth('password');
const otherSignIn = accounts || hasAuth('phone') || hasAuth('email') || hasAuth('google') || hasAuth('apple');

export default function JoinTrip() {
  const { code = '', auto } = useLocalSearchParams<{ code: string; auto?: string }>();
  const { session, profile } = useAuth();
  // New accounts without a name set it first; the invite is kept and finished after.
  const needsName = !!session && !!profile && !profile.display_name.trim();
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: ['preview', code, !!session],
    queryFn: () => tripPreview(code),
    enabled: isConfigured && !!code,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const autoTried = useRef(false);
  const p = preview.data;

  const join = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const tripId = await joinTripByCode(code);
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.trips }),
        qc.invalidateQueries({ queryKey: keys.sharing }),
      ]);
      router.replace(`/trip/${tripId}/map`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }, [code, qc]);

  // Finish joining automatically after signing in from this invite.
  useEffect(() => {
    if (!session || needsName || !p || p.is_member || autoTried.current) return;
    let cancelled = false;
    peekPendingJoin().then(async (pending) => {
      if (cancelled || autoTried.current) return;
      if (auto === '1' || pending === code) {
        autoTried.current = true;
        await clearPendingJoin();
        join();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session, needsName, p, auto, code, join]);

  if (needsName) return <Redirect href="/welcome" />;
  if (preview.isLoading) return <Loading />;

  if (!p) {
    return (
      <Screen>
        <Text variant="heading">This invite link doesn&apos;t work</Text>
        <Text muted>The trip may have ended, or the organizer made a new link. Ask them to send it again.</Text>
        <Button title="Go to my trips" kind="secondary" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  const signInFirst = async (to: '/sign-in' | '/sign-up' = '/sign-in') => {
    await setPendingJoin(code);
    router.push(to);
  };

  const joinAsGuest = async () => {
    setError(null);
    setBusy(true);
    try {
      await setPendingJoin(code);
      await signInAsGuest(guestName);
      // Once signed in, the effect above joins the trip.
    } catch (e) {
      await clearPendingJoin();
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const dates = formatDateRange(p.starts_on, p.ends_on);
  return (
    <Screen>
      <Card>
        <Text variant="caption" muted>{p.organizer_name} invited you to</Text>
        <Text variant="title">{p.name}</Text>
        {dates ? <Text muted>{dates}</Text> : null}
        <Row gap={-8} style={{ marginTop: space.sm }}>
          {p.member_names.map((n, i) => (
            <View key={`${n}-${i}`} style={{ marginRight: -8 }}>
              <Avatar id={`${p.trip_id}-${i}`} name={n} size={34} ring="#fff" />
            </View>
          ))}
          <Text muted style={{ marginLeft: space.lg }}>
            {p.member_count} {p.member_count === 1 ? 'person' : 'people'} going
          </Text>
        </Row>
      </Card>
      <Stack gap={space.sm}>
        <Text variant="label">When you join</Text>
        <Text muted>• Everyone on the trip can see where you are on the map until the trip ends. You can pause anytime.</Text>
        <Text muted>• You can add bills and see what you owe. The app does all the maths.</Text>
      </Stack>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {p.is_member ? (
        <Button title="Open trip" onPress={() => router.replace(`/trip/${p.trip_id}/map`)} />
      ) : session ? (
        <Button title="Join trip" onPress={join} loading={busy} testID="join-trip" />
      ) : (
        <Stack gap={space.lg}>
          {accounts ? (
            <Stack gap={space.sm}>
              <Button title="Create an account and join" onPress={() => signInFirst('/sign-up')} testID="join-signup" />
              <Button title="I have an account, log in" kind="secondary" onPress={() => signInFirst('/sign-in')} testID="join-trip" />
              <Text variant="caption" faint center>Your trips, bills and balances are saved to your account.</Text>
            </Stack>
          ) : null}
          {hasAuth('guest') ? (
            <Stack gap={space.sm}>
              {accounts ? <Text variant="label">Or join as a guest</Text> : null}
              <Field
                label="Your name"
                testID="join-guest-name"
                value={guestName}
                onChangeText={setGuestName}
                placeholder="So friends know who you are"
                autoComplete="name"
                maxLength={60}
                onSubmitEditing={joinAsGuest}
              />
              <Button title={accounts ? 'Join as guest' : 'Join trip'} kind={accounts ? 'secondary' : 'primary'} onPress={joinAsGuest} loading={busy} testID="join-as-guest" />
              <Text variant="caption" faint center>
                {accounts ? 'No sign-up needed. A guest account lives only in this browser; you can save it later.' : 'No sign-up needed. Your account stays on this device.'}
              </Text>
              {otherSignIn && !accounts ? <Button title="I have an account, sign in" kind="ghost" small onPress={() => signInFirst('/sign-in')} testID="join-trip" /> : null}
            </Stack>
          ) : !accounts ? (
            <Button title="Sign in to join" onPress={() => signInFirst('/sign-in')} testID="join-trip" />
          ) : null}
        </Stack>
      )}
      {Platform.OS === 'web' ? (
        <Banner tone="info" title="Get the app for the best experience" icon="location">
          In the browser your location only updates while this page is open. Install Tripley on your phone to keep sharing when it&apos;s closed.
        </Banner>
      ) : null}
    </Screen>
  );
}
