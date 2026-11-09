/**
 * The signed-in home: a welcome, the trip that matters most right now, quick
 * actions, reminders worked out from the group's real data, recent activity,
 * and the rest of your trips. New users get a short onboarding instead.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack as RouterStack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';

import { Brand } from '@/components/AuthLayout';
import { Icon, type IconName } from '@/components/Icon';
import { AvatarStack, Postcard, ProgressBar, QuickAction, Skeleton, StatusPill, TripCover } from '@/components/Travel';
import { Avatar, Banner, Button, Card, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { respondToInvitation } from '@/lib/api';
import { formatMoney } from '@/lib/currency';
import { errorMessage } from '@/lib/errors';
import { firstName, formatDateRange, timeAgo, todayISO } from '@/lib/format';
import { isGuest } from '@/lib/guest';
import { notificationIcon, openNotification } from '@/lib/notification-routes';
import { takePendingJoin } from '@/lib/pending-join';
import { keys, useInvitations, useItinerary, useNotifications, useRsvps, useTripOverview, useTrips } from '@/lib/queries';
import { featuredTrip, greeting, planningSteps, tripStatus } from '@/lib/trip-status';
import type { TripStats, TripWithCount } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { radius, space, useTheme } from '@/theme';

export function Dashboard() {
  const t = useTheme();
  const qc = useQueryClient();
  const { profile, user } = useAuth();
  const me = user?.id ?? '';
  const trips = useTrips();
  const overview = useTripOverview();
  const invitations = useInvitations();
  const notifications = useNotifications();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = todayISO();

  useEffect(() => {
    takePendingJoin().then((code) => {
      if (code) router.push({ pathname: '/join/[code]', params: { code, auto: '1' } });
    });
  }, []);

  const all = useMemo(() => trips.data ?? [], [trips.data]);
  const featured = useMemo(() => featuredTrip(all, today), [all, today]);
  const others = all.filter((x) => x.id !== featured?.id && tripStatus(x, today).kind !== 'completed');
  const completed = all.filter((x) => x.id !== featured?.id && tripStatus(x, today).kind === 'completed');
  const unread = (notifications.data ?? []).filter((n) => !n.read_at).length;
  const name = firstName(profile?.display_name || 'there');
  const status = featured ? tripStatus(featured, today) : null;
  const welcome = !featured
    ? all.length
      ? 'Where to next? Start planning your next trip.'
      : 'Plan trips together, share the moments, and split the bills fairly.'
    : status?.kind === 'ongoing'
      ? `You're on ${featured.name}${status.countdown ? ` (${status.countdown.toLowerCase()})` : ''}. Have a great day!`
      : status?.kind === 'upcoming'
        ? `${status.daysToGo === 1 ? '1 day' : `${status.daysToGo} days`} until ${featured.name}. Let's get ready!`
        : `${featured.name} is taking shape. Pick some dates when you're ready.`;

  const refresh = () => {
    trips.refetch();
    overview.refetch();
    invitations.refetch();
    notifications.refetch();
  };

  const respond = async (id: string, accept: boolean) => {
    setBusy(id);
    setError(null);
    try {
      const tripId = await respondToInvitation(id, accept);
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.invitations }),
        qc.invalidateQueries({ queryKey: keys.trips }),
        qc.invalidateQueries({ queryKey: keys.overview }),
        qc.invalidateQueries({ queryKey: keys.sharing }),
      ]);
      if (accept) router.push(`/trip/${tripId}/overview`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const goTripOr = (path: string) => (featured ? router.push(`/trip/${featured.id}/${path}`) : router.push('/trips/new'));

  return (
    <>
      <RouterStack.Screen
        options={{
          headerShown: true,
          title: 'Tripley',
          headerTitle: () => <Brand size={18} onPress={() => router.push('/home')} testID="header-home" />,
        }}
      />
      <Screen refreshControl={<RefreshControl refreshing={trips.isRefetching} onRefresh={refresh} />}>
        {/* A. Welcome */}
        <Row gap={space.md} align="center">
          <Pressable accessibilityRole="button" accessibilityLabel="Your profile" onPress={() => router.push('/profile')} testID="home-profile">
            <Avatar id={me || 'me'} name={profile?.display_name || '?'} url={profile?.avatar_url} size={48} ring={t.primarySoft} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text variant="caption" muted>{greeting(new Date().getHours())}</Text>
            <Text variant="title" numberOfLines={1}>Hi {name} 👋</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
            onPress={() => router.push('/notifications')}
            testID="home-bell"
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center', boxShadow: t.shadow }}>
            <Icon name="bell" size={22} color={t.text} />
            {unread > 0 ? (
              <View
                style={{
                  position: 'absolute', top: 4, right: 4, minWidth: 18, height: 18, borderRadius: 9,
                  backgroundColor: t.coral, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
                }}>
                <Text variant="caption" color={t.text} style={{ fontSize: 10, lineHeight: 12, fontWeight: '800' }}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            ) : null}
          </Pressable>
        </Row>
        <Text muted style={{ marginTop: -space.sm }}>{welcome}</Text>

        {isGuest(user) ? (
          <Banner
            tone="warning"
            title="Save your account"
            icon="person"
            action={<Button title="Save my account" small onPress={() => router.push('/profile')} testID="home-save-account" style={{ alignSelf: 'flex-start' }} />}>
            You&apos;re using a guest account, which only lives in this browser. Add an email and password to keep your trips and log in anywhere.
          </Banner>
        ) : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}

        {(invitations.data ?? []).length > 0 ? (
          <Stack gap={space.sm}>
            <SectionTitle>Invitations</SectionTitle>
            {invitations.data!.map((inv) => (
              <Card key={inv.invitation_id}>
                <Row gap={space.md}>
                  <View style={{ width: 52, height: 52, borderRadius: radius.md, overflow: 'hidden' }}>
                    <Postcard seed={inv.trip_id} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="heading" numberOfLines={1}>{inv.trip_name}</Text>
                    <Text variant="caption" muted>
                      {inv.invited_by_name} invited you · {inv.member_count} {inv.member_count === 1 ? 'person' : 'people'}
                      {formatDateRange(inv.starts_on, inv.ends_on) ? ` · ${formatDateRange(inv.starts_on, inv.ends_on)}` : ''}
                    </Text>
                  </View>
                </Row>
                <Row>
                  <Button title="Join trip" small onPress={() => respond(inv.invitation_id, true)} loading={busy === inv.invitation_id} style={{ flex: 1 }} />
                  <Button title="Decline" small kind="secondary" onPress={() => respond(inv.invitation_id, false)} style={{ flex: 1 }} />
                </Row>
              </Card>
            ))}
          </Stack>
        ) : null}

        {trips.isLoading ? (
          <Stack gap={space.md}>
            <Skeleton height={300} rounded={radius.lg} />
            <Row gap={space.sm}>
              {[0, 1, 2].map((i) => <Skeleton key={i} height={92} rounded={radius.lg} style={{ flex: 1 }} />)}
            </Row>
          </Stack>
        ) : trips.error && all.length === 0 ? (
          <Banner tone="danger" title="Couldn't load your trips" action={<Button title="Try again" small kind="secondary" onPress={refresh} />}>
            {errorMessage(trips.error)}
          </Banner>
        ) : all.length === 0 ? (
          <Onboarding />
        ) : (
          <>
            {/* B. The trip that matters most right now */}
            {featured ? <FeaturedTrip trip={featured} stats={overview.data?.[featured.id]} /> : null}

            {/* C. Quick actions */}
            <Stack gap={space.sm}>
              <SectionTitle>Quick actions</SectionTitle>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                <QuickAction icon="add" label="Create a trip" color={t.primary} soft={t.primarySoft} onPress={() => router.push('/trips/new')} testID="new-trip" />
                <QuickAction icon="ticket" label="Join a trip" color={t.coralText} soft={t.coralSoft} onPress={() => router.push('/join')} testID="join-trip-code" />
                <QuickAction icon="personAdd" label="Invite friends" color={t.yellowText} soft={t.yellowSoft} onPress={() => goTripOr('invite')} testID="quick-invite" />
                <QuickAction icon="explore" label="Explore ideas" color={t.sky} soft={t.skySoft} onPress={() => router.push('/explore')} testID="quick-explore" />
                <QuickAction icon="calendar" label="Add an activity" color={t.accent} soft={t.primarySoft} onPress={() => goTripOr('plan/new')} testID="quick-activity" />
              </View>
            </Stack>

            {/* E. Reminders from real data */}
            {featured ? <Reminders trip={featured} stats={overview.data?.[featured.id]} me={me} /> : null}

            {/* D. Recent activity */}
            {(notifications.data ?? []).length > 0 ? (
              <Stack gap={space.sm}>
                <SectionTitle action={<Button title="See all" kind="ghost" small onPress={() => router.push('/notifications')} />}>Recent activity</SectionTitle>
                <Card style={{ paddingVertical: space.xs, gap: 0 }}>
                  {notifications.data!.slice(0, 5).map((n, i) => (
                    <Pressable
                      key={n.id}
                      onPress={() => openNotification(n)}
                      accessibilityRole="button"
                      style={({ pressed }) => ({
                        flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: space.sm,
                        borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.border, opacity: pressed ? 0.7 : 1,
                      })}>
                      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: n.read_at ? t.surfaceAlt : t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={notificationIcon(n.kind)} size={18} color={n.read_at ? t.textMuted : t.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text variant="caption" numberOfLines={2} style={{ fontWeight: n.read_at ? '400' : '600' }}>{n.body}</Text>
                        <Text variant="caption" faint>{n.title} · {timeAgo(n.created_at)}</Text>
                      </View>
                    </Pressable>
                  ))}
                </Card>
              </Stack>
            ) : null}

            {/* The rest of your trips */}
            {others.length > 0 ? (
              <Stack gap={space.sm}>
                <SectionTitle>{featured ? 'More trips' : 'Your trips'}</SectionTitle>
                {others.map((trip) => <TripCard key={trip.id} trip={trip} stats={overview.data?.[trip.id]} me={me} />)}
              </Stack>
            ) : null}
            {completed.length > 0 ? (
              <Stack gap={space.sm}>
                <SectionTitle>Completed trips</SectionTitle>
                {completed.map((trip) => <TripCard key={trip.id} trip={trip} stats={overview.data?.[trip.id]} me={me} />)}
              </Stack>
            ) : null}
          </>
        )}
      </Screen>
    </>
  );
}

