import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { RefreshControl, View } from 'react-native';

import { Card, EmptyState, ListRow, Screen } from '@/components/ui';
import { markAllNotificationsRead } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { keys, useNotifications } from '@/lib/queries';
import { openNotification as open } from '@/lib/notification-routes';
import { useTheme } from '@/theme';

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
