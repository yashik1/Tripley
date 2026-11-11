/**
 * A date or time field you can type into, with a calendar or clock button
 * that opens a picker for people who'd rather not type.
 *   date: "2026-12-03"   time: "14:30"
 */
import { TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import type { PickerMode } from '@/lib/datetime-input';
import { radius, space, useTheme } from '@/theme';
import { DateTimePickerButton } from './DateTimePickerButton';
import { Text } from './ui';

export function DateTimeField({
  mode,
  label,
  value,
  onChangeText,
  placeholder,
  min,
  max,
  hint,
  error,
  testID,
  style,
}: {
  mode: PickerMode;
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  /** Earliest day (YYYY-MM-DD) the calendar offers. */
  min?: string;
  /** Latest day (YYYY-MM-DD) the calendar offers. */
  max?: string;
  hint?: string;
  error?: string | null;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const what = label?.replace(/\s*\(optional\)\s*/i, '') ?? (mode === 'date' ? 'date' : 'time');
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text variant="label" muted>{label}</Text> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 48,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: error ? t.danger : t.border,
          backgroundColor: t.surface,
          paddingLeft: space.md,
          paddingRight: space.xs,
        }}>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? (mode === 'date' ? 'YYYY-MM-DD' : 'HH:MM')}
          placeholderTextColor={t.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          maxLength={mode === 'date' ? 10 : 8}
          accessibilityLabel={label}
          style={{ flex: 1, minWidth: 0, fontSize: 16, color: t.text, paddingVertical: space.sm }}
        />
        <DateTimePickerButton
          mode={mode}
          value={value}
          onPick={onChangeText}
          min={min}
          max={max}
          label={mode === 'date' ? `Pick ${what.toLowerCase()} from a calendar` : `Pick ${what.toLowerCase()} from a clock`}
          testID={testID ? `${testID}-pick` : undefined}
        />
      </View>
      {error ? (
        <Text variant="caption" color={t.danger}>{error}</Text>
      ) : hint ? (
        <Text variant="caption" faint>{hint}</Text>
      ) : null}
    </View>
  );
}
