import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COMMON_CURRENCIES, isCurrencyCode } from '@/lib/currency';
import { space, useTheme } from '@/theme';
import { Field, IconButton, ListRow, Row, Text } from './ui';

export function CurrencyPicker({
  label,
  value,
  onChange,
  disabled,
}: {
  label?: string;
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toUpperCase();
    const base = COMMON_CURRENCIES.filter((c) => !s || c.code.includes(s) || c.name.toUpperCase().includes(s));
    if (isCurrencyCode(s) && !base.some((c) => c.code === s)) base.unshift({ code: s, name: 'Other currency' });
    return base;
  }, [q]);
  const name = COMMON_CURRENCIES.find((c) => c.code === value)?.name ?? '';

  return (
    <View style={{ gap: 6 }}>
      {label ? <Text variant="label" muted>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Currency ${value}`}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={{
          minHeight: 48,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: t.surface,
          paddingHorizontal: space.md,
          justifyContent: 'center',
          opacity: disabled ? 0.6 : 1,
        }}>
        <Text>
          <Text style={{ fontWeight: '600' }}>{value}</Text>
          {name ? <Text muted>  {name}</Text> : null}
        </Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          <Row style={{ padding: space.lg, justifyContent: 'space-between' }}>
            <Text variant="heading">Choose currency</Text>
            <IconButton icon="close" label="Close" onPress={() => setOpen(false)} />
          </Row>
          <View style={{ paddingHorizontal: space.lg }}>
            <Field placeholder="Search, or type a code like CHF" value={q} onChangeText={setQ} autoCapitalize="characters" autoFocus />
          </View>
          <FlatList
            data={list}
            keyExtractor={(c) => c.code}
            contentContainerStyle={{ paddingHorizontal: space.lg }}
            renderItem={({ item }) => (
              <ListRow
                title={`${item.code}  ·  ${item.name}`}
                right={item.code === value ? <Text color={t.primary}>✓</Text> : null}
                onPress={() => {
                  onChange(item.code);
                  setOpen(false);
                  setQ('');
                }}
              />
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
