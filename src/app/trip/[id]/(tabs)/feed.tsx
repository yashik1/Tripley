/**
 * The trip's activity feed: everyone's updates, photos, finds and
 * announcements, plus what the group did (joined, pinned, planned). Loads 20
 * at a time, refreshes by pulling down, and updates live.
 */
import { router } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FeedPostCard } from '@/components/FeedPost';
import { Icon, type IconName } from '@/components/Icon';
import { Skeleton } from '@/components/Travel';
import { Avatar, Banner, Card, EmptyState, Row, Text } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { useFeed } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { useAuth } from '@/providers/AuthProvider';
import { radius, space, useTheme } from '@/theme';

export default function FeedTab() {
  const id = useTripId();
  const t = useTheme();
  const { me, isOrganizer, active } = useTripData(id);
  const { profile } = useAuth();
  const feed = useFeed(id);
  const posts = useMemo(() => (feed.data?.pages ?? []).flat(), [feed.data]);
  const compose = (kind: string) => router.push({ pathname: '/trip/[id]/post/new', params: { id, kind } });
  const kinds: { kind: string; label: string; icon: IconName; color: string; soft: string }[] = [
    { kind: 'photos', label: 'Photos', icon: 'photo', color: t.coralText, soft: t.coralSoft },
    { kind: 'place', label: 'A find', icon: 'pin', color: t.yellowText, soft: t.yellowSoft },
    ...(isOrganizer ? [{ kind: 'announcement', label: 'Announce', icon: 'megaphone' as IconName, color: t.sky, soft: t.skySoft }] : []),
  ];

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.sm }}>
      {active ? (
        <Card>
          <Pressable onPress={() => compose('update')} accessibilityRole="button" testID="compose-update" style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Avatar id={me || 'me'} name={profile?.display_name || '?'} url={profile?.avatar_url} size={40} />
            <View style={{ flex: 1, backgroundColor: t.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 10 }}>
              <Text muted>Share an update with the group…</Text>
            </View>
          </Pressable>
          <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
            {kinds.map((k) => (
              <Pressable
                key={k.kind}
                onPress={() => compose(k.kind)}
                accessibilityRole="button"
                testID={`compose-${k.kind}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: k.soft }}>
                <Icon name={k.icon} size={16} color={k.color} />
                <Text variant="caption" color={k.color} style={{ fontWeight: '700' }}>{k.label}</Text>
              </Pressable>
            ))}
          </Row>
        </Card>
      ) : (
        <Banner tone="info" icon="feed">This trip has ended. The feed is here to look back on.</Banner>
      )}
      {feed.error ? <Banner tone="danger" title="Couldn't load the feed">{errorMessage(feed.error)}</Banner> : null}
    </View>
  );

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        testID="feed-list"
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm, width: '100%', maxWidth: 720, alignSelf: 'center' }}
        ListHeaderComponent={header}
        renderItem={({ item }) => <FeedPostCard post={item} me={me} canModerate={isOrganizer} />}
        ListEmptyComponent={
          feed.isLoading ? (
            <View style={{ gap: space.sm }}>
              <Skeleton height={120} />
              <Skeleton height={60} />
            </View>
          ) : (
            <EmptyState icon="feed" title="Nothing here yet" body="Post the first update, share a photo, or tell everyone about a place you found." />
          )
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? (
            <ActivityIndicator color={t.primary} style={{ marginVertical: space.lg }} />
          ) : posts.length > 0 && !feed.hasNextPage ? (
            <Text variant="caption" faint center style={{ marginVertical: space.lg }}>You’re all caught up</Text>
          ) : undefined
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage();
        }}
        refreshControl={<RefreshControl refreshing={feed.isRefetching && !feed.isFetchingNextPage} onRefresh={() => { feed.refetch(); }} />}
        initialNumToRender={8}
        windowSize={7}
        removeClippedSubviews
      />
    </SafeAreaView>
  );
}
