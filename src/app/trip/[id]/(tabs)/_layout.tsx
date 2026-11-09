import { Tabs } from 'expo-router/tabs';

import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';

export default function TripTabs() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textMuted,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border },
        sceneStyle: { backgroundColor: t.bg },
      }}>
      <Tabs.Screen name="map" options={{ title: 'Map', tabBarIcon: ({ color }) => <Icon name="map" color={color as string} size={22} /> }} />
      <Tabs.Screen name="plan" options={{ title: 'Plan', tabBarIcon: ({ color }) => <Icon name="calendar" color={color as string} size={22} /> }} />
      <Tabs.Screen name="bills" options={{ title: 'Bills', tabBarIcon: ({ color }) => <Icon name="bills" color={color as string} size={22} /> }} />
      <Tabs.Screen
        name="balances"
        options={{ title: 'Balances', tabBarIcon: ({ color }) => <Icon name="balances" color={color as string} size={22} /> }}
      />
      <Tabs.Screen name="people" options={{ title: 'People', tabBarIcon: ({ color }) => <Icon name="people" color={color as string} size={22} /> }} />
    </Tabs>
  );
}
