/**
 * A post in the trip's activity feed: who, when, what (text, photos, a place,
 * an announcement), emoji reactions and comments. Automatic posts ("Ana
 * pinned the hotel") are shown as compact rows you can still react to.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { deletePost, toggleReaction } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { errorMessage } from '@/lib/errors';
import { eventEmoji, eventText, reactionCounts } from '@/lib/feed';
import { firstName, timeAgo } from '@/lib/format';
import { directionsUrl } from '@/lib/map-links';
import { keys, usePhotoUrl } from '@/lib/queries';
import { REACTIONS, type FeedPost } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';
import { Icon } from './Icon';
import { Avatar, Card, Row, Text } from './ui';

function authorName(post: FeedPost, me: string): string {
  if (post.author_id === me) return 'You';
  return post.author?.display_name || 'Someone';
}

function Photo({ path, height, onPress }: { path: string; height: number; onPress?: () => void }) {
  const t = useTheme();
  const url = usePhotoUrl(path);
  return (
    <Pressable onPress={onPress} accessibilityRole="imagebutton" accessibilityLabel="Photo" style={{ flexBasis: '48%', flexGrow: 1 }}>
      <View style={{ height, borderRadius: radius.md, overflow: 'hidden', backgroundColor: t.surfaceAlt }}>
        {url.data ? <Image source={{ uri: url.data }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={150} /> : null}
      </View>
    </Pressable>
  );
}

export function PhotoGrid({ paths, onPress }: { paths: string[]; onPress?: () => void }) {
  if (paths.length === 0) return null;
  const height = paths.length === 1 ? 220 : 140;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
      {paths.map((p) => (
        <Photo key={p} path={p} height={height} onPress={onPress} />
      ))}
    </View>
  );
}

function ReactionPill({ emoji, count, mine, onPress }: { emoji: string; count: number; mine: boolean; onPress: () => void }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={() => {
        if (!reduced) scale.set(withSequence(withTiming(1.25, { duration: 90 }), withSpring(1)));
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: mine }}
      accessibilityLabel={`${emoji} ${count}${mine ? ', you reacted' : ''}`}
      testID={`reaction-${emoji}`}>
      <Animated.View
        style={[
          {
            flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill,
            borderWidth: 1, borderColor: mine ? t.primary : t.border, backgroundColor: mine ? t.primarySoft : t.surface,
          },
          style,
        ]}>
        <Text style={{ fontSize: 15 }}>{emoji}</Text>
        {count > 0 ? <Text variant="caption" color={mine ? t.primary : t.textMuted} style={{ fontWeight: '700' }}>{count}</Text> : null}
      </Animated.View>
    </Pressable>
  );
}

export function Reactions({ post, me, onComment }: { post: FeedPost; me: string; onComment?: () => void }) {
  const t = useTheme();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counts = reactionCounts(post.post_reactions, me, REACTIONS);
  const comments = post.post_comments?.[0]?.count ?? 0;
  const react = async (emoji: string) => {
    setPicking(false);
    setError(null);
    try {
      await toggleReaction(post.id, emoji);
      await Promise.all([qc.invalidateQueries({ queryKey: keys.feed(post.trip_id) }), qc.invalidateQueries({ queryKey: keys.post(post.id) })]);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <View style={{ gap: space.xs }}>
      <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
        {counts.map((c) => (
          <ReactionPill key={c.emoji} emoji={c.emoji} count={c.count} mine={c.mine} onPress={() => react(c.emoji)} />
        ))}
        <Pressable
          onPress={() => setPicking((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Add a reaction"
          testID="react-open"
          style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: t.border, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          <Icon name="heart" size={14} color={t.textMuted} />
          <Text variant="caption" muted>React</Text>
        </Pressable>
        {onComment ? (
          <Pressable
            onPress={onComment}
            accessibilityRole="button"
            accessibilityLabel={comments ? `${comments} comments` : 'Comment'}
            style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: t.border, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
            <Icon name="comment" size={14} color={t.textMuted} />
            <Text variant="caption" muted>{comments ? `${comments}` : 'Comment'}</Text>
          </Pressable>
        ) : null}
      </Row>
      {picking ? (
        <Row gap={space.xs} style={{ backgroundColor: t.surfaceAlt, borderRadius: radius.pill, padding: 4, alignSelf: 'flex-start' }}>
          {REACTIONS.map((e) => (
            <Pressable key={e} onPress={() => react(e)} accessibilityRole="button" accessibilityLabel={`React ${e}`} testID={`react-${e}`} style={{ padding: 6 }}>
              <Text style={{ fontSize: 22 }}>{e}</Text>
            </Pressable>
          ))}
        </Row>
      ) : null}
      {error ? <Text variant="caption" color={t.danger}>{error}</Text> : null}
    </View>
  );
}

export function FeedPostCard({
  post,
  me,
  canModerate,
  detailed,
  onDeleted,
}: {
  post: FeedPost;
  me: string;
  /** Organizer: can remove anyone's post. */
  canModerate?: boolean;
  /** On the post's own page (no "open" link, full text). */
  detailed?: boolean;
  onDeleted?: () => void;
}) {
  const t = useTheme();
  const qc = useQueryClient();
  const who = authorName(post, me);
  const open = detailed ? undefined : () => router.push({ pathname: '/trip/[id]/post/[postId]', params: { id: post.trip_id, postId: post.id } });

  if (post.kind === 'event') {
    const target = eventTarget(post);
    return (
      <View testID={`feed-event-${post.event?.type}`} style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.xs }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 17 }}>{eventEmoji(post.event)}</Text>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Pressable onPress={target ?? undefined} disabled={!target} accessibilityRole={target ? 'link' : undefined}>
            <Text variant="caption">
              <Text variant="caption" style={{ fontWeight: '700' }}>{eventText(post.event, who)}</Text>
            </Text>
            <Text variant="caption" faint>{timeAgo(post.created_at)}</Text>
          </Pressable>
          {post.post_reactions.length > 0 || detailed ? <Reactions post={post} me={me} /> : null}
        </View>
      </View>
    );
  }

  const canDelete = post.author_id === me || canModerate;
  const announcement = post.kind === 'announcement';
  return (
    <Card style={announcement ? { borderColor: t.yellow, borderWidth: 1.5 } : undefined} testID={`post-${post.kind}`}>
      <Row gap={space.md}>
        <Avatar id={post.author_id ?? post.id} name={post.author?.display_name || '?'} url={post.author?.avatar_url} size={40} />
        <View style={{ flex: 1 }}>
          <Text variant="label">{who}</Text>
          <Text variant="caption" faint>
            {timeAgo(post.created_at)}
            {post.kind === 'photos' ? ` · ${post.post_photos.length} ${post.post_photos.length === 1 ? 'photo' : 'photos'}` : ''}
            {post.kind === 'place' ? ' · found a place' : ''}
          </Text>
        </View>
        {announcement ? (
          <View style={{ backgroundColor: t.yellowSoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
            <Text variant="caption" color={t.yellowText} style={{ fontWeight: '700' }}>📣 Announcement</Text>
          </View>
        ) : null}
        {canDelete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove post"
            hitSlop={8}
            onPress={async () => {
              if (!(await confirm('Remove this post?', 'It disappears for everyone, with its comments.', 'Remove', true))) return;
              await deletePost(post.id).catch(() => undefined);
              await qc.invalidateQueries({ queryKey: keys.feed(post.trip_id) });
              qc.invalidateQueries({ queryKey: keys.recentPosts });
              onDeleted?.();
            }}>
            <Icon name="trash" size={18} color={t.textFaint} />
          </Pressable>
        ) : null}
      </Row>
      {post.body ? (
        <Pressable onPress={open} disabled={!open}>
          <Text numberOfLines={detailed ? undefined : 8}>{post.body}</Text>
        </Pressable>
      ) : null}
      {post.place_name ? (
        <Pressable
          onPress={post.lat != null && post.lng != null ? () => Linking.openURL(directionsUrl(post.lat!, post.lng!)) : undefined}
          disabled={post.lat == null}
          accessibilityRole={post.lat != null ? 'link' : undefined}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: t.coralSoft, borderRadius: radius.md, padding: space.sm }}>
          <Text style={{ fontSize: 18 }}>📍</Text>
          <View style={{ flex: 1 }}>
            <Text variant="label" color={t.coralText}>{post.place_name}</Text>
            {post.lat != null ? <Text variant="caption" muted>Tap for directions</Text> : null}
          </View>
        </Pressable>
      ) : null}
      <PhotoGrid paths={[...post.post_photos].sort((a, b) => a.position - b.position).map((p) => p.path)} onPress={open} />
      <Reactions post={post} me={me} onComment={open} />
    </Card>
  );
}

function eventTarget(post: FeedPost): (() => void) | null {
  const e = post.event;
  if (!e) return null;
  const id = post.trip_id;
  if (e.type === 'place_pinned' && typeof e.place_id === 'string') return () => router.push(`/trip/${id}/place/${e.place_id}`);
  if (e.type === 'stop_added' && typeof e.item_id === 'string') return () => router.push(`/trip/${id}/plan/${e.item_id}`);
  if (e.type === 'bill_added' && typeof e.bill_id === 'string') return () => router.push(`/trip/${id}/bill/${e.bill_id}`);
  if (e.type === 'member_joined') return () => router.push(`/trip/${id}/people`);
  return null;
}

/** First name of whoever did it, for compact lists. */
export function postActor(post: FeedPost, me: string): string {
  return post.author_id === me ? 'You' : firstName(post.author?.display_name || 'Someone');
}
