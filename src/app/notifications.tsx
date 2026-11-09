import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { RefreshControl, View } from 'react-native';

import { Card, EmptyState, ListRow, Screen } from '@/components/ui';
import { markAllNotificationsRead } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { keys, useNotifications } from '@/lib/queries';
import type { AppNotification } from '@/lib/types';
import { useTheme } from '@/theme';

function open(n: AppNotification) {
  const tripId = typeof n.data.trip_id === 'string' ? n.data.trip_id : n.trip_id;
  if (n.kind === 'invitation') return router.dismissTo('/');
  if (!tripId) return;
  if (n.kind === 'kitty_holder' || typeof n.data.kitty_id === 'string') router.push(`/trip/${tripId}/kitty`);
  else if (n.kind === 'arrival' && typeof n.data.place_id === 'string') router.push(`/trip/${tripId}/place/${n.data.place_id}`);
  else if (n.kind.startsWith('settlement')) router.push(`/trip/${tripId}/balances`);
  else if (n.kind.startsWith('bill') && typeof n.data.bill_id === 'string') router.push(`/trip/${tripId}/bill/${n.data.bill_id}`);
  else if (n.kind === 'member_joined') router.push(`/trip/${tripId}/people`);
  else router.push(`/trip/${tripId}/map`);
}

export default function Notifications() {
  const t = useTheme();
  const qc = useQueryClient();
  const list = useNotifications();

  useEffect(() => {
    const hasUnread = (list.data ?? []).some((n) => !n.read_at);
    if (!hasUnread) return;
    const timer = setTimeout(() => {
      markAllNotificationsRead().then(() => qc.invalidateQueries({ queryKey: keys.notifications }));
    }, 1500);
    return () => clearTimeout(timer);
  }, [list.data, qc]);

  const items = list.data ?? [];
  return (
    <Screen refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => { list.refetch(); }} />}>
      {items.length === 0 && !list.isLoading ? (
        <EmptyState icon="bell" title="No notifications" body="Invites, new bills and payments show up here." />
      ) : (
        <Card>
          {items.map((n) => (
            <ListRow
              key={n.id}
              left={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: n.read_at ? 'transparent' : t.primary }} />}
              title={n.title}
              subtitle={`${n.body} · ${timeAgo(n.created_at)}`}
              onPress={() => open(n)}
              chevron
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}
