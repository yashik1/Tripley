/**
 * "Location stops when Tripley is closed?": what to change on this phone so
 * sharing keeps working in the background (steps for the phone's maker on
 * Android; iPhone settings on iOS).
 */
import { Stack as RouterStack } from 'expo-router';
import { Linking, Platform } from 'react-native';

import { Button, Card, Screen, Stack, Text } from '@/components/ui';
import { batteryHelpFor, IOS_HELP } from '@/lib/battery-help';
import { space } from '@/theme';

function androidInfo(): { manufacturer: string | null; brand: string | null } {
  const c = Platform.constants as unknown as { Manufacturer?: string; Brand?: string };
  return { manufacturer: c?.Manufacturer ?? null, brand: c?.Brand ?? null };
}

export default function BatteryHelpScreen() {
  const ios = Platform.OS === 'ios';
  const info = Platform.OS === 'android' ? androidInfo() : { manufacturer: null, brand: null };
  const help = batteryHelpFor(info.manufacturer, info.brand);
  const steps = ios ? IOS_HELP : help.steps;
  return (
    <Screen>
      <RouterStack.Screen options={{ title: 'Keep sharing on' }} />
      <Stack gap={space.xs}>
        <Text variant="title">Keep location sharing on</Text>
        <Text muted>
          {ios
            ? 'iPhones keep sharing in the background when these are set.'
            : `Some phones stop apps in the background to save battery. On ${help.name} phones, change these so your friends keep seeing you.`}
        </Text>
      </Stack>
      <Card testID="battery-steps">
        {steps.map((s, i) => (
          <Text key={i}>{`${i + 1}. ${s}`}</Text>
        ))}
      </Card>
      <Button title="Open Tripley’s settings" icon="settings" onPress={() => Linking.openSettings()} testID="battery-open-settings" />
      {!ios ? (
        <Button title="More help for this phone" kind="ghost" icon="link" onPress={() => Linking.openURL(help.more)} testID="battery-more" />
      ) : null}
      <Text variant="caption" faint>Sharing still stops by itself when the trip ends, and you can pause it any time from the map.</Text>
    </Screen>
  );
}
