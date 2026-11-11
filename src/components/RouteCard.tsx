/**
 * The walking route for one day of the plan: how far, how long, a shorter
 * order when there is one (booked times kept), connections too tight to walk,
 * and the walk in Google Maps or on the trip map.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, Switch, View } from 'react-native';

import { reorderItineraryDay } from '@/lib/api';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { ROUTE_LINK_MAX_STOPS, routeUrl } from '@/lib/map-links';
import { keys } from '@/lib/queries';
import { formatDistance, formatMinutes, planRoute, tightConnections, walkMinutes, type RouteStart } from '@/lib/route';
import type { ItineraryItem, Place } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';
import { Icon } from './Icon';
import { Banner, Button, Card, Chip, Row, Stack, Text } from './ui';

export function RouteCard({
  tripId,
  day,
  dayLabel,
  items,
  places,
  me,
  isOrganizer,
  active,
}: {
  tripId: string;
  day: string;
  dayLabel: string;
  /** The day's stops, in their current order. */
  items: ItineraryItem[];
  places: Place[];
  me: string;
  isOrganizer: boolean;
  active: boolean;
}) {
  const t = useTheme();
  const qc = useQueryClient();
  const stays = places.filter((p) => p.kind === 'stay').slice(0, 3);
  // Start from the stay by default: '' means "from the first stop".
  const [startId, setStartId] = useState<string | null>(null);
  const startPlace = startId === '' ? null : (stays.find((s) => s.id === startId) ?? stays[0] ?? null);
  const [back, setBack] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const start: RouteStart = startPlace ? { label: startPlace.name, lat: startPlace.lat, lng: startPlace.lng } : null;
  const roundTrip = !!start && back;
  const plan = useMemo(() => planRoute(items, start, roundTrip), [items, start?.lat, start?.lng, roundTrip]); // eslint-disable-line react-hooks/exhaustive-deps
  const tight = useMemo(() => tightConnections(items), [items]);

  if (items.length < 2) return null;
  const byId = new Map(items.map((i) => [i.id, i]));
  const unplaced = items.length - plan.routed;

  if (plan.routed < 2) {
    return (
      <Card testID="route-card">
        <Row gap={space.sm}>
          <Icon name="navigate" size={18} color={t.primary} />
          <Text variant="label">Walking route</Text>
        </Row>
        <Text variant="caption" muted>
          Add a place to at least two stops (edit a stop and search for it) to see the walk between them and the shortest order.
        </Text>
      </Card>
    );
  }

  const saved = plan.currentMeters - plan.suggestedMeters;
  // Stops that would change place; anyone can apply if they added all of them.
  const moved = plan.suggestedIds.filter((id, k) => plan.currentIds[k] !== id);
  const canApply = active && (isOrganizer || moved.every((id) => byId.get(id)?.created_by === me));
  const walkPoints = (ids: string[]) => {
    const pts = ids.map((id) => byId.get(id)!).filter((i) => i.lat != null && i.lng != null).map((i) => ({ lat: i.lat!, lng: i.lng! }));
    return [...(start ? [start] : []), ...pts, ...(roundTrip && start ? [start] : [])];
  };
  const link = routeUrl(walkPoints(plan.currentIds));
  const linkCut = walkPoints(plan.currentIds).length > ROUTE_LINK_MAX_STOPS;

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await reorderItineraryDay(tripId, day, plan.suggestedIds);
      await qc.invalidateQueries({ queryKey: keys.itinerary(tripId) });
      setDone(`Saved: the new order saves about ${formatDistance(saved)}.`);
    } catch (e) {
      setError(isNetworkError(e) ? 'No connection. Changes to the plan need a connection.' : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID="route-card">
      <Row gap={space.sm} style={{ justifyContent: 'space-between' }}>
        <Row gap={space.sm} style={{ flex: 1 }}>
          <Icon name="navigate" size={18} color={t.primary} />
          <Text variant="label">Walking route</Text>
        </Row>
        <Text variant="caption" muted testID="route-summary">
          {`${formatDistance(plan.currentMeters)} · about ${formatMinutes(walkMinutes(plan.currentMeters))}`}
        </Text>
      </Row>

      {stays.length ? (
        <Stack gap={space.xs}>
          <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
            {stays.map((s) => (
              <Chip key={s.id} label={`🏨 From ${s.name}`} selected={startPlace?.id === s.id} onPress={() => setStartId(s.id)} testID={`route-start-${s.name}`} />
            ))}
            <Chip label="From the first stop" selected={!startPlace} onPress={() => setStartId('')} testID="route-start-first" />
          </Row>
          {startPlace ? (
            <Row gap={space.sm}>
              <Text variant="caption" muted style={{ flex: 1 }}>{`Back to ${startPlace.name} at the end`}</Text>
              <Switch
                value={back}
                onValueChange={setBack}
                trackColor={{ true: t.primary, false: t.border }}
                thumbColor="#fff"
                accessibilityLabel={`Back to ${startPlace.name} at the end`}
                testID="route-round-trip"
              />
            </Row>
          ) : null}
        </Stack>
      ) : null}

      {plan.better ? (
        <View style={{ gap: space.sm, backgroundColor: t.primarySoft, borderRadius: radius.md, padding: space.md }} testID="route-suggestion">
          <Text variant="label" color={t.primary}>
            {[
              saved >= 50 ? `A better order saves ${formatDistance(saved)} (about ${formatMinutes(walkMinutes(saved))} of walking)` : 'A better order',
              plan.currentLate - plan.suggestedLate >= 10
                ? `${saved >= 50 ? 'and gives' : 'gives'} you about ${formatMinutes(plan.currentLate - plan.suggestedLate)} more to reach your bookings`
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          </Text>
          <Stack gap={2}>
            {start ? <Text variant="caption" muted>{`Start: ${start.label}`}</Text> : null}
            {plan.suggestedIds.map((id, k) => {
              const item = byId.get(id)!;
              const time = item.starts_at ? item.starts_at.slice(0, 5) : null;
              const placed = item.lat != null;
              return (
                <Text key={id} variant="caption" color={placed ? t.text : t.textMuted} testID={`route-step-${k + 1}`}>
                  {`${k + 1}. ${time ? `${time} ` : ''}${item.title}${placed ? '' : ' (no map point, stays put)'}`}
                </Text>
              );
            })}
            {roundTrip ? <Text variant="caption" muted>{`Back to ${start!.label}`}</Text> : null}
          </Stack>
          {canApply ? (
            <Button title="Use this order" icon="check" small onPress={apply} loading={busy} testID="route-apply" style={{ alignSelf: 'flex-start' }} />
          ) : active ? (
            <Text variant="caption" muted>Only the organizer can reorder stops other people added. Ask them, or show them this.</Text>
          ) : null}
        </View>
      ) : plan.routed >= 3 ? (
        <Text variant="caption" color={t.primary} testID="route-best">✓ This is already the shortest order we can find.</Text>
      ) : null}

      {tight.map((c) => (
        <Row key={`${c.fromTitle}>${c.toTitle}`} gap={6} align="center" style={{ backgroundColor: t.warningSoft, borderRadius: radius.sm, padding: space.xs }}>
          <Icon name="clock" size={14} color={t.warning} />
          <Text variant="caption" color={t.warning} style={{ flex: 1 }} testID="route-tight">
            {`Tight: about ${formatMinutes(c.walkMinutes)} on foot from ${c.fromTitle} to ${c.toTitle}${c.via ? ` (via ${c.via} ${c.via === 1 ? 'stop' : 'stops'})` : ''}, with ${c.gapMinutes ? `${c.gapMinutes} min` : 'no time'} between them.`}
          </Text>
        </Row>
      ))}

      <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
        {link ? (
          <Button title="Walk it in Google Maps" icon="directions" kind="secondary" small onPress={() => Linking.openURL(link)} testID="route-open" />
        ) : null}
        <Button
          title="Show on map"
          icon="map"
          kind="ghost"
          small
          onPress={() => router.push({ pathname: '/trip/[id]/map', params: { id: tripId, day } })}
          testID="route-map"
        />
      </Row>
      <Text variant="caption" faint>
        {[
          `Distances are in a straight line between ${dayLabel === 'Today' ? 'today’s' : `${dayLabel}’s`} stops; walking times allow for streets.`,
          unplaced ? `${unplaced} ${unplaced === 1 ? 'stop has' : 'stops have'} no map point and ${unplaced === 1 ? 'isn’t' : 'aren’t'} included.` : '',
          linkCut ? `Google Maps gets the first ${ROUTE_LINK_MAX_STOPS} stops.` : '',
        ]
          .filter(Boolean)
          .join(' ')}
      </Text>
      {done ? <Banner tone="success">{done}</Banner> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Card>
  );
}
