/**
 * A trip's photo (its cover, or the famous photo of its destination) as the
 * page background: blurred and tinted behind the whole page, with a "sheet"
 * behind the content column so text stays readable (WCAG AA) whatever the
 * photo. Wide screens show the photo in the margins; the trip overview lets
 * it glow through at the top, behind the cover.
 */
import { Image } from 'expo-image';
import { createContext, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { BACKDROP_TINT, SHEET_TINT } from '@/lib/palettes';
import { useTheme } from '@/theme';

/** The photo to put behind every screen of a trip (set by the trip's layout). */
export const ScreenBackdropContext = createContext<string | null>(null);

/** The blurred photo behind the whole page (it doesn't scroll). */
export function PageBackdrop({ url }: { url: string }) {
  const t = useTheme();
  return (
    <View pointerEvents="none" testID="place-backdrop" style={StyleSheet.absoluteFill}>
      <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={14} accessibilityIgnoresInvertColors />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg, opacity: BACKDROP_TINT[t.scheme] }]} />
    </View>
  );
}

/** Behind the content column: the page colour, so text reads well. `reveal`: px at the top where the photo fades in. */
export function ContentSheet({ reveal = 0 }: { reveal?: number }) {
  const t = useTheme();
  const id = `sheet${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const solid = SHEET_TINT[t.scheme];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {reveal > 0 ? (
        <Svg width="100%" height={reveal} viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={t.bg} stopOpacity={0} />
              <Stop offset="1" stopColor={t.bg} stopOpacity={solid} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="1" height="1" fill={`url(#${id})`} />
        </Svg>
      ) : null}
      <View style={{ position: 'absolute', top: reveal, left: 0, right: 0, bottom: 0, backgroundColor: t.bg, opacity: solid }} />
    </View>
  );
}