function people(trip: TripWithCount) {
  return (trip.members ?? []).map((m) => ({ id: m.user_id, name: m.profile?.display_name || 'Friend', url: m.profile?.avatar_url }));
}

function FeaturedTrip({ trip, stats }: { trip: TripWithCount; stats?: TripStats }) {
  const t = useTheme();
  const today = todayISO();
  const status = tripStatus(trip, today);
  const progress = planningSteps(trip, stats);
  const next = progress.steps.find((s) => !s.done);
  const count = trip.trip_members?.[0]?.count ?? 1;
  const dates = formatDateRange(trip.starts_on, trip.ends_on);
  const open = () => router.push(`/trip/${trip.id}/overview`);
  return (
    <Card raised style={{ padding: 0, gap: 0, overflow: 'hidden' }} testID="featured-trip">
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`Open ${trip.name}`}>
        <TripCover seed={trip.id} path={trip.cover_path} height={168} rounded={0}>
          {status.countdown ? (
            <View style={{ position: 'absolute', top: space.md, left: space.md, backgroundColor: t.surface, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, boxShadow: t.shadow }}>
              <Text variant="label" color={t.text} testID="featured-countdown">
                {status.kind === 'upcoming' ? '✈️ ' : '📍 '}
                {status.countdown}
              </Text>
            </View>
          ) : null}
        </TripCover>
      </Pressable>
      <View style={{ padding: space.lg, gap: space.md }}>
        <View style={{ gap: 4 }}>
          <StatusPill kind={status.kind} label={status.label} />
          <Text variant="title" style={{ fontSize: 24, lineHeight: 30 }} numberOfLines={2}>{trip.name}</Text>
          <Text muted numberOfLines={1}>{[trip.destination, dates ?? 'No dates yet'].filter(Boolean).join(' · ')}</Text>
        </View>
        <Row gap={space.sm}>
          <AvatarStack people={people(trip)} total={count} />
          <Text variant="caption" muted>{count === 1 ? 'Just you so far' : `${count} travellers`}</Text>
        </Row>
        {status.kind !== 'completed' ? (
          <View style={{ gap: 6 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="label">Planning progress</Text>
              <Text variant="label" color={t.primary} testID="featured-progress">{progress.percent}%</Text>
            </Row>
            <ProgressBar value={progress.percent} label={`Planning ${progress.done} of ${progress.steps.length} done`} />
            <Text variant="caption" muted>
              {next ? `${progress.done} of ${progress.steps.length} done · Next: ${next.label.toLowerCase()}` : 'Everything’s set. Enjoy the trip!'}
            </Text>
          </View>
        ) : null}
        <Button title="Open trip" icon="trip" onPress={open} testID="open-featured-trip" />
      </View>
    </Card>
  );
}

/** Nudges that come from the group's actual plans. Nothing is shown without real data behind it. */
function Reminders({ trip, stats, me }: { trip: TripWithCount; stats?: TripStats; me: string }) {
  const t = useTheme();
  const itinerary = useItinerary(trip.id);
  const rsvps = useRsvps(trip.id);
  const today = todayISO();
  const items: { key: string; icon: IconName; text: string; onPress: () => void; color: string; soft: string }[] = [];
  const unanswered = (itinerary.data ?? []).filter(
    (i) => i.day >= today && !(rsvps.data ?? []).some((r) => r.item_id === i.id && r.user_id === me),
  );
  if (unanswered.length > 0) {
    items.push({
      key: 'rsvp',
      icon: 'calendar',
      text: unanswered.length === 1 ? `Say if you're coming to "${unanswered[0].title}"` : `Say if you're coming to ${unanswered.length} plans`,
      onPress: () => router.push(`/trip/${trip.id}/plan`),
      color: t.primary,
      soft: t.primarySoft,
    });
  }
  if (stats && Number(stats.members) < 2) {
    items.push({ key: 'invite', icon: 'personAdd', text: 'Invite your travel buddies', onPress: () => router.push(`/trip/${trip.id}/invite`), color: t.yellowText, soft: t.yellowSoft });
  }
  if (stats && !stats.stay_pinned && tripStatus(trip, today).kind !== 'completed') {
    items.push({ key: 'stay', icon: 'pin', text: "Pin where you're staying", onPress: () => router.push(`/trip/${trip.id}/map`), color: t.coralText, soft: t.coralSoft });
  }
  if (stats && Number(stats.stops) === 0 && (itinerary.data ?? []).length === 0) {
    items.push({ key: 'plan', icon: 'idea', text: 'Add the first plan to the itinerary', onPress: () => router.push(`/trip/${trip.id}/plan/new`), color: t.sky, soft: t.skySoft });
  }
  if (items.length === 0) return null;
  return (
    <Stack gap={space.sm}>
      <SectionTitle>To do for {trip.name}</SectionTitle>
      <Card style={{ paddingVertical: space.xs, gap: 0 }} testID="reminders">
        {items.slice(0, 4).map((r, i) => (
          <Pressable
            key={r.key}
            onPress={r.onPress}
            accessibilityRole="button"
            testID={`reminder-${r.key}`}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm,
              borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.border, opacity: pressed ? 0.7 : 1,
            })}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: r.soft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={r.icon} size={18} color={r.color} />
            </View>
            <Text style={{ flex: 1 }}>{r.text}</Text>
            <Icon name="chevron" size={16} color={t.textFaint} />
          </Pressable>
        ))}
      </Card>
    </Stack>
  );
}

