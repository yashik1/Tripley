/**
 * Secret Missions (an optional extra, off unless the feature catalogue turns
 * it on): a private, fun task for one friend. Only the sender and the
 * recipient can see it (the server enforces this).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { FunIntro } from '@/components/TripFun';
import { Banner, Button, Card, Chip, EmptyState, Field, Row, Screen, Stack, Text } from '@/components/ui';
import { addFunEntry, setFunEntryDone } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { firstName } from '@/lib/format';
import { keys, useFunEntries } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { space } from '@/theme';

export default function Missions() {
  const id = useTripId();
  const qc = useQueryClient();
  const { me, members, nameOf } = useTripData(id);
  const entries = useFunEntries(id);
  const [title, setTitle] = useState('');
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missions = (entries.data ?? []).filter((e) => e.kind === 'mission');
  const refresh = () => qc.invalidateQueries({ queryKey: keys.tripFun(id) });

  const send = async () => {
    setError(null);
    if (!title.trim()) return setError('What’s the mission?');
    if (!to) return setError('Choose who gets it.');
    setBusy(true);
    try {
      await addFunEntry(id, me, { kind: 'mission', title, assigned_to: to });
      setTitle('');
      setTo(null);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (entryId: string, done: boolean) => {
    setError(null);
    try {
      await setFunEntryDone(entryId, done);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Screen>
      <FunIntro emoji="🕵️" title="Secret Missions" blurb="Give a friend a fun undercover task. Only the two of you can see it." />
      <Card>
        <Field label="Mission" value={title} onChangeText={setTitle} placeholder="Get the group to say “wow”" maxLength={120} testID="mission-title" />
        <Text variant="label" muted>For</Text>
        <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
          {members.filter((m) => m.user_id !== me).map((m) => (
            <Chip key={m.user_id} label={m.profile.display_name || 'Friend'} selected={to === m.user_id} onPress={() => setTo(m.user_id)} />
          ))}
        </Row>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Button title="Send the mission" icon="send" onPress={send} loading={busy} testID="mission-send" />
      </Card>
      {!entries.isLoading && !missions.length ? <EmptyState icon="star" title="No missions yet" body="Missions you send or get show here." /> : null}
      <Stack gap={space.md}>
        {missions.map((m) => (
          <Card key={m.id}>
            <Text variant="heading">🤫 {m.title}</Text>
            <Text variant="caption" muted>
              {m.created_by === me ? `You → ${firstName(nameOf(m.assigned_to ?? ''))}` : `From ${firstName(nameOf(m.created_by))}`}
            </Text>
            <Button title={m.is_complete ? '✓ Done' : 'Mark done'} small kind={m.is_complete ? 'secondary' : 'primary'} onPress={() => toggle(m.id, !m.is_complete)} />
          </Card>
        ))}
      </Stack>
    </Screen>
  );
}
