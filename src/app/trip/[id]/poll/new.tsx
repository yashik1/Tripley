/**
 * Start a group poll, or edit one (?pollId=…, for whoever started it or the
 * organizer): a question, 2–8 options, one choice or several, and when voting
 * closes (never, soon, or a date and time you pick).
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack as RouterStack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';

import { DateTimeField } from '@/components/DateTimeField';
import { Banner, Button, Card, Chip, Field, Loading, Row, Screen, Stack, Text } from '@/components/ui';
import { createPoll, updatePoll } from '@/lib/api';
import { combineLocal, splitLocal } from '@/lib/datetime-input';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { pollIsOpen } from '@/lib/group-decisions';
import { keys, usePolls } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import type { Poll } from '@/lib/types';
import { space, useTheme } from '@/theme';

const CLOSING: { key: string; label: string; ms: number | null }[] = [
  { key: 'never', label: 'Until I close it', ms: null },
  { key: '1h', label: 'In 1 hour', ms: 3_600_000 },
  { key: '1d', label: 'In 1 day', ms: 86_400_000 },
  { key: '3d', label: 'In 3 days', ms: 3 * 86_400_000 },
  { key: 'pick', label: 'Pick a date and time', ms: null },
];

export default function PollForm() {
  const id = useTripId();
  const { pollId } = useLocalSearchParams<{ pollId?: string }>();
  const { me, isOrganizer } = useTripData(id);
  const polls = usePolls(id);
  if (!pollId) return <Form tripId={id} />;
  if (polls.isLoading) return <Loading />;
  const poll = polls.data?.find((p) => p.id === pollId);
  if (!poll || !pollIsOpen(poll) || (poll.created_by !== me && !isOrganizer)) {
    return (
      <Screen>
        <RouterStack.Screen options={{ title: 'Edit poll' }} />
        <Banner tone="info" title="This poll can’t be edited">
          {!poll ? 'It may have been removed.' : !pollIsOpen(poll) ? 'It’s closed.' : 'Only whoever started it, or the organizer, can edit it.'}
        </Banner>
        <Button title="Back" kind="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }
  return <Form key={poll.id} tripId={id} poll={poll} />;
}

type Option = { id: string | null; label: string; votes: number };

function Form({ tripId, poll }: { tripId: string; poll?: Poll }) {
  const t = useTheme();
  const qc = useQueryClient();
  const editing = !!poll;
  const [question, setQuestion] = useState(poll?.question ?? '');
  const [options, setOptions] = useState<Option[]>(
    poll
      ? [...poll.poll_options]
          .sort((a, b) => a.position - b.position)
          .map((o) => ({ id: o.id, label: o.label, votes: poll.poll_votes.filter((v) => v.option_id === o.id).length }))
      : [
          { id: null, label: '', votes: 0 },
          { id: null, label: '', votes: 0 },
        ],
  );
  const initialClose = splitLocal(poll?.closes_at ?? null);
  const [closing, setClosing] = useState(poll?.closes_at ? 'pick' : 'never');
  const [closeDay, setCloseDay] = useState(initialClose.day);
  const [closeTime, setCloseTime] = useState(initialClose.time || '20:00');
  const [allowChange, setAllowChange] = useState(poll?.allow_change ?? true);
  const [multiple, setMultiple] = useState(poll?.multiple ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removedVotes = poll
    ? poll.poll_options.filter((o) => !options.some((x) => x.id === o.id)).reduce((n, o) => n + poll.poll_votes.filter((v) => v.option_id === o.id).length, 0)
    : 0;

  const closesAt = (): string | null | undefined => {
    if (closing === 'pick') {
      const iso = combineLocal(closeDay, closeTime);
      return iso ?? undefined;
    }
    const ms = CLOSING.find((c) => c.key === closing)?.ms ?? null;
    return ms ? new Date(Date.now() + ms).toISOString() : null;
  };

  const save = async () => {
    setError(null);
    const list = options.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label);
    if (!question.trim()) return setError('What do you want to ask?');
    const distinct = new Set(list.map((o) => o.label.toLowerCase()));
    if (distinct.size < 2) return setError('Give at least two different options.');
    if (distinct.size !== list.length) return setError('Two options are the same.');
    const when = closesAt();
    if (when === undefined) return setError('Pick the day and time voting closes.');
    if (when && Date.parse(when) <= Date.now()) return setError('The closing time has to be in the future.');
    setBusy(true);
    try {
      if (poll) {
        await updatePoll(poll.id, { question: question.trim(), options: list.map((o) => ({ id: o.id, label: o.label })), closesAt: when, allowChange, multiple });
      } else {
        await createPoll(tripId, question.trim(), list.map((o) => o.label), when, allowChange, multiple);
      }
      await qc.invalidateQueries({ queryKey: keys.polls(tripId) });
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/trip/[id]/polls', params: { id: tripId } });
    } catch (e) {
      setError(isNetworkError(e) ? 'No connection. Try again when you’re back online.' : errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button title={editing ? 'Save changes' : 'Ask the group'} icon={editing ? 'check' : 'poll'} onPress={save} loading={busy} testID="save-poll" />}>
      <RouterStack.Screen options={{ title: editing ? 'Edit poll' : 'New poll' }} />
      <Field label="Question" testID="poll-question" value={question} onChangeText={setQuestion} placeholder="Where should we eat tonight?" maxLength={200} />
      <Stack gap={space.sm}>
        <Text variant="label" muted>Options</Text>
        {options.map((o, i) => (
          <Row key={o.id ?? `new-${i}`} gap={space.sm}>
            <Field
              testID={`poll-opt-${i}`}
              value={o.label}
              onChangeText={(v) => setOptions((list) => list.map((x, j) => (j === i ? { ...x, label: v } : x)))}
              placeholder={['Taberna da Rua', 'Pizza by the river', 'Ramen bar'][i] ?? `Option ${i + 1}`}
              maxLength={120}
              style={{ flex: 1 }}
              hint={o.votes ? `${o.votes} ${o.votes === 1 ? 'vote' : 'votes'}` : undefined}
            />
            {options.length > 2 ? (
              <Button
                title="✕"
                kind="ghost"
                small
                onPress={() => setOptions((list) => list.filter((_, j) => j !== i))}
                testID={`poll-remove-${i}`}
              />
            ) : null}
          </Row>
        ))}
        {options.length < 8 ? (
          <Button
            title="Add an option"
            icon="add"
            kind="secondary"
            small
            onPress={() => setOptions((list) => [...list, { id: null, label: '', votes: 0 }])}
            testID="poll-add-option"
            style={{ alignSelf: 'flex-start' }}
          />
        ) : null}
        {removedVotes ? (
          <Banner tone="warning">{`Removing ${removedVotes === 1 ? 'an option with a vote also removes that vote' : `options also removes their ${removedVotes} votes`}.`}</Banner>
        ) : null}
      </Stack>

      <Card>
        <Row gap={space.md}>
          <View style={{ flex: 1 }}>
            <Text variant="label">People can pick more than one</Text>
            <Text variant="caption" muted>{multiple ? 'Tick every option that works for you.' : 'One choice each.'}</Text>
          </View>
          <Switch
            value={multiple}
            onValueChange={setMultiple}
            trackColor={{ true: t.primary, false: t.border }}
            thumbColor="#fff"
            accessibilityLabel="People can pick more than one"
            testID="poll-multiple"
          />
        </Row>
        {editing && poll?.multiple && !multiple ? (
          <Text variant="caption" muted>Anyone who picked several options keeps their first pick.</Text>
        ) : null}
        <Row gap={space.md}>
          <View style={{ flex: 1 }}>
            <Text variant="label">People can change their vote</Text>
            <Text variant="caption" muted>{allowChange ? 'Until the poll closes.' : multiple ? 'Picks can be added but not taken back.' : 'Their first answer counts.'}</Text>
          </View>
          <Switch
            value={allowChange}
            onValueChange={setAllowChange}
            trackColor={{ true: t.primary, false: t.border }}
            thumbColor="#fff"
            accessibilityLabel="People can change their vote"
          />
        </Row>
      </Card>

      <Card>
        <Text variant="label">Voting closes</Text>
        <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
          {CLOSING.map((c) => (
            <Chip key={c.key} label={c.label} selected={closing === c.key} onPress={() => setClosing(c.key)} testID={`poll-close-${c.key}`} />
          ))}
        </Row>
        {closing === 'pick' ? (
          <Row gap={space.md} align="flex-start">
            <DateTimeField mode="date" label="Day" value={closeDay} onChangeText={setCloseDay} style={{ flex: 1 }} testID="poll-close-day" />
            <DateTimeField mode="time" label="Time" value={closeTime} onChangeText={setCloseTime} style={{ flex: 1 }} testID="poll-close-time" />
          </Row>
        ) : null}
      </Card>
      {editing ? <Text variant="caption" faint>Everyone sees the poll marked as edited.</Text> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}
