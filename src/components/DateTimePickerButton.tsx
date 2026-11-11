/**
 * Phones: the calendar or clock button opens the system picker. Android shows
 * its own dialog; iOS shows the picker in a sheet with Done.
 */
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useState } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';

import { fromPickerDate, toPickerDate, type PickerMode } from '@/lib/datetime-input';
import { space, useTheme } from '@/theme';
import { Icon } from './Icon';
import { Button, Row } from './ui';

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
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => toPickerDate(mode, value));
  const bounds = {
    minimumDate: mode === 'date' && min ? toPickerDate('date', min) : undefined,
    maximumDate: mode === 'date' && max ? toPickerDate('date', max) : undefined,
  };

  const show = () => {
    setDraft(toPickerDate(mode, value));
    setOpen(true);
  };

  return (
    <View style={{ justifyContent: 'center' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={show}
        hitSlop={8}
        testID={testID}
        style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}>
        <Icon name={mode === 'date' ? 'calendar' : 'clock'} size={20} color={t.primary} />
      </Pressable>

      {open && Platform.OS === 'android' ? (
        <DateTimePicker
          value={draft}
          mode={mode}
          presentation="dialog"
          is24Hour
          accentColor={t.primary}
          {...bounds}
          onValueChange={(_e, date) => {
            setOpen(false);
            onPick(fromPickerDate(mode, date));
          }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' }} onPress={() => setOpen(false)} accessibilityLabel="Close" />
          <View style={{ backgroundColor: t.surface, padding: space.lg, paddingBottom: space.xl, gap: space.md }}>
            <DateTimePicker
              value={draft}
              mode={mode}
              display={mode === 'date' ? 'inline' : 'spinner'}
              accentColor={t.primary}
              themeVariant={t.scheme === 'dark' ? 'dark' : 'light'}
              {...bounds}
              onValueChange={(_e, date) => setDraft(date)}
            />
            <Row gap={space.sm} style={{ justifyContent: 'flex-end' }}>
              <Button title="Cancel" kind="ghost" small onPress={() => setOpen(false)} />
              <Button
                title="Done"
                small
                onPress={() => {
                  setOpen(false);
                  onPick(fromPickerDate(mode, draft));
                }}
              />
            </Row>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
