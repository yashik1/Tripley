/**
 * For the organizer: who's sharing their location (and how fresh it is), who
 * owes or is owed, and who still has to answer polls, plans and dates, with a
 * nudge for each. Only what everyone on the trip can already see.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Avatar, Banner, Button, Card, Loading, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { toSettlementRows } from '@/lib/api';
import { netPerMember } from '@/lib/balances';
import { formatMoney } from '@/lib/currency';
import { todayISO } from '@/lib/format';
import { pollIsOpen } from '@/lib/group-decisions';
import { lastSeenText, tripInsights } from '@/lib/insights';
import { useAvailability, useItinerary, useLocations, usePolls, useRsvps, useSettlements, useShareRows } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { space, useTheme } from '@/theme';

export default function Insights() {
  const id = useTripId();
  const t = useTheme();
  const { trip, members, isOrganizer, nameOf, byId, loading } = useTripData(id);
  const locations = useLocations(id);
  const shares = useShareRows(id);
  const settlements = useSettlements(id);
  const polls = usePolls(id);
  const itinerary = useItinerary(id);
  const rsvps = useRsvps(id);
  const availability = useAvailability(id);
  const [now] = useState(() => Date.now());
  if (loading || !trip) return <Loading />;
  if (!isOrganizer) {
    return (
      <Screen>
        <Banner tone="info" title="For the organizer">Trip insights are for whoever organizes the trip.</Banner>
      </Screen>
    );
  }
  const today = todayISO();
  const insights = tripInsights({
    members,
    locations: (locations.data ?? []).map((l) => ({ user_id: l.user_id, updated_at: l.updated_at })),
    net: netPerMember(shares.data ?? [], toSettlementRows(settlements.data ?? [])),
    openPolls: (polls.data ?? []).filter((p) => pollIsOpen(p, now)).map((p) => ({ voters: [...new Set(p.poll_votes.map((v) => v.user_id))] })),
    upcomingStops: (itinerary.data ?? []).filter((i) => i.day >= today),
    rsvps: rsvps.data ?? [],
    datesOpen: !!trip.date_window_start && !trip.starts_on,
    datesAnswered: new Set((availability.data ?? []).map((a) => a.user_id)),
    now,
  });
  const base = trip.base_currency;
  const sharingText = { live: 'Sharing live', saver: 'Sharing (battery saver)', stale: 'Sharing, but quiet', paused: 'Paused' } as const;
  const sharingColor = { live: t.success, saver: t.success, stale: t.warning, paused: t.textFaint } as const;

  return (
    <Screen>
      <Stack gap={space.xs}>
        <Text variant="title">Trip insights</Text>
        <Text muted>Who’s on the map, who owes what, and who still has to answer. Only what everyone on the trip can already see.</Text>
      </Stack>
      <Row gap={space.sm}>
        <Card style={{ flex: 1 }} testID="insights-sharing">
          <Text variant="caption" muted>On the map</Text>
          <Text variant="title">{`${insights.sharingCount}/${members.length}`}</Text>
          {insights.staleCount ? <Text variant="caption" color={t.warning}>{`${insights.staleCount} quiet for 30+ min`}</Text> : null}
        </Card>
        <Card style={{ flex: 1 }} testID="insights-owing">
          <Text variant="caption" muted>Still owe money</Text>
          <Text variant="title">{String(insights.owingCount)}</Text>
          {insights.owingCount ? (
            <Text variant="caption" color={t.primary} onPress={() => router.push(`/trip/${id}/balances`)}>Remind them</Text>
          ) : null}
        </Card>
      </Row>
      {insights.allAnswered ? <Banner tone="success">Everyone has answered everything that’s open.</Banner> : null}

      <SectionTitle>People</SectionTitle>
      {insights.members.map((m) => {
        const member = byId.get(m.userId);
        const todo = [
          m.pollsOpen && m.pollsVoted < m.pollsOpen ? `${m.pollsOpen - m.pollsVoted} ${m.pollsOpen - m.pollsVoted === 1 ? 'poll' : 'polls'}` : null,
          m.rsvpsUpcoming && m.rsvpsAnswered < m.rsvpsUpcoming ? `${m.rsvpsUpcoming - m.rsvpsAnswered} ${m.rsvpsUpcoming - m.rsvpsAnswered === 1 ? 'plan' : 'plans'}` : null,
          m.datesAnswered === false ? 'dates' : null,
        ].filter(Boolean);
        return (
          <Card key={m.userId} testID={`insights-${nameOf(m.userId)}`}>
            <Row gap={space.md}>
              <Avatar id={m.userId} name={member?.profile.display_name ?? '?'} url={member?.profile.avatar_url} size={36} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label">{nameOf(m.userId)}</Text>
                <Text variant="caption" color={sharingColor[m.sharing]}>
                  {m.sharing === 'paused' ? sharingText.paused : m.lastSeenMin == null ? 'Sharing on · no position yet' : `${sharingText[m.sharing]} · ${lastSeenText(m.lastSeenMin)}`}
                </Text>
                <Text variant="caption" muted>
                  {m.netMinor > 0 ? `Is owed ${formatMoney(m.netMinor, base)}` : m.netMinor < 0 ? `Owes ${formatMoney(-m.netMinor, base)}` : 'All square'}
                </Text>
                <Text variant="caption" muted>{todo.length ? `Still to answer: ${todo.join(', ')}` : 'Answered everything open'}</Text>
              </View>
            </Row>
          </Card>
        );
      })}
      <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
        <Button title="Polls" kind="secondary" small icon="poll" onPress={() => router.push(`/trip/${id}/polls`)} />
        <Button title="Plan" kind="secondary" small icon="calendar" onPress={() => router.push(`/trip/${id}/plan`)} />
        {trip.date_window_start && !trip.starts_on ? <Button title="Dates" kind="secondary" small icon="calendar" onPress={() => router.push(`/trip/${id}/dates`)} /> : null}
      </Row>
    </Screen>
  );
}
