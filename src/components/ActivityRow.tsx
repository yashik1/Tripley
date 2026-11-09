/** One line of recent activity (a post or something the group did), for lists outside the feed. */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { eventEmoji, eventText } from '@/lib/feed';
import { timeAgo } from '@/lib/format';
import { usePhotoUrl } from '@/lib/queries';
import type { FeedPost } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';
import { postActor } from './FeedPost';
import { Avatar, Text } from './ui';

export function postSummary(p: FeedPost, me: string): string {
  const who = postActor(p, me);
  switch (p.kind) {
    case 'event':
      return eventText(p.event, who);
    case 'photos':
      return `${who} shared ${p.post_photos.length} ${p.post_photos.length === 1 ? 'photo' : 'photos'}${p.body ? `: ${p.body}` : ''}`;
    case 'place':
      return `${who} found a place: ${p.place_name}`;
    case 'announcement':
      return `📣 ${who}: ${p.body}`;
    default:
      return `${who}: ${p.body}`;
  }
}

function Thumb({ path }: { path: string }) {
  const t = useTheme();
  const url = usePhotoUrl(path);
  return (
    <View style={{ width: 44, height: 44, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: t.surfaceAlt }}>
      {url.data ? <Image source={{ uri: url.data }} style={{ width: 44, height: 44 }} contentFit="cover" /> : null}
    </View>
  );
}

export function ActivityRow({ post, me, showTrip, first }: { post: FeedPost; me: string; showTrip?: boolean; first?: boolean }) {
  const t = useTheme();
  const photo = [...post.post_photos].sort((a, b) => a.position - b.position)[0];
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/trip/[id]/post/[postId]', params: { id: post.trip_id, postId: post.id } })}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: space.sm,
        borderTopWidth: first ? 0 : 1, borderTopColor: t.border, opacity: pressed ? 0.7 : 1,
      })}>
      {post.kind === 'event' ? (
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16 }}>{eventEmoji(post.event)}</Text>
        </View>
      ) : (
        <Avatar id={post.author_id ?? post.id} name={post.author?.display_name || '?'} url={post.author?.avatar_url} size={36} />
      )}
      <View style={{ flex: 1 }}>
        <Text variant="caption" numberOfLines={2}>{postSummary(post, me)}</Text>
        <Text variant="caption" faint>{[showTrip ? post.trip?.name : null, timeAgo(post.created_at)].filter(Boolean).join(' · ')}</Text>
      </View>
      {photo ? <Thumb path={photo.path} /> : null}
    </Pressable>
  );
}