export function TripCard({ trip, stats, me }: { trip: TripWithCount; stats?: TripStats; me: string }) {
  const status = tripStatus(trip, todayISO());
  const count = trip.trip_members?.[0]?.count ?? 1;
  const dates = formatDateRange(trip.starts_on, trip.ends_on);
  const progress = planningSteps(trip, stats);
  return (
    <Card onPress={() => router.push(`/trip/${trip.id}/overview`)} accessibilityLabel={`Open ${trip.name}`} testID={`trip-card-${trip.name}`}>
      <Row gap={space.md} align="flex-start">
        <TripCover seed={trip.id} path={trip.cover_path} height={72} rounded={radius.md} style={{ width: 72 }} />
        <View style={{ flex: 1, gap: 4 }}>
          <Row gap={space.sm} style={{ justifyContent: 'space-between' }}>
            <Text variant="heading" numberOfLines={1} style={{ flex: 1 }}>{trip.name}</Text>
            <StatusPill kind={status.kind} label={status.countdown ?? status.label} />
          </Row>
          <Text variant="caption" muted numberOfLines={1}>
            {[trip.destination, dates, trip.organizer_id === me ? 'You organize' : null].filter(Boolean).join(' · ') || `${trip.base_currency} trip`}
          </Text>
          <Row gap={space.sm}>
            <AvatarStack people={people(trip)} total={count} size={24} />
            {status.kind === 'completed' ? (
              stats && Number(stats.spent_base_minor) > 0 ? (
                <Text variant="caption" faint>{formatMoney(Number(stats.spent_base_minor), trip.base_currency)} spent together</Text>
              ) : null
            ) : (
              <View style={{ flex: 1, gap: 2 }}>
                <ProgressBar value={progress.percent} height={6} label={`Planning ${progress.percent}%`} />
                <Text variant="caption" faint style={{ fontSize: 11 }}>Planning {progress.percent}%</Text>
              </View>
            )}
          </Row>
        </View>
      </Row>
    </Card>
  );
}

