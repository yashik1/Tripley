/** Pick a trip theme (or none): chips with each theme's emoji and name. */
import { View } from 'react-native';

import { TRIP_THEMES } from '@/lib/trip-themes';
import type { TripTheme } from '@/lib/types';
import { space } from '@/theme';
import { Chip } from './ui';

export function TripThemePicker({ value, onChange, disabled }: { value: TripTheme | null; onChange: (theme: TripTheme | null) => void; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup">
      <Chip label="No theme" selected={!value} onPress={disabled ? undefined : () => onChange(null)} testID="theme-none" />
      {TRIP_THEMES.map((t) => (
        <Chip key={t.key} label={`${t.emoji} ${t.label}`} selected={value === t.key} onPress={disabled ? undefined : () => onChange(t.key)} testID={`theme-${t.key}`} />
      ))}
    </View>
  );
}
