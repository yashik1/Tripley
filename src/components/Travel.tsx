/**
 * Travel-flavoured building blocks: trip covers (the trip's photo, or an
 * illustrated postcard when there isn't one), avatar stacks, progress bars,
 * status pills, quick-action tiles and skeleton placeholders.
 *
 * Motion is gentle and switched off when the device asks for reduced motion.
 */
import { Image } from 'expo-image';
import { useEffect, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { usePhotoUrl } from '@/lib/queries';
import type { TripStatusKind } from '@/lib/trip-status';
import { radius, space, useTheme } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Avatar, Text } from './ui';

// ------------------------------------------------------------------ covers

const SCENES = [
  { sky: ['#BFEAE4', '#F4FBF9'], sun: '#F5C451', far: '#93D7CD', near: '#3DB9A9', front: '#117C78' },
  { sky: ['#FFD8CE', '#FFF5EE'], sun: '#FF806E', far: '#F7C1B2', near: '#EE937D', front: '#B85540' },
  { sky: ['#CDE1FF', '#F3F8FF'], sun: '#F5C451', far: '#A6C6F7', near: '#5C97F2', front: '#2F5FA8' },
  { sky: ['#FCEBC0', '#FFFAEC'], sun: '#FF806E', far: '#F3D88E', near: '#E9BD4F', front: '#A97A12' },
  { sky: ['#E3DBFF', '#F8F5FF'], sun: '#F5C451', far: '#C6B8F5', near: '#9B86E8', front: '#5B45B0' },
] as const;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** An illustrated postcard: sky, sun, hills and water, coloured per trip. */
export function Postcard({ seed, emoji }: { seed: string; emoji?: string }) {
  const h = hash(seed);
  const c = SCENES[h % SCENES.length];
  const sunX = 70 + (h % 260);
  const id = `sky${h}`;
  return (
    <View style={{ position: 'absolute', inset: 0 }}>
      <Svg width="100%" height="100%" viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={c.sky[0]} />
            <Stop offset="1" stopColor={c.sky[1]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="400" height="160" fill={`url(#${id})`} />
        <Circle cx={sunX} cy="48" r="22" fill={c.sun} opacity={0.9} />
        <Path d="M0 108 L60 70 L110 96 L170 52 L240 100 L300 64 L400 104 L400 160 L0 160 Z" fill={c.far} />
        <Path d="M0 124 C60 100 120 132 190 112 C260 92 320 124 400 108 L400 160 L0 160 Z" fill={c.near} />
        <Path d="M0 142 C80 128 140 152 220 138 C290 126 340 146 400 136 L400 160 L0 160 Z" fill={c.front} />
      </Svg>
      {emoji ? (
        <Text style={{ position: 'absolute', right: 16, bottom: 12, fontSize: 30 }}>
          {emoji}
        </Text>
      ) : null}
    </View>
  );
}

/** The trip's cover photo (private, via a short-lived link), or a postcard. */
export function TripCover({
  seed,
  path,
  height,
  rounded = radius.lg,
  children,
  style,
}: {
  seed: string;
  path?: string | null;
  height: number;
  rounded?: number;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const url = usePhotoUrl(path);
  return (
    <View style={[{ height, borderRadius: rounded, overflow: 'hidden', backgroundColor: t.surfaceAlt }, style]}>
      <Postcard seed={seed} />
      {url.data ? (
        <Image
          source={{ uri: url.data }}
          style={{ position: 'absolute', inset: 0 }}
          contentFit="cover"
          transition={200}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {children}
    </View>
  );
}

// ------------------------------------------------------------------ people

export function AvatarStack({
  people,
  total,
  size = 30,
}: {
  people: { id: string; name: string; url?: string | null }[];
  total?: number;
  size?: number;
}) {
  const t = useTheme();
  const shown = people.slice(0, 4);
  const more = Math.max(0, (total ?? people.length) - shown.length);
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center' }}
      accessible
      accessibilityLabel={`${total ?? people.length} ${(total ?? people.length) === 1 ? 'person' : 'people'}: ${shown.map((p) => p.name).join(', ')}${more ? ` and ${more} more` : ''}`}>
      {shown.map((p, i) => (
        <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -size * 0.3, borderRadius: size, borderWidth: 2, borderColor: t.surface }}>
          <Avatar id={p.id} name={p.name} url={p.url} size={size} />
        </View>
      ))}
      {more > 0 ? (
        <View
          style={{
            marginLeft: -size * 0.3,
            width: size + 4,
            height: size + 4,
            borderRadius: size,
            borderWidth: 2,
            borderColor: t.surface,
            backgroundColor: t.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text variant="caption" muted style={{ fontWeight: '700', fontSize: 11 }}>+{more}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ progress

export function ProgressBar({ value, color, height = 8, label }: { value: number; color?: string; height?: number; label?: string }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const width = useSharedValue(reduced ? value : 0);
  useEffect(() => {
    width.value = reduced ? value : withTiming(value, { duration: 600 });
  }, [value, reduced, width]);
  const fill = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(100, width.value))}%` }));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value) }}
      style={{ height, borderRadius: height, backgroundColor: t.surfaceAlt, overflow: 'hidden' }}>
      <Animated.View style={[{ height, borderRadius: height, backgroundColor: color ?? t.accent }, fill]} />
    </View>
  );
}

// ------------------------------------------------------------------ status

export function StatusPill({ kind, label }: { kind: TripStatusKind; label: string }) {
  const t = useTheme();
  const colors: Record<TripStatusKind, [string, string]> = {
    planning: [t.yellowSoft, t.yellowText],
    upcoming: [t.primarySoft, t.primary],
    ongoing: [t.coralSoft, t.coralText],
    completed: [t.surfaceAlt, t.textMuted],
  };
  const [bg, fg] = colors[kind];
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
      <Text variant="caption" color={fg} style={{ fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ actions

export function QuickAction({
  icon,
  label,
  color,
  soft,
  onPress,
  testID,
}: {
  icon: IconName;
  label: string;
  color: string;
  soft: string;
  onPress: () => void;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexBasis: 96,
        flexGrow: 1,
        minHeight: 92,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.sm,
        padding: space.sm,
        borderRadius: radius.lg,
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: hovered ? color : t.border,
        boxShadow: t.shadow,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}>
      <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: soft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={22} color={color} />
      </View>
      <Text variant="caption" center style={{ fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

// ------------------------------------------------------------------ loading

/** A soft pulsing block shown while content loads (still when reduced motion is on). */
export function Skeleton({ height, width = '100%', rounded = radius.md, style }: { height: number; width?: number | `${number}%`; rounded?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (!reduced) o.value = withRepeat(withTiming(0.5, { duration: 800 }), -1, true);
  }, [reduced, o]);
  const pulse = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View accessibilityLabel="Loading" style={[{ height, width, borderRadius: rounded, backgroundColor: t.surfaceAlt }, pulse, style]} />;
}
