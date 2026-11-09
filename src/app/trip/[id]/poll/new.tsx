/** Start a group poll: a question, 2–8 options, optionally a closing time. */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';

import { Banner, Button, Card, Chip, Field, Row, Screen, Stack, Text } from '@/components/ui';
import { createPoll } from '@/lib/api';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { keys } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { space, useTheme } from '@/theme';

const CLOSING: { key: string; label: string; ms: number | null }[] = [
  { key: 'never', label: 'Until I close it', ms: null },
  { key: '1h', label: 'In 1 hour', ms: 3_600_000 },
  { key: '1d', label: 'In 1 day', ms: 86_400_000 },
  { key: '3d', label: 'In 3 days', ms: 3 * 86_400_000 },
];

export default function NewPoll() {
  const id = useTripId();
  const t = useTheme();
  const qc = useQueryClient();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [closing, setClosing] = useState('never');
  const [allowChange, setAllowChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim()) return setError('What do you want to ask?');
    if (new Set(opts.map((o) => o.toLowerCase())).size < 2) return setError('Give at least two different options.');
    const ms = CLOSING.find((c) => c.key === closing)?.ms ?? null;
    setBusy(true);
    try {
      await createPoll(id, question.trim(), opts, ms ? new Date(Date.now() + ms).toISOString() : null, allowChange);
      await qc.invalidateQueries({ queryKey: keys.polls(id) });
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/trip/[id]/polls', params: { id } });
    } catch (e) {
      setError(isNetworkError(e) ? 'No connection. Try again when you’re back online.' : errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button title="Ask the group" icon="poll" onPress={save} loading={busy} testID="save-poll" />}>
      <Field label="Question" testID="poll-question" value={question} onChangeText={setQuestion} placeholder="Where should we eat tonight?" maxLength={200} />
      <Stack gap={space.sm}>
        <Text variant="label" muted>Options</Text>
        {options.map((o, i) => (
          <Row key={i} gap={space.sm}>
            <Field
              testID={`poll-opt-${i}`}
              value={o}
              onChangeText={(v) => setOptions((list) => list.map((x, j) => (j === i ? v : x)))}
              placeholder={['Taberna da Rua', 'Pizza by the river', 'Ramen bar'][i] ?? `Option ${i + 1}`}
              maxLength={120}
              style={{ flex: 1 }}
            />
            {options.length > 2 ? <Button title="✕" kind="ghost" small onPress={() => setOptions((list) => list.filter((_, j) => j !== i))} /> : null}
          </Row>
        ))}
        {options.length < 8 ? (
          <Button title="Add an option" icon="add" kind="secondary" small onPress={() => setOptions((list) => [...list, ''])} testID="poll-add-option" style={{ alignSelf: 'flex-start' }} />
        ) : null}
      </Stack>
      <Card>
        <Text variant="label">Voting closes</Text>
        <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
          {CLOSING.map((c) => (
            <Chip key={c.key} label={c.label} selected={closing === c.key} onPress={() => setClosing(c.key)} />
          ))}
        </Row>
        <Row gap={space.md}>
          <View style={{ flex: 1 }}>
            <Text variant="label">People can change their vote</Text>
            <Text variant="caption" muted>{allowChange ? 'Until the poll closes.' : 'Their first answer counts.'}</Text>
          </View>
          <Switch value={allowChange} onValueChange={setAllowChange} trackColor={{ true: t.primary, false: t.border }} thumbColor="#fff" accessibilityLabel="People can change their vote" />
        </Row>
      </Card>
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}
