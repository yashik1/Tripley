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
      <Tabs.Screen name="feed" options={{ title: 'Feed', tabBarIcon: ({ color }) => <Icon name="feed" color={color as string} size={22} /> }} />
      <Tabs.Screen name="bills" options={{ title: 'Money', tabBarIcon: ({ color }) => <Icon name="wallet" color={color as string} size={22} /> }} />
      {/* Reached from the overview (people) and Money (Bills | Balances), so no tab of their own. */}
      <Tabs.Screen name="ideas" options={{ title: 'Bucket list', tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} />
      <Tabs.Screen name="polls" options={{ title: 'Polls', tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} />
      <Tabs.Screen name="people" options={{ title: 'People', tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} />
      <Tabs.Screen name="balances" options={{ title: 'Balances', tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} />
    </Tabs>
  );
}
