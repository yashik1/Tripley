import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { RefreshControl, View } from 'react-native';

import { Button, Card, EmptyState, ListRow, Screen } from '@/components/ui';
import { markAllNotificationsRead } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { keys, useNotifications } from '@/lib/queries';
import { openNotification as open } from '@/lib/notification-routes';
import { useTheme } from '@/theme';

export default function Notifications() {
  // Up to 100 are loaded; show 30 at first so the list opens fast on slower phones.
  const [shown, setShown] = useState(30);
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
          {items.slice(0, shown).map((n) => (
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
      {items.length > shown ? (
        <Button title="Show older" kind="secondary" small onPress={() => setShown((n) => n + 30)} testID="notifications-more" style={{ alignSelf: 'flex-start' }} />
      ) : null}
    </Screen>
  );
}
