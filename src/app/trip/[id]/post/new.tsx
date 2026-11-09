/**
 * Post to the trip's feed: an update, photos (up to 6), a place you found, or
 * (organizer) an announcement. Photos go to the trip's private folder first.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack as RouterStack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { placeEmoji } from '@/components/TripMap.types';
import { Banner, Button, Card, Chip, Field, Row, Screen, Segmented, Stack, Text } from '@/components/ui';
import { createPost, enterChallenge, uploadTripPhoto } from '@/lib/api';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { pickPhoto } from '@/lib/photos';
import { keys, usePlaces } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import type { PostKind } from '@/lib/types';
import { useMyFix } from '@/location/compass';
import { radius, space, useTheme } from '@/theme';

type Kind = Exclude<PostKind, 'event'>;
const MAX_PHOTOS = 6;

export default function NewPost() {
  const id = useTripId();
  const t = useTheme();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ kind?: string; challenge?: string }>();
  const { isOrganizer } = useTripData(id);
  const places = usePlaces(id);
  const fix = useMyFix();
  const [kind, setKind] = useState<Kind>((['update', 'photos', 'place', 'announcement'].includes(params.kind ?? '') ? params.kind : 'update') as Kind);
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [placeName, setPlaceName] = useState('');
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const options: { value: Kind; label: string }[] = [
    { value: 'update', label: 'Update' },
    { value: 'photos', label: 'Photos' },
    { value: 'place', label: 'A find' },
    ...(isOrganizer ? [{ value: 'announcement' as Kind, label: 'Announce' }] : []),
  ];

  const addPhoto = async () => {
    setError(null);
    try {
      const uri = await pickPhoto(false);
      if (uri) setPhotos((p) => [...p, uri].slice(0, MAX_PHOTOS));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const post = async () => {
    setError(null);
    if ((kind === 'update' || kind === 'announcement') && !body.trim()) return setError('Write something first.');
    if (kind === 'photos' && photos.length === 0) return setError('Add at least one photo.');
    if (kind === 'place' && !placeName.trim()) return setError('What’s the place called?');
    try {
      const paths: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        setBusy(`Uploading photo ${i + 1} of ${photos.length}…`);
        paths.push(await uploadTripPhoto(id, photos[i]));
      }
      setBusy('Posting…');
      const postId = await createPost({
        tripId: id,
        kind,
        body: body.trim() || null,
        photos: paths,
        placeName: kind === 'place' ? placeName.trim() : null,
        lat: kind === 'place' ? point?.lat ?? null : null,
        lng: kind === 'place' ? point?.lng ?? null : null,
      });
      if (params.challenge) await enterChallenge(params.challenge, postId);
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.feed(id) }),
        qc.invalidateQueries({ queryKey: keys.recentPosts }),
        qc.invalidateQueries({ queryKey: keys.challenges(id) }),
      ]);
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/trip/[id]/feed', params: { id } });
    } catch (e) {
      setError(isNetworkError(e) ? 'No connection. Posts need a connection; try again when you’re back online.' : errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <Screen footer={<Button title={busy ?? (kind === 'announcement' ? 'Announce' : 'Post')} icon="send" onPress={post} loading={!!busy} testID="post-submit" />}>
      <RouterStack.Screen options={{ title: params.challenge ? 'Challenge entry' : 'New post' }} />
      <Segmented<Kind> options={options} value={kind} onChange={setKind} />
      <Field
        label={kind === 'announcement' ? 'Announcement for everyone' : kind === 'update' ? 'What’s happening?' : 'Add a caption (optional)'}
        testID="post-body"
        value={body}
        onChangeText={setBody}
        placeholder={
          kind === 'announcement' ? 'Meet in the lobby at 9 sharp!' : kind === 'place' ? 'Best custard tarts we’ve had' : 'Landed! Grabbing coffee near the hotel.'
        }
        maxLength={2000}
        multiline
      />

      {kind === 'place' ? (
        <Card>
          <Field label="Place" testID="post-place" value={placeName} onChangeText={setPlaceName} placeholder="Manteigaria, Chiado" maxLength={120} />
          <Text variant="caption" muted>{point ? 'On the map, with directions for the group.' : 'Add a map point so people can get directions.'}</Text>
          <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
            {fix ? <Chip label="📍 Where I am now" selected={!!point && point.lat === fix.lat} onPress={() => setPoint({ lat: fix.lat, lng: fix.lng })} testID="post-here" /> : null}
            {(places.data ?? []).slice(0, 6).map((p) => (
              <Chip
                key={p.id}
                label={`${placeEmoji(p.kind)} ${p.name}`}
                selected={point?.lat === p.lat && point?.lng === p.lng}
                onPress={() => {
                  setPoint({ lat: p.lat, lng: p.lng });
                  if (!placeName.trim()) setPlaceName(p.name);
                }}
              />
            ))}
          </Row>
        </Card>
      ) : null}

      {kind !== 'announcement' ? (
        <Stack gap={space.sm}>
          <Text variant="label" muted>Photos {photos.length ? `(${photos.length} of ${MAX_PHOTOS})` : '(optional)'}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {photos.map((uri) => (
              <View key={uri}>
                <Image source={{ uri }} style={{ width: 92, height: 92, borderRadius: radius.md, backgroundColor: t.surfaceAlt }} contentFit="cover" />
                <Pressable
                  onPress={() => setPhotos((p) => p.filter((x) => x !== uri))}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  style={{ position: 'absolute', top: 4, right: 4, backgroundColor: t.overlay, borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
                  <Text color="#fff" style={{ fontSize: 14, lineHeight: 16 }}>×</Text>
                </Pressable>
              </View>
            ))}
            {photos.length < MAX_PHOTOS ? (
              <Pressable
                onPress={addPhoto}
                accessibilityRole="button"
                testID="post-add-photo"
                style={{ width: 92, height: 92, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.border, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <Text style={{ fontSize: 22 }}>📷</Text>
                <Text variant="caption" muted>{Platform.OS === 'web' ? 'Upload' : 'Add'}</Text>
              </Pressable>
            ) : null}
          </View>
          <Text variant="caption" faint>Only people on this trip can see them.</Text>
        </Stack>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}
