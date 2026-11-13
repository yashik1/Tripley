/**
 * A trip at a glance: the destination header, who's coming, what's next,
 * planning progress (from real data), quick actions and a summary of every
 * part of the trip with a way into each.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { AvatarStack, ProgressBar, QuickAction, StatusPill, TripCover } from '@/components/Travel';
import { Banner, Button, Card, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { toSettlementRows } from '@/lib/api';
import { summarizeForUser, computePairBalances } from '@/lib/balances';
import { formatMoney } from '@/lib/currency';
import { formatDate, formatDateRange, todayISO } from '@/lib/format';
import { rsvpSummary, timeRange } from '@/lib/itinerary';
import { useAvailability, useBookings, useStays, useChallenges, useFeed, useItinerary, usePlaces, usePolls, useRsvps, useSettlements, useShareRows, useSuggestions, useTasks, useTripOverview } from '@/lib/queries';
import { packingStep, progress as taskProgress } from '@/lib/preparation';
import { pollIsOpen } from '@/lib/group-decisions';
import { sortBookings } from '@/lib/documents';
import { ActivityRow } from '@/components/ActivityRow';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { planningSteps, tripStatus } from '@/lib/trip-status';
import { radius, space, useTheme } from '@/theme';

export default function TripOverview() {
  const id = useTripId();
  const t = useTheme();
  const { trip, members, me, isOrganizer, active, refetch } = useTripData(id);
  const overview = useTripOverview();
  const itinerary = useItinerary(id);
  const rsvps = useRsvps(id);
  const places = usePlaces(id);
  const shares = useShareRows(id);
  const settlements = useSettlements(id);
  const today = todayISO();
  const stats = overview.data?.[id];
  const feed = useFeed(id);
  const ideas = useSuggestions(id);
  const tasks = useTasks(id);
  const challenges = useChallenges(id);
  const packing = taskProgress((tasks.data ?? []).filter((x) => x.kind === 'packing'));
  const groupTasks = taskProgress((tasks.data ?? []).filter((x) => x.kind === 'group'));
  const polls = usePolls(id);
  const availability = useAvailability(id);
  const stays = useStays(id);
  const bookings = useBookings(id);
  const nextBooking = sortBookings((bookings.data ?? []).filter((b) => b.start_day && b.start_day >= todayISO()))[0];
  const myBedMissing = (stays.data?.stays ?? []).some(
    (s) => (stays.data?.rooms ?? []).some((r) => r.stay_id === s.id) && !(stays.data?.guests ?? []).some((g) => g.stay_id === s.id && g.user_id === me),
  );
  const [welcomeHidden, setWelcomeHidden] = useState(false);
  // When this screen opened, for "did you just join?".
  const [openedAt] = useState(() => Date.now());
  const latest = (feed.data?.pages[0] ?? []).slice(0, 3);

  const base = trip?.base_currency ?? 'USD';
  const spent = (shares.data ?? []).reduce((a, s) => a + s.amountBaseMinor, 0);
  const myNet = useMemo(
    () => summarizeForUser(computePairBalances(shares.data ?? [], toSettlementRows(settlements.data ?? [])), me).netMinor,
    [shares.data, settlements.data, me],
  );
  const upcoming = (itinerary.data ?? []).filter((i) => i.day >= today).slice(0, 3);

  if (!trip) return <Screen>{null}</Screen>;
  const status = tripStatus(trip, today);
  // Live trip data wins over the dashboard summary, which may be a moment old.
  const progress = planningSteps(trip, {
    ...stats,
    members: members.length || Number(stats?.members ?? 1),
    stops: itinerary.data?.length ?? Number(stats?.stops ?? 0),
    stay_pinned: places.data ? places.data.some((p) => p.kind === 'stay') : !!stats?.stay_pinned,
  }, [packingStep(packing.total ? { packing_total: packing.total, packing_done: packing.done } : stats)]);
  const fixStep: Record<string, () => void> = {
    dates: () => router.push(`/trip/${id}/settings`),
    friends: () => router.push(`/trip/${id}/invite`),
    stay: () => router.push(`/trip/${id}/map`),
    plan: () => router.push(`/trip/${id}/plan/new`),
    packing: () => router.push(`/trip/${id}/prepare`),
    cover: () => router.push(`/trip/${id}/settings`),
  };
  const dates = formatDateRange(trip.starts_on, trip.ends_on);

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => {
            refetch();
            overview.refetch();
            itinerary.refetch();
          }}
        />
      }>
      {/* Header */}
      <View testID="trip-overview" style={{ gap: space.md }}>
        <TripCover seed={trip.id} path={trip.cover_path} height={190}>
          {status.countdown ? (
            <View style={{ position: 'absolute', top: space.md, left: space.md, backgroundColor: t.surface, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, boxShadow: t.shadow }}>
              <Text variant="label">{status.kind === 'upcoming' ? '✈️ ' : '📍 '}{status.countdown}</Text>
            </View>
          ) : null}
          {isOrganizer && !trip.cover_path && active ? (
            <Pressable
              onPress={() => router.push(`/trip/${id}/settings`)}
              accessibilityRole="button"
              style={{ position: 'absolute', right: space.md, bottom: space.md, backgroundColor: t.surface, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <Icon name="camera" size={16} color={t.text} />
              <Text variant="caption" style={{ fontWeight: '600' }}>Add a cover photo</Text>
            </Pressable>
          ) : null}
        </TripCover>
        <View style={{ gap: 4 }}>
          <StatusPill kind={status.kind} label={status.label} />
          <Text variant="title" numberOfLines={2}>{trip.name}</Text>
          <Text muted>{[trip.destination, dates ?? 'No dates yet', `Money in ${base}`].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>

      {/* Just joined: the two most useful first steps, and what's shared. */}
      {(() => {
        const mine = members.find((m) => m.user_id === me);
        const fresh = !!mine && !isOrganizer && active && openedAt - Date.parse(mine.joined_at) < 30 * 60_000;
        if (!fresh || welcomeHidden) return null;
        return (
          <Card raised testID="welcome-joined">
            <Text variant="heading">{`You’re in! Welcome to ${trip.name}`}</Text>
            <Text variant="caption" muted>
              Your location is shared only with the people on this trip, and only while it’s on. Pause it any time from the map.
            </Text>
            <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
              <Button title="See who’s where" icon="map" small onPress={() => router.push(`/trip/${id}/map`)} testID="welcome-map" />
              <Button title="Add a bill" icon="bills" small kind="secondary" onPress={() => router.push(`/trip/${id}/bill/new`)} testID="welcome-bill" />
              <Button title="Got it" small kind="ghost" onPress={() => setWelcomeHidden(true)} />
            </Row>
          </Card>
        );
      })()}

      {/* Dates still to agree */}
      {trip.date_window_start && !trip.starts_on && active ? (
        <Card onPress={() => router.push(`/trip/${id}/dates`)} accessibilityLabel="Pick the days you can go" testID="dates-card">
          <Row gap={space.md}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="calendar" size={20} color={t.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="label">
                {(availability.data ?? []).some((a) => a.user_id === me) ? 'See which dates work' : 'When can you go? Tick your days'}
              </Text>
              <Text variant="caption" muted>
                {`${new Set((availability.data ?? []).map((a) => a.user_id)).size} of ${members.length} have answered`}
              </Text>
            </View>
          </Row>
        </Card>
      ) : null}

      {/* Group */}
      <Card onPress={() => router.push(`/trip/${id}/people`)} accessibilityLabel="See everyone on the trip">
        <Row gap={space.md}>
          <AvatarStack people={members.map((m) => ({ id: m.user_id, name: m.profile.display_name || 'Friend', url: m.profile.avatar_url }))} size={34} />
          <View style={{ flex: 1 }}>
            <Text variant="label">{members.length === 1 ? 'Just you so far' : `${members.length} travellers`}</Text>
            <Text variant="caption" muted numberOfLines={1}>{members.map((m) => (m.user_id === me ? 'You' : (m.profile.display_name || 'Friend').split(' ')[0])).join(', ')}</Text>
          </View>
          {active ? (
            <Pressable onPress={() => router.push(`/trip/${id}/invite`)} accessibilityRole="button" accessibilityLabel="Invite friends" hitSlop={8}>
              <Icon name="personAdd" size={22} color={t.primary} />
            </Pressable>
          ) : null}
        </Row>
      </Card>

      {/* What's next */}
      <Stack gap={space.sm}>
        <SectionTitle>What’s next</SectionTitle>
        {upcoming.length === 0 ? (
          <Card onPress={active ? () => router.push(`/trip/${id}/plan/new`) : undefined}>
            <Row gap={space.md}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.skySoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="idea" size={20} color={t.sky} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="label">{active ? 'Nothing planned yet' : 'The trip is over'}</Text>
                <Text variant="caption" muted>{active ? 'Add a museum slot, a dinner booking or a day trip.' : 'Have a look back at the plan and the photos.'}</Text>
              </View>
            </Row>
          </Card>
        ) : (
          upcoming.map((item) => {
            const r = rsvpSummary(rsvps.data ?? [], item.id, me);
            return (
              <Card key={item.id} onPress={() => router.push({ pathname: '/trip/[id]/plan/[itemId]', params: { id, itemId: item.id } })}>
                <Row gap={space.md}>
                  <View style={{ width: 56, alignItems: 'center', backgroundColor: t.primarySoft, borderRadius: radius.md, paddingVertical: 6 }}>
                    <Text variant="caption" color={t.primary} style={{ fontWeight: '700' }}>{item.day === today ? 'Today' : formatDate(item.day)}</Text>
                    <Text variant="caption" color={t.primary}>{timeRange(item)?.split(' – ')[0] ?? 'Any time'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="label" numberOfLines={1}>{item.title}</Text>
                    <Text variant="caption" muted numberOfLines={1}>
                      {[item.place_name, r.going.length ? `${r.going.length} going` : null, r.mine ? null : 'Are you in?'].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Icon name="chevron" size={16} color={t.textFaint} />
                </Row>
              </Card>
            );
          })
        )}
      </Stack>

      {/* After (or during) the trip: the recap */}
      {status.kind === 'completed' || status.kind === 'ongoing' ? (
        <Card onPress={() => router.push(`/trip/${id}/memories`)} accessibilityLabel="Trip memories" testID="overview-memories" style={{ backgroundColor: t.yellowSoft, borderColor: t.yellowSoft }}>
          <Row gap={space.md}>
            <Text style={{ fontSize: 28 }}>📖</Text>
            <View style={{ flex: 1 }}>
              <Text variant="label" color={t.yellowText}>{status.kind === 'completed' ? 'Trip memories' : 'The trip so far'}</Text>
              <Text variant="caption" muted>Photos, highlights and what the group decided, ready to share.</Text>
            </View>
            <Icon name="chevron" size={16} color={t.textFaint} />
          </Row>
        </Card>
      ) : null}

      {/* Countdown and preparation */}
      {status.kind === 'upcoming' || status.kind === 'planning' || status.kind === 'ongoing' ? (
        <Card onPress={() => router.push(`/trip/${id}/prepare`)} accessibilityLabel="Get ready: packing list and group tasks" testID="overview-prepare">
          <Row gap={space.md}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.coralSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="checklist" size={22} color={t.coralText} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="label">
                {status.kind === 'upcoming' && status.daysToGo ? `${status.daysToGo} ${status.daysToGo === 1 ? 'day' : 'days'} to go: get ready` : 'Get ready'}
              </Text>
              <Text variant="caption" muted>
                {packing.total ? `Packing ${packing.done}/${packing.total}` : 'Start your packing list'}
                {groupTasks.total ? ` · Group tasks ${groupTasks.done}/${groupTasks.total}` : ''}
              </Text>
            </View>
            <Icon name="chevron" size={16} color={t.textFaint} />
          </Row>
        </Card>
      ) : null}

      {/* Planning progress */}
      {status.kind !== 'completed' ? (
        <Card testID="planning-progress">
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="heading">Getting ready</Text>
            <Text variant="heading" color={t.primary}>{progress.percent}%</Text>
          </Row>
          <ProgressBar value={progress.percent} label={`Planning ${progress.done} of ${progress.steps.length} done`} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {progress.steps.map((s) => (
              <Pressable
                key={s.key}
                disabled={s.done || !fixStep[s.key] || (!isOrganizer && (s.key === 'dates' || s.key === 'cover'))}
                onPress={fixStep[s.key]}
                accessibilityRole="button"
                accessibilityState={{ checked: s.done }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
                  backgroundColor: s.done ? t.primarySoft : t.surface, borderWidth: 1, borderColor: s.done ? t.primarySoft : t.border,
                }}>
                <Text variant="caption" color={s.done ? t.primary : t.textMuted} style={{ fontWeight: '600' }}>
                  {s.done ? '✓ ' : '○ '}
                  {s.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      {/* Quick actions */}
      {active ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <QuickAction icon="calendar" label="Add a plan" color={t.primary} soft={t.primarySoft} onPress={() => router.push(`/trip/${id}/plan/new`)} testID="overview-add-plan" />
          <QuickAction icon="bills" label="Add a bill" color={t.coralText} soft={t.coralSoft} onPress={() => router.push(`/trip/${id}/bill/new`)} testID="overview-add-bill" />
          <QuickAction icon="pin" label="Pin a place" color={t.yellowText} soft={t.yellowSoft} onPress={() => router.push(`/trip/${id}/map`)} />
          <QuickAction icon="personAdd" label="Invite" color={t.sky} soft={t.skySoft} onPress={() => router.push(`/trip/${id}/invite`)} />
        </View>
      ) : (
        <Banner tone="info" icon="calendar">This trip has ended. Everything is still here to look back on and settle up.</Banner>
      )}

      {/* Latest from the group */}
      {latest.length > 0 ? (
        <Stack gap={space.sm}>
          <SectionTitle action={<Pressable onPress={() => router.push(`/trip/${id}/feed`)} accessibilityRole="link"><Text variant="label" color={t.primary}>Open the feed</Text></Pressable>}>
            Latest from the group
          </SectionTitle>
          <Card style={{ paddingVertical: space.xs, gap: 0 }}>
            {latest.map((p, i) => <ActivityRow key={p.id} post={p} me={me} first={i === 0} />)}
          </Card>
        </Stack>
      ) : null}

      {/* Every part of the trip */}
      <Stack gap={space.sm}>
        <SectionTitle>The trip</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <SectionTile icon="calendar" title="Plan" detail={`${itinerary.data?.length ?? stats?.stops ?? 0} plans`} onPress={() => router.push(`/trip/${id}/plan`)} />
          {trip.date_window_start || (!trip.starts_on && isOrganizer && active) ? (
            <SectionTile
              icon="calendar"
              title="Dates"
              detail={trip.starts_on ? dates ?? 'Set' : trip.date_window_start ? 'Picking dates' : 'Find dates that work'}
              onPress={() => router.push(`/trip/${id}/dates`)}
            />
          ) : null}
          <SectionTile
            icon="ticket"
            title="Bookings"
            detail={bookings.data?.length ? `${bookings.data.length} ${bookings.data.length === 1 ? 'booking' : 'bookings'}` : 'Flights, stays, tickets'}
            sub={nextBooking ? `Next: ${nextBooking.title}` : undefined}
            onPress={() => router.push(`/trip/${id}/bookings`)}
          />
          <SectionTile
            icon="bed"
            title="Rooms"
            detail={stays.data?.stays.length ? `${stays.data.stays.length} ${stays.data.stays.length === 1 ? 'stay' : 'stays'}` : 'Who sleeps where'}
            sub={myBedMissing ? 'Pick your bed' : undefined}
            onPress={() => router.push(`/trip/${id}/stays`)}
          />
          <SectionTile icon="idea" title="Bucket list" detail={`${ideas.data?.length ?? 0} ideas`} onPress={() => router.push(`/trip/${id}/ideas`)} />
          <SectionTile
            icon="poll"
            title="Polls"
            detail={`${(polls.data ?? []).filter((p) => pollIsOpen(p)).length} open`}
            sub={(polls.data ?? []).some((p) => pollIsOpen(p) && !p.poll_votes.some((v) => v.user_id === me)) ? 'Waiting for your vote' : undefined}
            onPress={() => router.push(`/trip/${id}/polls`)}
          />
          <SectionTile
            icon="trophy"
            title="Challenges"
            detail={`${challenges.data?.length ?? 0} going`}
            onPress={() => router.push(`/trip/${id}/challenges`)}
          />
          <SectionTile icon="idea" title="Trip Fun" detail="Wheel, missions, food & memories" onPress={() => router.push(`/trip/${id}/fun`)} />
          <SectionTile icon="map" title="Map" detail={`${places.data?.length ?? 0} places pinned`} onPress={() => router.push(`/trip/${id}/map`)} />
          <SectionTile
            icon="wallet"
            title="Money"
            detail={spent ? `${formatMoney(spent, base)} spent` : 'No bills yet'}
            sub={myNet > 0 ? `You're owed ${formatMoney(myNet, base)}` : myNet < 0 ? `You owe ${formatMoney(-myNet, base)}` : spent ? 'You’re all square' : undefined}
            onPress={() => router.push(`/trip/${id}/bills`)}
          />
          <SectionTile icon="people" title="People" detail={`${members.length} on the trip`} onPress={() => router.push(`/trip/${id}/people`)} />
        </View>
      </Stack>
    </Screen>
  );
}

function SectionTile({ icon, title, detail, sub, onPress }: { icon: IconName; title: string; detail: string; sub?: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Card onPress={onPress} style={{ flexBasis: 150, flexGrow: 1, gap: 6 }} accessibilityLabel={`${title}: ${detail}${sub ? `, ${sub}` : ''}`}>
      <Row gap={space.sm}>
        <Icon name={icon} size={18} color={t.primary} />
        <Text variant="label">{title}</Text>
      </Row>
      <Text variant="caption" muted>{detail}</Text>
      {sub ? <Text variant="caption" style={{ fontWeight: '600' }}>{sub}</Text> : null}
    </Card>
  );
}
