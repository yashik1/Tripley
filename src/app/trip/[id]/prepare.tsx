/**
 * Getting ready: the countdown, your private packing list and the group's
 * shared tasks. Ticking things off animates gently (not with reduced motion),
 * and finishing a list gets a small celebration.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { ProgressBar } from '@/components/Travel';
import { Avatar, Banner, Button, Card, Chip, Field, Row, Screen, Segmented, Stack, Text } from '@/components/ui';
import { addTasks, deleteTask, setTaskDone } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { firstName, todayISO } from '@/lib/format';
import { missingStarters, progress } from '@/lib/preparation';
import { keys, useTasks } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { tripStatus } from '@/lib/trip-status';
import type { TripTask } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

function Check({ done, onPress, label }: { done: boolean; onPress: () => void; label: string }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const s = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      onPress={() => {
        if (!reduced && !done) s.set(withSequence(withTiming(1.3, { duration: 100 }), withSpring(1)));
        onPress();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={label}
      hitSlop={8}>
      <Animated.View
        style={[
          { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: done ? t.primary : t.border, backgroundColor: done ? t.primary : 'transparent', alignItems: 'center', justifyContent: 'center' },
          style,
        ]}>
        {done ? <Icon name="check" size={16} color={t.primaryText} /> : null}
      </Animated.View>
    </Pressable>
  );
}

export default function Prepare() {
  const id = useTripId();
  const t = useTheme();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ list?: string }>();
  const { trip, me, members, nameOf, isOrganizer, active } = useTripData(id);
  const tasks = useTasks(id);
  const [list, setList] = useState<'packing' | 'group'>(params.list === 'group' ? 'group' : 'packing');
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = (tasks.data ?? []).filter((x) => x.kind === list);
  const p = progress(items);
  const status = trip ? tripStatus(trip, todayISO()) : null;

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: keys.tasks(id) }), qc.invalidateQueries({ queryKey: keys.overview })]);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const add = () => {
    if (!title.trim()) return;
    const text = title.trim();
    setTitle('');
    run(() => addTasks(id, list, [text], list === 'group' ? assignee : null));
  };
  const starters = list === 'packing' ? missingStarters(items) : [];

  const row = (task: TripTask) => (
    <Row key={task.id} gap={space.md} style={{ paddingVertical: 6 }}>
      <Check done={task.done} onPress={() => active && run(() => setTaskDone(task.id, !task.done))} label={task.title} />
      <View style={{ flex: 1 }}>
        <Text style={task.done ? { textDecorationLine: 'line-through', color: t.textFaint } : undefined} testID={`task-${task.title}`}>{task.title}</Text>
        {task.kind === 'group' && (task.assignee_id || task.done_by) ? (
          <Text variant="caption" faint>
            {task.done && task.done_by ? `Done by ${task.done_by === me ? 'you' : firstName(nameOf(task.done_by))}` : task.assignee_id ? `For ${task.assignee_id === me ? 'you' : firstName(nameOf(task.assignee_id))}` : ''}
          </Text>
        ) : null}
      </View>
      {task.created_by === me || (task.kind === 'group' && isOrganizer) ? (
        <Pressable onPress={() => run(() => deleteTask(task.id))} accessibilityRole="button" accessibilityLabel={`Remove ${task.title}`} hitSlop={8}>
          <Icon name="close" size={16} color={t.textFaint} />
        </Pressable>
      ) : null}
    </Row>
  );

  return (
    <Screen>
      {status?.countdown ? (
        <Card style={{ backgroundColor: t.primarySoft, borderColor: t.primarySoft }}>
          <Text variant="title" color={t.primary} style={{ fontSize: 24, lineHeight: 30 }} testID="prep-countdown">
            {status.kind === 'upcoming'
              ? `${status.daysToGo} ${status.daysToGo === 1 ? 'day' : 'days'} until ${trip?.destination?.split(',')[0] || trip?.name}!`
              : `${status.countdown}. Have fun!`}
          </Text>
        </Card>
      ) : null}
      <Segmented<'packing' | 'group'>
        options={[
          { value: 'packing', label: 'My packing list' },
          { value: 'group', label: 'Group tasks' },
        ]}
        value={list}
        onChange={setList}
      />
      <Card testID="prep-list">
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="heading">{list === 'packing' ? 'Packing list' : 'To do together'}</Text>
          <Text variant="label" color={t.primary} testID="prep-count">{p.total ? `${p.done}/${p.total}` : ''}</Text>
        </Row>
        {p.total ? <ProgressBar value={p.percent} label={`${p.done} of ${p.total} done`} /> : null}
        {p.total > 0 && p.done === p.total ? (
          <View style={{ backgroundColor: t.yellowSoft, borderRadius: radius.md, padding: space.sm }}>
            <Text variant="label" color={t.yellowText} center testID="prep-celebrate">
              {list === 'packing' ? '🎉 All packed! See you at the airport.' : '🎉 Everything’s done. Nice teamwork!'}
            </Text>
          </View>
        ) : null}
        {items.length === 0 ? (
          <Text variant="caption" muted>
            {list === 'packing' ? 'Only you can see your packing list.' : 'Shared with everyone: book the ferry, buy the tickets, reserve dinner…'}
          </Text>
        ) : (
          <View>{[...items].sort((a, b) => Number(a.done) - Number(b.done)).map(row)}</View>
        )}
        {active ? (
          <Stack gap={space.sm}>
            <Row gap={space.sm} align="flex-end">
              <Field
                value={title}
                onChangeText={setTitle}
                placeholder={list === 'packing' ? 'Add an item' : 'Add a task'}
                maxLength={120}
                style={{ flex: 1 }}
                onSubmitEditing={add}
                testID="prep-input"
              />
              <Button title="Add" small onPress={add} disabled={!title.trim()} testID="prep-add" />
            </Row>
            {list === 'group' && members.length > 1 ? (
              <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
                <Text variant="caption" muted>For:</Text>
                <Chip label="Anyone" selected={!assignee} onPress={() => setAssignee(null)} />
                {members.map((m) => (
                  <Chip key={m.user_id} label={m.user_id === me ? 'Me' : firstName(m.profile.display_name || 'Friend')} selected={assignee === m.user_id} onPress={() => setAssignee(m.user_id)} />
                ))}
              </Row>
            ) : null}
            {starters.length > 0 ? (
              <Button
                title={`Add ${starters.length} common items`}
                icon="checklist"
                kind="secondary"
                small
                onPress={() => run(() => addTasks(id, 'packing', starters))}
                testID="prep-starters"
                style={{ alignSelf: 'flex-start' }}
              />
            ) : null}
          </Stack>
        ) : null}
      </Card>
      {list === 'group' && members.length > 1 ? (
        <Row gap={space.xs}>
          {members.slice(0, 6).map((m) => {
            const mine = (tasks.data ?? []).filter((x) => x.kind === 'group' && x.assignee_id === m.user_id);
            return mine.length ? (
              <View key={m.user_id} style={{ alignItems: 'center', gap: 2 }}>
                <Avatar id={m.user_id} name={m.profile.display_name || '?'} url={m.profile.avatar_url} size={32} />
                <Text variant="caption" faint style={{ fontSize: 11 }}>{progress(mine).done}/{mine.length}</Text>
              </View>
            ) : null;
          })}
        </Row>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}
