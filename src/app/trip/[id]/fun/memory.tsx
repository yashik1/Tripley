/** Add a scrapbook memory, or change one of yours: caption, description, the day, photos. */
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack as RouterStack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { DateTimeField } from '@/components/DateTimeField';
import { PhotoPicker, type PickedPhoto } from '@/components/TripFun';
import { Banner, Button, Field, Screen } from '@/components/ui';
import { saveMemory, uploadTripPhoto } from '@/lib/api';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { isISODate, todayISO } from '@/lib/format';
import { keys, useMemories } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';

const MAX_PHOTOS = 6;

export default function MemoryEditor() {
  const id = useTripId();
  const qc = useQueryClient();
  const { memory: memoryId } = useLocalSearchParams<{ memory?: string }>();
  const { trip } = useTripData(id);
  const memories = useMemories(id);
  const existing = memoryId ? memories.data?.find((m) => m.id === memoryId) ?? null : null;
  if (memoryId && !existing) return <Screen>{memories.isLoading ? null : <Banner tone="warning">That memory isn’t here any more.</Banner>}</Screen>;
  return <Editor key={existing?.id ?? 'new'} tripId={id} existing={existing} defaultDay={defaultDay(trip?.ends_on ?? null)} onSaved={() => qc.invalidateQueries({ queryKey: keys.memories(id) })} />;
}

/** Today, or the trip's last day once it's over. */
function defaultDay(end: string | null): string {
  const today = todayISO();
  return end && today > end ? end : today;
}

function Editor({
  tripId,
  existing,
  defaultDay,
  onSaved,
}: {
  tripId: string;
  existing: { id: string; caption: string; description: string | null; happened_on: string; photo_paths: string[] } | null;
  defaultDay: string;
  onSaved: () => Promise<void>;
}) {
  const [caption, setCaption] = useState(existing?.caption ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [day, setDay] = useState(existing?.happened_on ?? defaultDay);
  const [photos, setPhotos] = useState<PickedPhoto[]>((existing?.photo_paths ?? []).map((path) => ({ path })));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!caption.trim()) return setError('Give the memory a caption.');
    if (!isISODate(day)) return setError('Pick the day it happened.');
    if (day > todayISO()) return setError('Pick a day that has already happened.');
    try {
      const paths: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        if (p.path) paths.push(p.path);
        else if (p.uri) {
          setBusy(`Uploading photo ${i + 1} of ${photos.length}…`);
          paths.push(await uploadTripPhoto(tripId, p.uri));
        }
      }
      setBusy('Saving…');
      await saveMemory(tripId, { caption, description: description || null, happened_on: day, photo_paths: paths }, existing?.id);
      await onSaved();
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/trip/[id]/fun/scrapbook', params: { id: tripId } });
    } catch (e) {
      setError(isNetworkError(e) ? 'No connection. Try again when you’re back online.' : errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <Screen footer={<Button title={busy ?? (existing ? 'Save changes' : 'Add to the scrapbook')} icon="check" onPress={save} loading={!!busy} testID="memory-save" />}>
      <RouterStack.Screen options={{ title: existing ? 'Edit memory' : 'Add a memory' }} />
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Field label="Caption" value={caption} onChangeText={setCaption} placeholder="Sunset at the miradouro" maxLength={120} testID="memory-caption" />
      <Field
        label="The story (optional)"
        value={description}
        onChangeText={setDescription}
        placeholder="What happened, who was there, what made it special…"
        multiline
        maxLength={2000}
        testID="memory-description"
      />
      <DateTimeField mode="date" label="The day it happened" value={day} onChangeText={setDay} max={todayISO()} testID="memory-day" />
      <PhotoPicker photos={photos} onChange={setPhotos} max={MAX_PHOTOS} onError={setError} testID="memory-add-photo" />
    </Screen>
  );
}
