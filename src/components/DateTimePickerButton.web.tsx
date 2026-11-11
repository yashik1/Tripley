/**
 * Website: the calendar or clock button opens the browser's own date or time
 * picker (through a hidden <input type="date|time">), so nobody has to type.
 */
import { useRef } from 'react';
import { Pressable, View } from 'react-native';

import { toBrowserValue, type PickerMode } from '@/lib/datetime-input';
import { useTheme } from '@/theme';
import { Icon } from './Icon';

export type PickerButtonProps = {
  mode: PickerMode;
  value: string;
  onPick: (value: string) => void;
  min?: string;
  max?: string;
  label: string;
  testID?: string;
};

export function DateTimePickerButton({ mode, value, onPick, min, max, label, testID }: PickerButtonProps) {
  const t = useTheme();
  const input = useRef<HTMLInputElement | null>(null);

  const open = () => {
    const el = input.current;
    if (!el) return;
    el.value = toBrowserValue(mode, value);
    try {
      el.showPicker();
    } catch {
      // Older browsers: focusing the input shows its own picker or spinner.
      el.focus();
      el.click();
    }
  };

  return (
    <View style={{ position: 'relative', justifyContent: 'center' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={open}
        hitSlop={8}
        testID={testID}
        style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}>
        <Icon name={mode === 'date' ? 'calendar' : 'clock'} size={20} color={t.primary} />
      </Pressable>
      <input
        ref={input}
        type={mode}
        min={min ? toBrowserValue(mode, min) || undefined : undefined}
        max={max ? toBrowserValue(mode, max) || undefined : undefined}
        tabIndex={-1}
        aria-hidden
        data-testid={testID ? `${testID}-input` : undefined}
        onChange={(e) => {
          if (e.currentTarget.value) onPick(e.currentTarget.value);
        }}
        style={{ position: 'absolute', right: 0, bottom: 0, width: 1, height: 1, opacity: 0, border: 0, padding: 0, pointerEvents: 'none' }}
      />
    </View>
  );
}
