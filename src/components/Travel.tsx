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
import type { TripTheme } from '@/lib/types';
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

/** A small, repeatable random sequence from the trip's id (so its art never changes). */
function seeded(h: number) {
  let x = h || 1;
  return () => {
    x = (x * 1103515245 + 12345) >>> 0;
    return (x >>> 8) / 0xffffff;
  };
}

function Sky({ id, top, bottom }: { id: string; top: string; bottom: string }) {
  return (
    <>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={top} />
          <Stop offset="1" stopColor={bottom} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="400" height="160" fill={`url(#${id})`} />
    </>
  );
}

/** One illustrated scene per trip theme. */
function ThemeScene({ theme, h }: { theme: TripTheme; h: number }) {
  const rand = seeded(h);
  const id = `${theme}${h}`;
  const sunX = 70 + (h % 260);
  switch (theme) {
    case 'beach':
      return (
        <>
          <Sky id={id} top="#9FD8F5" bottom="#E9F7FD" />
          <Circle cx={sunX} cy="42" r="22" fill="#FFD166" />
          <Rect x="0" y="92" width="400" height="40" fill="#2E86C1" />
          <Path d="M0 100 C40 94 80 106 120 100 C160 94 200 106 240 100 C280 94 320 106 360 100 C380 97 390 98 400 100 L400 108 L0 108 Z" fill="#5DADE2" />
          <Path d="M0 128 C80 116 160 134 240 124 C310 116 360 130 400 122 L400 160 L0 160 Z" fill="#F3D9A4" />
          <Path d="M332 130 C336 106 340 88 348 68" stroke="#8B5A2B" strokeWidth={5} fill="none" strokeLinecap="round" />
          <Path d="M348 68 C332 60 318 64 306 72 M348 68 C362 56 378 58 388 66 M348 68 C346 52 354 42 364 38 M348 68 C336 54 324 48 312 48" stroke="#2E7D32" strokeWidth={5} fill="none" strokeLinecap="round" />
        </>
      );
    case 'ski':
      return (
        <>
          <Sky id={id} top="#CFE3F7" bottom="#F5FAFF" />
          <Path d="M0 120 L70 62 L120 100 L190 40 L260 98 L320 58 L400 110 L400 160 L0 160 Z" fill="#A9C1DC" />
          <Path d="M190 40 L172 56 L182 54 L190 62 L198 54 L208 56 Z M70 62 L56 74 L64 73 L70 79 L76 73 L84 74 Z M320 58 L306 70 L314 69 L320 75 L326 69 L334 70 Z" fill="#FFFFFF" />
          <Path d="M0 140 L90 98 L170 132 L250 92 L330 130 L400 106 L400 160 L0 160 Z" fill="#F4F8FC" />
          {Array.from({ length: 14 }, (_, i) => (
            <Circle key={i} cx={rand() * 400} cy={rand() * 110} r={1.5 + rand() * 1.5} fill="#FFFFFF" opacity={0.9} />
          ))}
        </>
      );
    case 'city': {
      const far = [40, 70, 55, 85, 50, 75, 60, 90, 45, 65];
      const near = [55, 80, 45, 95, 60, 70, 50, 85];
      return (
        <>
          <Sky id={id} top="#C9B8F2" bottom="#F3EEFF" />
          <Circle cx={sunX} cy="40" r="18" fill="#FFD9A0" />
          {far.map((height, i) => (
            <Rect key={`f${i}`} x={i * 40} y={160 - height - 20} width={34} height={height + 20} fill="#9B87D9" />
          ))}
          {near.map((height, i) => (
            <Rect key={`n${i}`} x={i * 52 - 10} y={160 - height} width={44} height={height} fill="#5B45B0" />
          ))}
          {near.flatMap((height, i) =>
            [0, 1, 2].map((row) =>
              rand() > 0.45 ? <Rect key={`w${i}-${row}`} x={i * 52 + 4 + (row % 2) * 14} y={160 - height + 10 + row * 16} width={6} height={8} fill="#FFE08A" /> : null,
            ),
          )}
        </>
      );
    }
    case 'road_trip':
      return (
        <>
          <Sky id={id} top="#FFC9A3" bottom="#FFF1E4" />
          <Circle cx="200" cy="74" r="28" fill="#FF8A50" />
          <Path d="M0 112 C70 90 130 104 200 96 C270 88 330 102 400 92 L400 160 L0 160 Z" fill="#F2A65A" />
          <Path d="M0 132 C90 118 150 128 200 122 C260 116 320 130 400 120 L400 160 L0 160 Z" fill="#D9772E" />
          <Path d="M168 160 L232 160 L206 98 L194 98 Z" fill="#5B5B66" />
          <Rect x="198" y="142" width="4" height="12" fill="#FFFFFF" />
          <Rect x="198.5" y="122" width="3" height="9" fill="#FFFFFF" />
          <Rect x="199" y="106" width="2" height="6" fill="#FFFFFF" />
        </>
      );
    case 'camping':
      return (
        <>
          <Sky id={id} top="#A8D5BA" bottom="#EAF6EE" />
          <Circle cx={sunX} cy="40" r="18" fill="#FFE29A" />
          <Path d="M0 116 C80 96 150 110 220 100 C290 90 340 104 400 96 L400 160 L0 160 Z" fill="#7FB38F" />
          {[20, 60, 100, 330, 370].map((x, i) => (
            <Path key={i} d={`M${x} ${150 - (i % 2) * 8} L${x + 16} ${92 - (i % 3) * 6} L${x + 32} ${150 - (i % 2) * 8} Z`} fill="#2E6B3A" />
          ))}
          <Path d="M0 142 C100 132 200 146 300 138 C340 134 370 140 400 136 L400 160 L0 160 Z" fill="#4E8A57" />
          <Path d="M232 142 L266 96 L300 142 Z" fill="#F28C38" />
          <Path d="M266 96 L256 142 L276 142 Z" fill="#B85C1D" />
        </>
      );
    case 'celebration': {
      const colours = ['#FF7AB6', '#F5C451', '#6AA8FF', '#6CCB74', '#B49CFF'];
      return (
        <>
          <Sky id={id} top="#FFB3D1" bottom="#FFF0F6" />
          {Array.from({ length: 34 }, (_, i) => {
            const x = rand() * 400;
            const y = rand() * 160;
            const fill = colours[i % colours.length];
            return i % 2 ? <Circle key={i} cx={x} cy={y} r={3} fill={fill} /> : <Rect key={i} x={x} y={y} width={7} height={4} fill={fill} transform={`rotate(${Math.round(rand() * 90)} ${x} ${y})`} />;
          })}
          {[
            [70, 62, '#FF7AB6'],
            [102, 50, '#F5C451'],
            [320, 58, '#6AA8FF'],
          ].map(([x, y, fill]) => (
            <Path key={String(x)} d={`M${x} ${Number(y) + 18} C${Number(x) - 6} ${Number(y) + 40} ${Number(x) + 6} ${Number(y) + 60} ${x} 160`} stroke="#B0245F" strokeWidth={1.5} fill="none" />
          ))}
          <Circle cx="70" cy="62" r="18" fill="#FF7AB6" />
          <Circle cx="102" cy="50" r="18" fill="#F5C451" />
          <Circle cx="320" cy="58" r="18" fill="#6AA8FF" />
        </>
      );
    }
  }
}

/** An illustrated postcard: sky, sun, hills and water, coloured per trip (or the trip theme's scene). */
export function Postcard({ seed, emoji, theme }: { seed: string; emoji?: string; theme?: TripTheme | null }) {
  const h = hash(seed);
  const c = SCENES[h % SCENES.length];
  const sunX = 70 + (h % 260);
  const id = `sky${h}`;
  if (theme) {
    return (
      <View style={{ position: 'absolute', inset: 0 }} testID={`cover-theme-${theme}`}>
        <Svg width="100%" height="100%" viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice">
          <ThemeScene theme={theme} h={h} />
        </Svg>
        {emoji ? <Text style={{ position: 'absolute', right: 16, bottom: 12, fontSize: 30 }}>{emoji}</Text> : null}
      </View>
    );
  }
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
  theme,
  children,
  style,
}: {
  seed: string;
  path?: string | null;
  height: number;
  /** The trip's theme: its scene replaces the default illustration. */
  theme?: TripTheme | null;
  rounded?: number;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const url = usePhotoUrl(path);
  return (
    <View style={[{ height, borderRadius: rounded, overflow: 'hidden', backgroundColor: t.surfaceAlt }, style]}>
      <Postcard seed={seed} theme={theme} />
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
