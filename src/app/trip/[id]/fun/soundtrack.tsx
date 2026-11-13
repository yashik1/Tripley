/**
 * Trip Soundtrack: the songs that go with the trip. Each has its title, a
 * link to it (Spotify, Apple Music, YouTube…) and the moment it goes with.
 * Tripley only links out; it never hosts or plays music.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Linking } from 'react-native';

import { FunIntro } from '@/components/TripFun';
import { Banner, Button, Card, EmptyState, Field, Row, Screen, Stack, Text } from '@/components/ui';
import { addFunEntry, deleteFunEntry } from '@/lib/api';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { firstName, timeAgo } from '@/lib/format';
import { keys, useFunEntries } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { cleanMusicLink, linkHost } from '@/lib/trip-fun';
import { space } from '@/theme';

export default function Soundtrack() {
  const id = useTripId();
  const qc = useQueryClient();
  const { me, nameOf } = useTripData(id);
  const entries = useFunEntries(id);
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [moment, setMoment] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const songs = useMemo(() => (entries.data ?? []).filter((e) => e.kind === 'soundtrack'), [entries.data]);

  const add = async () => {
    setError(null);
    if (!title.trim()) return setError('Add the song’s title (and the artist).');
    const cleaned = cleanMusicLink(link);
    setLinkError(cleaned.error);
    if (cleaned.error) return;
    setBusy(true);
    try {
      await addFunEntry(id, me, { kind: 'soundtrack', title, details: moment, link_url: cleaned.url });
      setTitle('');
      setLink('');
      setMoment('');
      await qc.invalidateQueries({ queryKey: keys.tripFun(id) });
    } catch (e) {
      setError(isNetworkError(e) ? 'No connection. Try again when you’re back online.' : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entryId: string) => {
    setError(null);
    try {
      await deleteFunEntry(entryId);
      await qc.invalidateQueries({ queryKey: keys.tripFun(id) });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Screen>
      <FunIntro emoji="🎵" title="Trip Soundtrack" blurb="Share the songs you discovered and the moments they go with." />
      <Card>
        <Text variant="heading">Add a song</Text>
        <Field label="Song — artist" value={title} onChangeText={setTitle} placeholder="Canção do Mar — Dulce Pontes" maxLength={120} testID="song-title" />
        <Field
          label="Link (optional)"
          value={link}
          onChangeText={(v) => {
            setLink(v);
            setLinkError(null);
          }}
          placeholder="https://open.spotify.com/track/…"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          error={linkError}
          hint="A share link from Spotify, Apple Music, YouTube or anywhere else."
          testID="song-link"
        />
        <Field label="The moment it goes with (optional)" value={moment} onChangeText={setMoment} placeholder="Playing in the taxi up to the castle" multiline maxLength={1000} testID="song-moment" />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Button title="Add to the soundtrack" icon="add" onPress={add} loading={busy} testID="song-add" />
        <Text variant="caption" faint>Tripley links to songs; it doesn’t host or play music.</Text>
      </Card>

      {!entries.isLoading && !songs.length ? <EmptyState icon="star" title="No songs yet" body="What song will always remind you of this trip?" /> : null}
      <Stack gap={space.md}>
        {songs.map((s) => (
          <Card key={s.id} testID={`song-${s.title}`}>
            <Text variant="heading">🎵 {s.title}</Text>
            {s.details ? <Text>{s.details}</Text> : null}
            {s.link_url ? (
              <Button
                title={`Listen on ${linkHost(s.link_url)}`}
                icon="link"
                small
                kind="secondary"
                onPress={() => Linking.openURL(s.link_url!).catch(() => setError('Couldn’t open that link.'))}
                testID="song-open"
              />
            ) : null}
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="caption" faint>{s.created_by === me ? 'You' : firstName(nameOf(s.created_by))} · {timeAgo(s.created_at)}</Text>
              {s.created_by === me ? <Button title="Remove" small kind="ghost" onPress={() => remove(s.id)} /> : null}
            </Row>
          </Card>
        ))}
      </Stack>
    </Screen>
  );
}
