/**
 * Tripley's small UI kit: consistent spacing, type and colors in light and dark mode.
 */
import { Image } from 'expo-image';
import { Children, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colorFor, radius, space, useTheme, type Theme } from '@/theme';
import { Icon, type IconName } from './Icon';

// ------------------------------------------------------------------ layout

export function Screen({
  children,
  scroll = true,
  padded = true,
  edges = ['bottom'],
  footer,
  refreshControl,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: Edge[];
  footer?: ReactNode;
  refreshControl?: React.ComponentProps<typeof ScrollView>['refreshControl'];
}) {
  const t = useTheme();
  const content = (
    <View style={[styles.content, padded && styles.padded]}>{children}</View>
  );
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: t.bg }}>
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={refreshControl}>
          {content}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{content}</View>
      )}
      {footer ? (
        <View style={[styles.footer, { borderTopColor: t.border, backgroundColor: t.surface }]}>{footer}</View>
      ) : null}
    </SafeAreaView>
  );
}

export function Row({
  children,
  gap = space.sm,
  style,
  align = 'center',
}: {
  children: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  align?: ViewStyle['alignItems'];
}) {
  return <View style={[{ flexDirection: 'row', alignItems: align, gap }, style]}>{children}</View>;
}

export function Stack({ children, gap = space.md, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const t = useTheme();
  const base = [styles.card, { backgroundColor: t.surface, borderColor: t.border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />;
}

// ------------------------------------------------------------------ text

type TextVariant = 'title' | 'heading' | 'body' | 'label' | 'caption' | 'money';

export function Text({
  children,
  variant = 'body',
  muted,
  faint,
  color,
  style,
  numberOfLines,
  center,
  testID,
}: {
  children: ReactNode;
  testID?: string;
  variant?: TextVariant;
  muted?: boolean;
  faint?: boolean;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  center?: boolean;
}) {
  const t = useTheme();
  return (
    <RNText
      testID={testID}
      numberOfLines={numberOfLines}
      style={[
        textStyles[variant],
        { color: color ?? (faint ? t.textFaint : muted ? t.textMuted : t.text) },
        center && { textAlign: 'center' },
        style,
      ]}>
      {children}
    </RNText>
  );
}

const textStyles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  heading: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  label: { fontSize: 14, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18 },
  money: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
});

// ------------------------------------------------------------------ controls

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  kind = 'primary',
  icon,
  loading,
  disabled,
  small,
  style,
  testID,
}: {
  title: string;
  onPress?: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  const { bg, fg, border } = buttonColors(t, kind);
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, borderColor: border },
        pressed && !inactive && { opacity: 0.8 },
        inactive && { opacity: 0.5 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Row gap={space.sm} style={{ justifyContent: 'center' }}>
          {icon ? <Icon name={icon} size={small ? 16 : 18} color={fg} /> : null}
          <RNText style={[styles.buttonText, small && { fontSize: 14 }, { color: fg }]}>{title}</RNText>
        </Row>
      )}
    </Pressable>
  );
}

function buttonColors(t: Theme, kind: ButtonKind) {
  switch (kind) {
    case 'primary':
      return { bg: t.primary, fg: t.primaryText, border: t.primary };
    case 'secondary':
      return { bg: t.surface, fg: t.text, border: t.border };
    case 'ghost':
      return { bg: 'transparent', fg: t.primary, border: 'transparent' };
    case 'danger':
      return { bg: t.dangerSoft, fg: t.danger, border: t.dangerSoft };
  }
}

