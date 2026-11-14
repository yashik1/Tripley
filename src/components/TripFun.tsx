/** Pieces shared by the Trip Fun screens: the feature header and a photo picker. */
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';

import { pickPhoto } from '@/lib/photos';
import { usePhotoUrl } from '@/lib/queries';
import { radius, space, useTheme } from '@/theme';
import { Text } from './ui';

/** The emoji, title and one-line description at the top of a Trip Fun screen. */
export function FunIntro({ emoji, title, blurb }: { emoji: string; title: string; blurb: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center', backgroundColor: t.primarySoft, borderRadius: radius.lg, padding: space.lg }}>
      <Text style={{ fontSize: 30 }}>{emoji}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="heading" accessibilityRole="header">{title}</Text>
        <Text variant="caption" muted>{blurb}</Text>
      </View>
    </View>
  );
}

/** A photo for the picker: one picked on this device (uri) or one already uploaded (path). */
export type PickedPhoto = { uri?: string; path?: string };

function Thumb({ photo }: { photo: PickedPhoto }) {
  const t = useTheme();
  const url = usePhotoUrl(photo.path);
  const uri = photo.uri ?? url.data ?? undefined;
  return <Image source={uri ? { uri } : undefined} style={{ width: 92, height: 92, borderRadius: radius.md, backgroundColor: t.surfaceAlt }} contentFit="cover" />;
}

/** Up to `max` photos: add from the library (or upload on the web), remove with ×. */
export function PhotoPicker({
  photos,
  onChange,
  max,
  onError,
  onBusy,
  testID,
}: {
  photos: PickedPhoto[];
  onChange: (photos: PickedPhoto[]) => void;
  max: number;
  onError: (message: string) => void;
  /** True while a picked photo is still being prepared: hold off saving until it's in. */
  onBusy?: (busy: boolean) => void;
  testID?: string;
}) {
  const t = useTheme();
  const [adding, setAdding] = useState(false);
  const add = async () => {
    setAdding(true);
    onBusy?.(true);
    try {
      const uri = await pickPhoto(false);
      if (uri) onChange([...photos, { uri }].slice(0, max));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Couldn’t add that photo.');
    } finally {
      setAdding(false);
      onBusy?.(false);
    }
  };
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="label" muted>
        {max === 1 ? 'Photo (optional)' : `Photos ${photos.length ? `(${photos.length} of ${max})` : '(optional)'}`}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {photos.map((p, i) => (
          <View key={p.uri ?? p.path ?? i}>
            <Thumb photo={p} />
            <Pressable
              onPress={() => onChange(photos.filter((_, j) => j !== i))}
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              style={{ position: 'absolute', top: 4, right: 4, backgroundColor: t.overlay, borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
              <Text color="#fff" style={{ fontSize: 14, lineHeight: 16 }}>×</Text>
            </Pressable>
          </View>
        ))}
        {adding ? (
          // Tapping stops waiting (in case a browser never says the file dialog was closed).
          <Pressable
            onPress={() => {
              setAdding(false);
              onBusy?.(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Adding the photo. Tap to stop waiting."
            style={{ width: 92, height: 92, borderRadius: radius.md, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={t.primary} />
          </Pressable>
        ) : photos.length < max ? (
          <Pressable
            onPress={add}
            accessibilityRole="button"
            accessibilityLabel="Add a photo"
            testID={testID}
            style={{ width: 92, height: 92, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.border, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <Text style={{ fontSize: 22 }}>📷</Text>
            <Text variant="caption" muted>{Platform.OS === 'web' ? 'Upload' : 'Add'}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text variant="caption" faint>Only people on this trip can see them.</Text>
    </View>
  );
}
