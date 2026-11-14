/**
 * Food Explorer: the group's food discoveries. Each find is a dish, a
 * restaurant or a food experience, with where it was, notes and a photo.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { PhotoGrid } from '@/components/FeedPost';
import { FunIntro, PhotoPicker, type PickedPhoto } from '@/components/TripFun';
import { Banner, Button, Card, Chip, EmptyState, Field, Row, Screen, Segmented, Stack, Text } from '@/components/ui';
import { addFunEntry, deleteFunEntry, uploadTripPhoto } from '@/lib/api';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { firstName, timeAgo } from '@/lib/format';
import { keys, useFunEntries } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { FOOD_KINDS, foodEmoji } from '@/lib/trip-fun';
import type { FoodKind } from '@/lib/types';
import { space } from '@/theme';

export default function FoodExplorer() {
  const id = useTripId();
  const qc = useQueryClient();
  const { me, nameOf } = useTripData(id);
  const entries = useFunEntries(id);
  const [kind, setKind] = useState<FoodKind>('dish');
  const [title, setTitle] = useState('');
  const [where, setWhere] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<PickedPhoto[]>([]);
  const [filter, setFilter] = useState<FoodKind | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finds = useMemo(() => (entries.data ?? []).filter((e) => e.kind === 'food'), [entries.data]);
  const shown = filter === 'all' ? finds : finds.filter((e) => (e.food_kind ?? 'dish') === filter);

  const add = async () => {
    if (picking) return;
    setError(null);
    if (!title.trim()) return setError(kind === 'restaurant' ? 'What’s the restaurant called?' : 'What was it?');
    try {
      let path: string | null = null;
      if (photo[0]?.uri) {
        setBusy('Uploading the photo…');
        path = await uploadTripPhoto(id, photo[0].uri);
      }
      setBusy('Saving…');
      await addFunEntry(id, me, { kind: 'food', title, details: notes, food_kind: kind, place_name: where, photo_path: path });
      setTitle('');
      setWhere('');
      setNotes('');
      setPhoto([]);
      await qc.invalidateQueries({ queryKey: keys.tripFun(id) });
    } catch (e) {
      setError(isNetworkError(e) ? 'No connection. Try again when you’re back online.' : errorMessage(e));
    } finally {
      setBusy(null);
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
      <FunIntro emoji="🍜" title="Food Explorer" blurb="Dishes, restaurants and food moments the group discovered. Everyone on the trip can see and add them." />
      <Card>
        <Text variant="heading">Add a food find</Text>
        <Segmented<FoodKind> options={FOOD_KINDS.map((k) => ({ value: k.value, label: `${k.emoji} ${k.label}` }))} value={kind} onChange={setKind} />
        <Field
          label={kind === 'restaurant' ? 'Restaurant' : kind === 'experience' ? 'The experience' : 'Dish'}
          value={title}
          onChangeText={setTitle}
          placeholder={kind === 'restaurant' ? 'Taberna da Rua das Flores' : kind === 'experience' ? 'Cooking class in Alfama' : 'Pastel de nata'}
          maxLength={120}
          testID="food-title"
        />
        {kind !== 'restaurant' ? (
          <Field label="Where (optional)" value={where} onChangeText={setWhere} placeholder="Manteigaria, Chiado" maxLength={120} testID="food-where" />
        ) : null}
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Still warm, with cinnamon. Go early." multiline maxLength={1000} testID="food-notes" />
        <PhotoPicker photos={photo} onChange={setPhoto} max={1} onError={setError} onBusy={setPicking} testID="food-add-photo" />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Button title={picking ? 'Adding the photo…' : busy ?? 'Add food find'} icon="add" onPress={add} loading={!!busy} disabled={picking} testID="food-add" />
      </Card>

      {finds.length ? (
        <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
          <Chip label={`All (${finds.length})`} selected={filter === 'all'} onPress={() => setFilter('all')} />
          {FOOD_KINDS.map((k) => (
            <Chip key={k.value} label={`${k.emoji} ${k.label}`} selected={filter === k.value} onPress={() => setFilter(k.value)} testID={`food-filter-${k.value}`} />
          ))}
        </Row>
      ) : null}
      {!entries.isLoading && !finds.length ? <EmptyState icon="explore" title="No food finds yet" body="Add the first dish, restaurant or food moment." /> : null}
      <Stack gap={space.md}>
        {shown.map((e) => (
          <Card key={e.id} testID={`food-${e.title}`}>
            {e.photo_path ? <PhotoGrid paths={[e.photo_path]} /> : null}
            <View style={{ gap: 2 }}>
              <Text variant="heading">{foodEmoji(e.food_kind)} {e.title}</Text>
              <Text variant="caption" muted>
                {[FOOD_KINDS.find((k) => k.value === (e.food_kind ?? 'dish'))?.label, e.place_name].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {e.details ? <Text>{e.details}</Text> : null}
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="caption" faint>{e.created_by === me ? 'You' : firstName(nameOf(e.created_by))} · {timeAgo(e.created_at)}</Text>
              {e.created_by === me ? <Button title="Remove" small kind="ghost" onPress={() => remove(e.id)} /> : null}
            </Row>
          </Card>
        ))}
      </Stack>
    </Screen>
  );
}
