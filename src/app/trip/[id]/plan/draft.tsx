/**
 * Tripley Pro: draft the plan with AI. Choose a pace and anything to keep in
 * mind; the draft uses the bucket list (most-voted first), decided polls, the
 * plan so far and bookings. Nothing is added until you pick the stops you want.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, Button, Card, Chip, Field, Loading, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { addItineraryItem, addSuggestionToPlan, draftPlan, isPro, ScanError, type PlanDraft } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { newClientId } from '@/lib/ids';
import { keys, useAccount } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { space, useTheme } from '@/theme';

const PACES = [
  { key: 'relaxed', label: 'Relaxed' },
  { key: 'balanced', label: 'Balanced' },
  { key: 'packed', label: 'Packed' },
] as const;

export default function DraftPlan() {
  const id = useTripId();
  const t = useTheme();
  const qc = useQueryClient();
  const { trip, loading } = useTripData(id);
  const account = useAccount();
  const [pace, setPace] = useState<(typeof PACES)[number]['key']>('balanced');
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'draft' | 'add' | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (loading || !trip || account.isLoading) return <Loading />;

  if (!isPro(account.data)) {
    return (
      <Screen>
        <Banner tone="info" icon="sparkles" title="Draft the plan with AI">
          Tripley Pro drafts a day-by-day plan from your bucket list, polls and bookings, for the group to pick from.
        </Banner>
        <Button title="See Tripley Pro" onPress={() => router.push('/pro')} testID="plan-draft-pro" />
      </Screen>
    );
  }

  const keyOf = (day: string, i: number) => `${day}#${i}`;
  const make = async () => {
    setBusy('draft');
    setError(null);
    try {
      const res = await draftPlan(id, pace, notes.trim(), newClientId());
      setDraft(res.draft);
      setPicked(new Set(res.draft.days.flatMap((d) => d.stops.map((_, i) => keyOf(d.day, i)))));
    } catch (e) {
      setError(e instanceof ScanError ? e.message : errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (!draft) return;
    setBusy('add');
    setError(null);
    try {
      for (const d of draft.days) {
        for (const [i, s] of d.stops.entries()) {
          if (!picked.has(keyOf(d.day, i))) continue;
          if (s.suggestion_id) await addSuggestionToPlan(s.suggestion_id, d.day, s.starts_at);
          else
            await addItineraryItem(id, {
              day: d.day,
              title: s.title,
              starts_at: s.starts_at,
              ends_at: s.ends_at,
              place_name: s.place_name,
              address: null,
              lat: null,
              lng: null,
              notes: s.notes,
            });
        }
      }
      await Promise.all([qc.invalidateQueries({ queryKey: keys.itinerary(id) }), qc.invalidateQueries({ queryKey: keys.suggestions(id) })]);
      router.back();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <Screen
      footer={
        draft ? (
          <Button title={`Add ${picked.size} to the plan`} icon="check" onPress={add} loading={busy === 'add'} disabled={picked.size === 0} testID="plan-draft-add" />
        ) : (
          <Button title="Draft it" icon="sparkles" onPress={make} loading={busy === 'draft'} testID="plan-draft-make" />
        )
      }>
      <Stack gap={space.xs}>
        <Text variant="title">Draft the plan</Text>
        <Text muted>From your bucket list (most-voted first), what the group decided, and around plans and bookings you already have.</Text>
      </Stack>
      {!draft ? (
        <>
          <Row gap={space.xs}>
            {PACES.map((p) => (
              <Chip key={p.key} label={p.label} selected={pace === p.key} onPress={() => setPace(p.key)} testID={`plan-draft-pace-${p.key}`} />
            ))}
          </Row>
          <Field label="Anything to keep in mind? (optional)" value={notes} onChangeText={setNotes} placeholder="Museums and food, one beach day, slow mornings" maxLength={300} testID="plan-draft-notes" />
          <Text variant="caption" faint>Uses one of your monthly AI requests. Your trip’s ideas, plans and booking times are sent to Anthropic to write it.</Text>
        </>
      ) : (
        <>
          {draft.notes ? <Text variant="caption" muted>{draft.notes}</Text> : null}
          {draft.days.map((d) => (
            <Stack key={d.day} gap={space.sm}>
              <SectionTitle>{formatDate(d.day)}</SectionTitle>
              <Card>
                {d.stops.map((s, i) => {
                  const k = keyOf(d.day, i);
                  const on = picked.has(k);
                  return (
                    <Row key={k} gap={space.sm} style={{ alignItems: 'flex-start' }}>
                      <Chip
                        label={on ? '✓' : '+'}
                        selected={on}
                        onPress={() => setPicked((x) => { const n = new Set(x); if (on) n.delete(k); else n.add(k); return n; })}
                        testID={`plan-draft-pick-${s.title}`}
                      />
                      <View style={{ flex: 1 }}>
                        <Text variant="label">{[s.starts_at, s.title].filter(Boolean).join(' · ')}</Text>
                        {s.place_name || s.notes ? <Text variant="caption" muted>{[s.place_name, s.notes].filter(Boolean).join(' · ')}</Text> : null}
                        {s.suggestion_id ? <Text variant="caption" color={t.primary}>From the bucket list</Text> : null}
                      </View>
                    </Row>
                  );
                })}
              </Card>
            </Stack>
          ))}
          <Button title="Start again" kind="ghost" small onPress={() => setDraft(null)} style={{ alignSelf: 'flex-start' }} />
        </>
      )}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}
