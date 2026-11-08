import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { space, useTheme } from '@/theme';
import { Icon } from './Icon';
import { Field, Row, Screen, Stack, Text } from './ui';

/** The Tripley name with its pin, linking home. */
export function Brand({ size = 20 }: { size?: number }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel="Tripley home" onPress={() => router.replace('/')} hitSlop={8}>
      <Row gap={6}>
        <View
          style={{
            width: size + 10,
            height: size + 10,
            borderRadius: (size + 10) / 2,
            backgroundColor: t.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Icon name="location" size={size - 4} color={t.primaryText} />
        </View>
        <Text style={{ fontSize: size, fontWeight: '800', letterSpacing: -0.5 }}>Tripley</Text>
      </Row>
    </Pressable>
  );
}

/** Shared frame for sign up, log in and password pages. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flex: 1, width: '100%', maxWidth: 440, alignSelf: 'center', gap: space.xl, paddingVertical: space.lg }}>
        <Brand />
        <View
          style={{
            backgroundColor: t.surface,
            borderColor: t.border,
            borderWidth: 1,
            borderRadius: 20,
            padding: space.xl,
            gap: space.lg,
          }}>
          <Stack gap={space.xs}>
            <Text variant="title">{title}</Text>
            {subtitle ? <Text muted>{subtitle}</Text> : null}
          </Stack>
          {children}
        </View>
      </View>
    </Screen>
  );
}

/** A password input with a Show / Hide toggle. */
export function PasswordField({
  label = 'Password',
  value,
  onChangeText,
  onSubmitEditing,
  newPassword,
  hint,
  testID,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  onSubmitEditing?: () => void;
  /** A new password (sign up, reset) rather than an existing one. */
  newPassword?: boolean;
  hint?: string;
  testID?: string;
}) {
  const t = useTheme();
  const [shown, setShown] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="label" muted>{label}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shown ? 'Hide password' : 'Show password'}
          onPress={() => setShown((s) => !s)}
          hitSlop={8}>
          <Text variant="caption" color={t.primary} style={{ fontWeight: '600' }}>
            {shown ? 'Hide' : 'Show'}
          </Text>
        </Pressable>
      </Row>
      <Field
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        secureTextEntry={!shown}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={newPassword ? 'new-password' : 'current-password'}
        textContentType={newPassword ? 'newPassword' : 'password'}
        placeholder={newPassword ? 'At least 8 characters' : 'Your password'}
        hint={hint}
      />
    </View>
  );
}

/** "Text  Link" line under a form, e.g. "New here?  Create an account". */
export function AuthSwitch({ prompt, action, onPress, testID }: { prompt: string; action: string; onPress: () => void; testID?: string }) {
  const t = useTheme();
  return (
    <Row gap={6} style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
      <Text muted>{prompt}</Text>
      <Pressable accessibilityRole="link" onPress={onPress} hitSlop={8} testID={testID}>
        <Text color={t.primary} style={{ fontWeight: '600' }}>{action}</Text>
      </Pressable>
    </Row>
  );
}
