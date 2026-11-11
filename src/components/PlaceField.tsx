/**
 * A text field that searches real places as you type, by name ("Time Out
 * Market") or address ("Av. 24 de Julho 49"). Picking a result hands back its
 * full address and map point; you can still type freely, and the form shows
 * whether what's there was found on the map.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { GEOCODER_ATTRIBUTION, searchPlaces, type GeoResult, type SearchScope } from '@/lib/geocode';
import { radius, space, useTheme } from '@/theme';
import { Icon } from './Icon';
import { Text } from './ui';

type Status = { kind: 'idle' } | { kind: 'searching' } | { kind: 'done'; results: GeoResult[] } | { kind: 'error'; message: string };

const cache = new Map<string, GeoResult[]>();

export function PlaceField({
  label,
  value,
  onChangeText,
  onPick,
  near,
  scope = 'any',
  placeholder,
  maxLength = 300,
  found,
  testID,
  style,
}: {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  onPick: (result: GeoResult) => void;
  /** Rank results near here first (the trip's destination, pins, or where you are). */
  near?: { lat: number; lng: number } | null;
  /** 'area' finds towns, regions and countries only (for a trip destination). */
  scope?: SearchScope;
  placeholder?: string;
  maxLength?: number;
  /** What's in the field was picked from search: shown with a tick. */
  found?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  // What to search for: only text the person typed, never text a pick filled in.
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const nearKey = near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : '';
  const nearRef = useRef(near);
  useEffect(() => {
    nearRef.current = near;
  });

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    const key = `${scope}|${nearKey}|${q.toLowerCase()}`;
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        const cached = cache.get(key);
        if (cached) return setStatus({ kind: 'done', results: cached });
        setStatus({ kind: 'searching' });
        try {
          const results = await searchPlaces(q, { near: nearRef.current, scope, signal: controller.signal });
          cache.set(key, results);
          if (cache.size > 100) cache.delete(cache.keys().next().value!);
          setStatus({ kind: 'done', results });
        } catch (e) {
          if ((e as { name?: string })?.name === 'AbortError') return;
          setStatus({ kind: 'error', message: (e as Error).message });
        }
      },
      cache.has(key) ? 0 : 350,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, scope, nearKey]);

  const showList = query.trim().length >= 3 && status.kind !== 'idle';

  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text variant="label" muted>{label}</Text> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          minHeight: 48,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: found ? t.primary : t.border,
          backgroundColor: t.surface,
          paddingHorizontal: space.md,
        }}>
        <Icon name="search" size={18} color={t.textMuted} />
        <TextInput
          testID={testID}
          value={value}
          onChangeText={(text) => {
            setQuery(text);
            if (text.trim().length < 3) setStatus({ kind: 'idle' });
            onChangeText(text);
          }}
          placeholder={placeholder ?? 'Search by name or address'}
          placeholderTextColor={t.textFaint}
          maxLength={maxLength}
          autoCorrect={false}
          accessibilityLabel={label ?? 'Search for a place'}
          style={{ flex: 1, minWidth: 0, fontSize: 16, color: t.text, paddingVertical: space.sm }}
        />
        {status.kind === 'searching' ? <ActivityIndicator size="small" color={t.textMuted} /> : null}
        {found ? <Icon name="check" size={18} color={t.primary} /> : null}
      </View>

      {showList ? (
        <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, overflow: 'hidden' }} testID={testID ? `${testID}-results` : undefined}>
          {status.kind === 'error' ? (
            <Text variant="caption" muted style={{ padding: space.md }}>{status.message}</Text>
          ) : status.kind === 'done' && status.results.length === 0 ? (
            <Text variant="caption" muted style={{ padding: space.md }}>
              No places found. Check the spelling, or add the town (“Manteigaria, Lisbon”).
            </Text>
          ) : status.kind === 'done' ? (
            <>
              {status.results.map((r, i) => (
                <Pressable
                  key={r.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.name}, ${r.address}`}
                  testID={testID ? `${testID}-result-${i}` : undefined}
                  onPress={() => {
                    setQuery('');
                    setStatus({ kind: 'idle' });
                    onPick(r);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    gap: space.sm,
                    padding: space.md,
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: t.border,
                    backgroundColor: pressed ? t.surfaceAlt : 'transparent',
                  })}>
                  <Icon name="pin" size={18} color={t.primary} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="label" numberOfLines={1}>{r.name}</Text>
                    <Text variant="caption" muted numberOfLines={2}>{r.address}</Text>
                  </View>
                </Pressable>
              ))}
              <Text variant="caption" faint style={{ paddingHorizontal: space.md, paddingBottom: space.sm, fontSize: 11 }}>
                {GEOCODER_ATTRIBUTION}
              </Text>
            </>
          ) : (
            <Text variant="caption" muted style={{ padding: space.md }}>Searching…</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

/** Under a place field: whether what's there is a real place on the map. */
export function FoundNote({ found, typed, testID }: { found: { address: string } | null; typed: string; testID?: string }) {
  const t = useTheme();
  if (found) {
    return (
      <Text variant="caption" color={t.primary} testID={testID}>
        {`✓ Found on the map: ${found.address}`}
      </Text>
    );
  }
  if (!typed.trim()) return null;
  return (
    <Text variant="caption" muted testID={testID}>
      Not checked on the map yet. Pick a search result so friends can find it and get directions.
    </Text>
  );
}