export function IconButton({
  icon,
  onPress,
  label,
  color,
  size = 22,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  color?: string;
  size?: number;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [{ padding: 6, opacity: pressed ? 0.6 : 1 }]}>
      <Icon name={icon} size={size} color={color ?? t.text} />
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  error,
  style,
  ...input
}: TextInputProps & { label?: string; hint?: string; error?: string | null; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text variant="label" muted>{label}</Text> : null}
      <TextInput
        placeholderTextColor={t.textFaint}
        {...input}
        style={[
          styles.input,
          { backgroundColor: t.surface, borderColor: error ? t.danger : t.border, color: t.text },
          input.multiline && { minHeight: 80, textAlignVertical: 'top' },
        ]}
      />
      {error ? (
        <Text variant="caption" color={t.danger}>{error}</Text>
      ) : hint ? (
        <Text variant="caption" faint>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  color,
  testID,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  testID?: string;
}) {
  const t = useTheme();
  const c = color ?? t.primary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? c : t.surface,
          borderColor: selected ? c : t.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      <RNText style={{ color: selected ? '#fff' : t.text, fontSize: 14, fontWeight: '500' }}>{label}</RNText>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: t.surfaceAlt }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && { backgroundColor: t.surface }]}>
            <RNText style={{ color: active ? t.text : t.textMuted, fontWeight: active ? '600' : '500' }}>{o.label}</RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ people

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Avatar({
  id,
  name,
  url,
  size = 36,
  dimmed,
  ring,
}: {
  id: string;
  name: string;
  url?: string | null;
  size?: number;
  dimmed?: boolean;
  ring?: string;
}) {
  const bg = colorFor(id);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: dimmed ? 0.4 : 1,
        borderWidth: ring ? 2 : 0,
        borderColor: ring,
        overflow: 'hidden',
      }}>
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size }} />
      ) : (
        <RNText style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.38 }}>{initials(name)}</RNText>
      )}
    </View>
  );
}

// ------------------------------------------------------------------ feedback

/** True when children are only strings/numbers (which must sit inside <Text> on native). */
function isTextOnly(children: ReactNode): boolean {
  const list = Children.toArray(children);
  return list.length > 0 && list.every((c) => typeof c === 'string' || typeof c === 'number');
}

export function Banner({
  tone = 'info',
  title,
  children,
  action,
  icon,
}: {
  tone?: 'info' | 'warning' | 'success' | 'danger';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
}) {
  const t = useTheme();
  const map = {
    info: [t.primarySoft, t.primary],
    warning: [t.warningSoft, t.warning],
    success: [t.successSoft, t.success],
    danger: [t.dangerSoft, t.danger],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Row align="flex-start" gap={space.sm}>
        {icon ? <Icon name={icon} size={18} color={fg} /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          {title ? <Text variant="label" color={fg}>{title}</Text> : null}
          {isTextOnly(children) ? <Text variant="caption" color={t.text}>{children}</Text> : children}
        </View>
      </Row>
      {action ? <View style={{ marginTop: space.sm }}>{action}</View> : null}
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: t.primarySoft }]}>
        <Icon name={icon} size={28} color={t.primary} />
      </View>
      <Text variant="heading" center>{title}</Text>
      {body ? <Text muted center>{body}</Text> : null}
      {action}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={[styles.empty, { flex: 1, backgroundColor: t.bg }]}>
      <ActivityIndicator color={t.primary} size="large" />
      {label ? <Text muted>{label}</Text> : null}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: space.sm }}>
      <Text variant="label" muted style={{ textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 12 }}>
        {children}
      </Text>
      {action}
    </Row>
  );
}

export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
  chevron,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
}) {
  const t = useTheme();
  const body = (
    <Row gap={space.md} style={{ paddingVertical: space.md }}>
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        {typeof title === 'string' ? <Text variant="body" style={{ fontWeight: '500' }} numberOfLines={1}>{title}</Text> : title}
        {subtitle ? (typeof subtitle === 'string' ? <Text variant="caption" muted numberOfLines={2}>{subtitle}</Text> : subtitle) : null}
      </View>
      {right}
      {chevron ? <Icon name="chevron" size={16} color={t.textFaint} /> : null}
    </Row>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.7 }}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: space.lg, width: '100%', maxWidth: 720, alignSelf: 'center' },
  padded: { padding: space.lg },
  footer: { padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth, gap: space.sm },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.md },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  buttonSmall: { minHeight: 36, paddingHorizontal: space.md },
  buttonText: { fontSize: 16, fontWeight: '600' },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 16,
  },
  chip: { paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1 },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.sm },
  banner: { borderRadius: radius.md, padding: space.md },
  empty: { alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