function Onboarding() {
  const t = useTheme();
  const steps: { icon: IconName; title: string; body: string; color: string; soft: string }[] = [
    { icon: 'trip', title: 'Start a trip', body: 'Give it a name, pick the currency and dates.', color: t.primary, soft: t.primarySoft },
    { icon: 'personAdd', title: 'Invite your friends', body: 'Share one link on WhatsApp or by text.', color: t.coralText, soft: t.coralSoft },
    { icon: 'map', title: 'Plan, share and split', body: 'A live map, a shared plan, and bills split fairly.', color: t.yellowText, soft: t.yellowSoft },
  ];
  return (
    <Card raised style={{ padding: 0, gap: 0, overflow: 'hidden' }} testID="onboarding">
      <View style={{ height: 150 }}>
        <Postcard seed="tripley-welcome" emoji="✈️" />
      </View>
      <View style={{ padding: space.lg, gap: space.lg }}>
        <View style={{ gap: 4 }}>
          <Text variant="title" style={{ fontSize: 24, lineHeight: 30 }}>Plan your first trip together</Text>
          <Text muted>Everything your group needs in one place, before, during and after the trip.</Text>
        </View>
        {steps.map((s, i) => (
          <Row key={s.title} gap={space.md} align="flex-start">
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: s.soft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={s.icon} size={20} color={s.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="label">{i + 1}. {s.title}</Text>
              <Text variant="caption" muted>{s.body}</Text>
            </View>
          </Row>
        ))}
        <Button title="Create your first trip" icon="add" onPress={() => router.push('/trips/new')} testID="new-trip" />
        <Row>
          <Button title="Join with a code" kind="secondary" small onPress={() => router.push('/join')} style={{ flex: 1 }} testID="join-trip-code" />
          <Button title="Explore ideas" kind="secondary" small onPress={() => router.push('/explore')} style={{ flex: 1 }} />
        </Row>
      </View>
    </Card>
  );
}
