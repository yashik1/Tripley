import { useState } from 'react';
import { FlatList, Modal, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radius, space, useTheme } from '@/theme';
import { Field, IconButton, ListRow, Row, Text } from './ui';

export const COUNTRIES: { iso: string; name: string; dial: string }[] = [
  { iso: 'IN', name: 'India', dial: '91' },
  { iso: 'US', name: 'United States', dial: '1' },
  { iso: 'GB', name: 'United Kingdom', dial: '44' },
  { iso: 'CA', name: 'Canada', dial: '1' },
  { iso: 'AU', name: 'Australia', dial: '61' },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971' },
  { iso: 'SG', name: 'Singapore', dial: '65' },
  { iso: 'DE', name: 'Germany', dial: '49' },
  { iso: 'FR', name: 'France', dial: '33' },
  { iso: 'ES', name: 'Spain', dial: '34' },
  { iso: 'IT', name: 'Italy', dial: '39' },
  { iso: 'NL', name: 'Netherlands', dial: '31' },
  { iso: 'IE', name: 'Ireland', dial: '353' },
  { iso: 'PT', name: 'Portugal', dial: '351' },
  { iso: 'CH', name: 'Switzerland', dial: '41' },
  { iso: 'SE', name: 'Sweden', dial: '46' },
  { iso: 'NO', name: 'Norway', dial: '47' },
  { iso: 'DK', name: 'Denmark', dial: '45' },
  { iso: 'PL', name: 'Poland', dial: '48' },
  { iso: 'NZ', name: 'New Zealand', dial: '64' },
  { iso: 'ZA', name: 'South Africa', dial: '27' },
  { iso: 'NG', name: 'Nigeria', dial: '234' },
  { iso: 'KE', name: 'Kenya', dial: '254' },
  { iso: 'BR', name: 'Brazil', dial: '55' },
  { iso: 'MX', name: 'Mexico', dial: '52' },
  { iso: 'JP', name: 'Japan', dial: '81' },
  { iso: 'KR', name: 'South Korea', dial: '82' },
  { iso: 'CN', name: 'China', dial: '86' },
  { iso: 'HK', name: 'Hong Kong', dial: '852' },
  { iso: 'TH', name: 'Thailand', dial: '66' },
  { iso: 'ID', name: 'Indonesia', dial: '62' },
  { iso: 'MY', name: 'Malaysia', dial: '60' },
  { iso: 'PH', name: 'Philippines', dial: '63' },
  { iso: 'VN', name: 'Vietnam', dial: '84' },
  { iso: 'LK', name: 'Sri Lanka', dial: '94' },
  { iso: 'NP', name: 'Nepal', dial: '977' },
  { iso: 'BD', name: 'Bangladesh', dial: '880' },
  { iso: 'PK', name: 'Pakistan', dial: '92' },
  { iso: 'SA', name: 'Saudi Arabia', dial: '966' },
  { iso: 'QA', name: 'Qatar', dial: '974' },
  { iso: 'TR', name: 'Turkey', dial: '90' },
  { iso: 'EG', name: 'Egypt', dial: '20' },
];

export function defaultCountry(): (typeof COUNTRIES)[number] {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const region = locale.split(/[-_]/)[1]?.toUpperCase();
    return COUNTRIES.find((c) => c.iso === region) ?? COUNTRIES[0];
  } catch {
    return COUNTRIES[0];
  }
}

/** Combine a country code and a local number into E.164 ("+919876543210"). */
export function toE164(dial: string, local: string): string | null {
  const raw = local.trim();
  if (raw.startsWith('+')) {
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  const full = `${dial}${digits}`;
  return digits.length >= 6 && full.length <= 15 ? `+${full}` : null;
}

export function PhoneInput({
  label = 'Phone number',
  country,
  onCountry,
  value,
  onChangeText,
  autoFocus,
}: {
  label?: string;
  country: (typeof COUNTRIES)[number];
  onCountry: (c: (typeof COUNTRIES)[number]) => void;
  value: string;
  onChangeText: (v: string) => void;
  autoFocus?: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = COUNTRIES.filter(
    (c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.dial.startsWith(q.replace('+', '')),
  );
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" muted>{label}</Text>
      <Row gap={space.sm}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Country code +${country.dial}`}
          onPress={() => setOpen(true)}
          style={{
            minHeight: 48,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.surface,
            paddingHorizontal: space.md,
            justifyContent: 'center',
          }}>
          <Text style={{ fontWeight: '600' }}>{country.iso} +{country.dial}</Text>
        </Pressable>
        <TextInput
          testID="phone-input"
          value={value}
          onChangeText={onChangeText}
          placeholder="98765 43210"
          placeholderTextColor={t.textFaint}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          autoFocus={autoFocus}
          style={{
            flex: 1,
            minHeight: 48,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.surface,
            color: t.text,
            paddingHorizontal: space.md,
            fontSize: 16,
          }}
        />
      </Row>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          <Row style={{ padding: space.lg, justifyContent: 'space-between' }}>
            <Text variant="heading">Country</Text>
            <IconButton icon="close" label="Close" onPress={() => setOpen(false)} />
          </Row>
          <View style={{ paddingHorizontal: space.lg }}>
            <Field placeholder="Search" value={q} onChangeText={setQ} autoFocus />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.iso}
            contentContainerStyle={{ paddingHorizontal: space.lg }}
            renderItem={({ item }) => (
              <ListRow
                title={item.name}
                right={<Text muted>+{item.dial}</Text>}
                onPress={() => {
                  onCountry(item);
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
