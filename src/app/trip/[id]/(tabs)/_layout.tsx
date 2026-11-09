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
        tabBarLabelStyle: { fontWeight: '600' },
        sceneStyle: { backgroundColor: t.bg },
      }}>
      <Tabs.Screen name="overview" options={{ title: 'Overview', tabBarIcon: ({ color }) => <Icon name="home" color={color as string} size={22} /> }} />
      <Tabs.Screen name="plan" options={{ title: 'Plan', tabBarIcon: ({ color }) => <Icon name="calendar" color={color as string} size={22} /> }} />
      <Tabs.Screen name="map" options={{ title: 'Map', tabBarIcon: ({ color }) => <Icon name="map" color={color as string} size={22} /> }} />
      <Tabs.Screen name="bills" options={{ title: 'Money', tabBarIcon: ({ color }) => <Icon name="wallet" color={color as string} size={22} /> }} />
      <Tabs.Screen name="people" options={{ title: 'People', tabBarIcon: ({ color }) => <Icon name="people" color={color as string} size={22} /> }} />
      {/* Reached from Money (Bills | Balances), so not its own tab. */}
      <Tabs.Screen name="balances" options={{ title: 'Balances', tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} />
    </Tabs>
  );
}
