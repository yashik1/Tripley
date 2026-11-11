/**
 * The shared plan: Today / Day 1 / Day 2…, each day's stops in order, who's
 * going, and a warning when two stops overlap.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { PlanSwitch } from '@/components/GroupDecisions';
import { Icon } from '@/components/Icon';
import { RouteCard } from '@/components/RouteCard';
import { Banner, Button, Card, EmptyState, Row, Screen, Stack, Text } from '@/components/ui';
import { setRsvp } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate, todayISO } from '@/lib/format';
import { defaultDay, findConflicts, planDays, RSVP_OPTIONS, rsvpSummary, timeRange } from '@/lib/itinerary';
import { keys, useItinerary, usePlaces, useRsvps } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import type { ItineraryItem, RsvpStatus } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

export default function PlanTab() {
  const id = useTripId();
  const t = useTheme();
  const qc = useQueryClient();
  const { trip, me, active, isOrganizer } = useTripData(id);
  const itinerary = useItinerary(id);
  const places = usePlaces(id);
  const rsvps = useRsvps(id);
  const items = useMemo(() => itinerary.data ?? [], [itinerary.data]);
  const today = todayISO();
  const days = useMemo(() => planDays(trip ?? { starts_on: null, ends_on: null }, items, today), [trip, items, today]);
  const [day, setDay] = useState<string | null>(null);
  const selected = day && days.some((d) => d.day === day) ? day : defaultDay(days, today);
  const [error, setError] = useState<string | null>(null);

  const dayItems = items.filter((i) => i.day === selected);
  const conflicts = useMemo(() => findConflicts(items), [items]);
  const label = days.find((d) => d.day === selected)?.label ?? '';

  const answer = async (item: ItineraryItem, status: RsvpStatus, current: RsvpStatus | null) => {
    setError(null);
    try {
      await setRsvp(item.id, current === status ? null : status);
      await qc.invalidateQueries({ queryKey: keys.rsvps(id) });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={itinerary.isRefetching}
          onRefresh={() => {
            itinerary.refetch();
            rsvps.refetch();
          }}
        />
      }
      footer={
        active ? (
          <Button
            title={`Add to ${label === 'Today' ? 'today' : label || 'the plan'}`}
            icon="add"
            testID="add-stop"
            onPress={() => router.push({ pathname: '/trip/[id]/plan/new', params: { id, day: selected } })}
          />
        ) : undefined
      }>
      <PlanSwitch tripId={id} value="plan" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: space.sm, paddingVertical: 2, alignItems: 'flex-start' }}>
        {days.map((d) => {
          const on = d.day === selected;
          return (
            <Pressable
              key={d.day}
              testID={`plan-day-${d.day}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${d.label}, ${formatDate(d.day)}, ${d.count} ${d.count === 1 ? 'stop' : 'stops'}`}
              onPress={() => {
                setDay(d.day);
                setError(null);
              }}
              style={{
                minWidth: 76,
                paddingVertical: space.sm,
                paddingHorizontal: space.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: on ? t.primary : t.border,
                backgroundColor: on ? t.primary : t.surface,
                alignItems: 'center',
              }}>
              <Text variant="label" color={on ? t.primaryText : t.text}>{d.label}</Text>
              <Text variant="caption" color={on ? t.primaryText : t.textMuted}>{formatDate(d.day)}</Text>
              <Text variant="caption" color={on ? t.primaryText : t.textFaint} style={{ fontSize: 11 }}>
                {d.count ? `${d.count} ${d.count === 1 ? 'stop' : 'stops'}` : 'free'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {!active ? (
        <Banner tone="info" icon="calendar">This trip has ended, so the plan is read-only.</Banner>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {itinerary.isLoading ? null : dayItems.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={items.length === 0 ? 'Plan the trip together' : `Nothing planned for ${label === 'Today' ? 'today' : label}`}
          body={
            items.length === 0
              ? 'Add the museum slot, the dinner booking or the train. Everyone sees the plan, says if they’re coming, and gets directions in a tap.'
              : 'Add a stop, or enjoy a free day.'
          }
        />
      ) : (
        <Stack gap={space.sm}>
          <RouteCard
            key={selected}
            tripId={id}
            day={selected}
            dayLabel={label}
            items={dayItems}
            places={places.data ?? []}
            me={me}
            isOrganizer={isOrganizer}
            active={active}
          />
          {dayItems.map((item) => {
            const r = rsvpSummary(rsvps.data ?? [], item.id, me);
            const clash = conflicts.get(item.id);
            const time = timeRange(item);
            return (
              <Card key={item.id} onPress={() => router.push({ pathname: '/trip/[id]/plan/[itemId]', params: { id, itemId: item.id } })}>
                <View testID={`stop-${item.title}`} style={{ gap: space.xs }}>
                  <Row gap={space.md} align="flex-start">
                    <View style={{ width: 58 }}>
                      <Text variant="label" color={time ? t.primary : t.textFaint}>{time ? time.split(' – ')[0] : 'Any time'}</Text>
                      {item.ends_at ? <Text variant="caption" faint>to {time!.split(' – ')[1]}</Text> : null}
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="heading" numberOfLines={2}>{item.title}</Text>
                      {item.place_name || item.address ? (
                        <Row gap={4} align="center">
                          <Icon name="location" size={14} color={t.textMuted} />
                          <Text variant="caption" muted numberOfLines={1} style={{ flex: 1 }}>
                            {item.place_name ?? item.address}
                          </Text>
                        </Row>
                      ) : null}
                      <Text variant="caption" faint>
                        {r.going.length ? `${r.going.length} going` : 'No one’s said yet'}
                        {r.maybe.length ? ` · ${r.maybe.length} maybe` : ''}
                      </Text>
                    </View>
                  </Row>
                  {clash ? (
                    <Row gap={6} align="center" style={{ backgroundColor: t.warningSoft, borderRadius: radius.sm, padding: space.xs }}>
                      <Icon name="calendar" size={14} color={t.warning} />
                      <Text variant="caption" color={t.warning} style={{ flex: 1 }} testID="stop-clash">
                        Overlaps with {clash.join(', ')}
                      </Text>
                    </Row>
                  ) : null}
                  {active ? (
                    <Row gap={space.xs}>
                      {RSVP_OPTIONS.map((o) => {
                        const on = r.mine === o.value;
                        return (
                          <Pressable
                            key={o.value}
                            testID={`rsvp-${o.value}`}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            accessibilityLabel={`${o.label} to ${item.title}`}
                            onPress={() => answer(item, o.value, r.mine)}
                            style={{
                              flex: 1,
                              minHeight: 36,
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: radius.sm,
                              borderWidth: 1,
                              borderColor: on ? t.primary : t.border,
                              backgroundColor: on ? t.primarySoft : t.surface,
                            }}>
                            <Text variant="caption" color={on ? t.primary : t.textMuted} style={{ fontWeight: on ? '700' : '500' }}>
                              {o.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </Row>
                  ) : null}
                </View>
              </Card>
            );
          })}
        </Stack>
      )}
    </Screen>
  );
}
