/**
 * The Plan tab's three views (schedule, bucket list, polls), and the cards for
 * a bucket-list idea and a poll.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { addSuggestionToPlan, closePoll, deletePoll, deleteSuggestion, toggleSuggestionVote, votePoll } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { formatMoney } from '@/lib/currency';
import { errorMessage } from '@/lib/errors';
import { firstName, formatDate } from '@/lib/format';
import { categoryOf, closingLabel, pollResults } from '@/lib/group-decisions';
import { directionsUrl } from '@/lib/map-links';
import { keys } from '@/lib/queries';
import type { Poll, Suggestion } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';
import { PhotoGrid } from './FeedPost';
import { Icon } from './Icon';
import { Button, Card, Row, Segmented, Text } from './ui';

export function PlanSwitch({ tripId, value }: { tripId: string; value: 'plan' | 'ideas' | 'polls' }) {
  return (
    <Segmented<'plan' | 'ideas' | 'polls'>
      options={[
        { value: 'plan', label: 'Schedule' },
        { value: 'ideas', label: 'Bucket list' },
        { value: 'polls', label: 'Polls' },
      ]}
      value={value}
      onChange={(v) => v !== value && router.replace(`/trip/${tripId}/${v}`)}
    />
  );
}

export function SuggestionCard({
  s,
  me,
  nameOf,
  canModerate,
  active,
}: {
  s: Suggestion;
  me: string;
  nameOf: (id: string) => string;
  canModerate: boolean;
  active: boolean;
}) {
  const t = useTheme();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cat = categoryOf(s.category);
  const votes = s.suggestion_votes.length;
  const mine = s.suggestion_votes.some((v) => v.user_id === me);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await Promise.all([qc.invalidateQueries({ queryKey: keys.suggestions(s.trip_id) }), qc.invalidateQueries({ queryKey: keys.itinerary(s.trip_id) })]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card testID={`idea-${s.name}`}>
      <Row gap={space.md} align="flex-start">
        <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: t.yellowSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 22 }}>{cat.emoji}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="heading" numberOfLines={2}>{s.name}</Text>
          <Text variant="caption" muted>
            {[cat.label, s.cost_minor != null && s.cost_currency ? `about ${formatMoney(s.cost_minor, s.cost_currency)}` : null, s.preferred_day ? `best on ${formatDate(s.preferred_day)}` : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <Text variant="caption" faint>Suggested by {s.suggested_by === me ? 'you' : firstName(nameOf(s.suggested_by))}</Text>
        </View>
        {s.suggested_by === me || canModerate ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove idea"
            hitSlop={8}
            onPress={async () => {
              if (await confirm('Remove this idea?', `"${s.name}" and its votes are removed for everyone.`, 'Remove', true)) run('del', () => deleteSuggestion(s.id));
            }}>
            <Icon name="trash" size={18} color={t.textFaint} />
          </Pressable>
        ) : null}
      </Row>
      {s.description ? <Text>{s.description}</Text> : null}
      {s.photo_path ? <PhotoGrid paths={[s.photo_path]} /> : null}
      {s.address || s.lat != null ? (
        <Pressable
          onPress={s.lat != null && s.lng != null ? () => Linking.openURL(directionsUrl(s.lat!, s.lng!)) : undefined}
          disabled={s.lat == null}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="location" size={14} color={t.textMuted} />
          <Text variant="caption" muted style={{ flex: 1 }} numberOfLines={1}>{s.address ?? 'On the map: tap for directions'}</Text>
        </Pressable>
      ) : null}
      <Row gap={space.sm}>
        <Pressable
          onPress={active ? () => run('vote', () => toggleSuggestionVote(s.id)) : undefined}
          disabled={!active || busy === 'vote'}
          accessibilityRole="button"
          accessibilityState={{ selected: mine }}
          accessibilityLabel={`${mine ? 'Remove your vote' : 'Vote'} for ${s.name}, ${votes} ${votes === 1 ? 'vote' : 'votes'}`}
          testID="idea-vote"
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 36, borderRadius: radius.pill,
            borderWidth: 1, borderColor: mine ? t.primary : t.border, backgroundColor: mine ? t.primarySoft : t.surface,
          }}>
          <Text style={{ fontSize: 15 }}>👍</Text>
          <Text variant="label" color={mine ? t.primary : t.text} testID="idea-votes">{votes}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        {s.itinerary_item_id ? (
          <Button
            title="In the plan"
            icon="check"
            small
            kind="ghost"
            onPress={() => router.push({ pathname: '/trip/[id]/plan/[itemId]', params: { id: s.trip_id, itemId: s.itinerary_item_id! } })}
            testID="idea-in-plan"
          />
        ) : active ? (
          <Button title="Add to plan" icon="calendar" small kind="secondary" loading={busy === 'plan'} onPress={() => run('plan', () => addSuggestionToPlan(s.id))} testID="idea-add-to-plan" />
        ) : null}
      </Row>
      {error ? <Text variant="caption" color={t.danger}>{error}</Text> : null}
    </Card>
  );
}

function ResultBar({ percent, color }: { percent: number; color: string }) {
  const reduced = useReducedMotion();
  const w = useSharedValue(reduced ? percent : 0);
  useEffect(() => {
    w.set(reduced ? percent : withTiming(percent, { duration: 500 }));
  }, [percent, reduced, w]);
  const style = useAnimatedStyle(() => ({ width: `${w.value}%` }));
  return <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: color, borderRadius: radius.md }, style]} />;
}

export function PollCard({ poll, me, nameOf, canModerate, active }: { poll: Poll; me: string; nameOf: (id: string) => string; canModerate: boolean; active: boolean }) {
  const t = useTheme();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = pollResults(poll, me);
  const closing = closingLabel(poll);
  const canClose = r.open && (poll.created_by === me || canModerate);
  const canVote = r.open && active && (poll.allow_change || !r.myVote);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: keys.polls(poll.trip_id) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card testID={`poll-${poll.question}`}>
      <View style={{ gap: 2 }}>
        <Row gap={space.sm} style={{ justifyContent: 'space-between' }}>
          <Text variant="caption" muted>
            {poll.created_by === me ? 'You asked' : `${firstName(nameOf(poll.created_by))} asked`}
            {closing ? ` · ${closing}` : ''}
          </Text>
          {canModerate || poll.created_by === me ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove poll"
              hitSlop={8}
              onPress={async () => {
                if (await confirm('Remove this poll?', 'The question and its votes are removed for everyone.', 'Remove', true)) run(() => deletePoll(poll.id));
              }}>
              <Icon name="trash" size={16} color={t.textFaint} />
            </Pressable>
          ) : null}
        </Row>
        <Text variant="heading">{poll.question}</Text>
      </View>
      <View style={{ gap: space.xs }}>
        {r.options.map((o) => (
          <Pressable
            key={o.id}
            onPress={canVote && !busy ? () => run(() => votePoll(poll.id, o.mine ? null : o.id)) : undefined}
            disabled={!canVote || busy}
            accessibilityRole="button"
            accessibilityState={{ selected: o.mine, disabled: !canVote }}
            accessibilityLabel={`${o.label}: ${o.count} ${o.count === 1 ? 'vote' : 'votes'}${o.mine ? ', your vote' : ''}`}
            testID={`poll-option-${o.label}`}
            style={{ minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: o.mine ? t.primary : t.border, overflow: 'hidden', justifyContent: 'center' }}>
            <ResultBar percent={r.total ? o.percent : 0} color={o.mine ? t.primarySoft : o.leading && !r.open ? t.yellowSoft : t.surfaceAlt} />
            <Row style={{ paddingHorizontal: space.md, justifyContent: 'space-between' }}>
              <Text variant="label" style={{ flex: 1 }}>
                {!r.open && o.leading ? '🏆 ' : o.mine ? '✓ ' : ''}
                {o.label}
              </Text>
              <Text variant="caption" muted style={{ fontWeight: '700' }}>{r.total ? `${o.percent}% · ${o.count}` : ''}</Text>
            </Row>
          </Pressable>
        ))}
      </View>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="caption" faint>
          {r.total} {r.total === 1 ? 'vote' : 'votes'}
          {r.open ? (r.myVote ? (poll.allow_change ? ' · tap to change' : ' · your vote is in') : ' · tap an option to vote') : ''}
        </Text>
        {canClose ? <Button title="Close poll" small kind="ghost" onPress={() => run(() => closePoll(poll.id))} testID="poll-close" /> : null}
      </Row>
      {error ? <Text variant="caption" color={t.danger}>{error}</Text> : null}
    </Card>
  );
}
