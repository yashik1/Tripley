/** One post with all its comments. */
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { FeedPostCard } from '@/components/FeedPost';
import { Avatar, Banner, Button, Field, IconButton, Loading, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { addPostComment, deletePostComment } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { firstName, timeAgo } from '@/lib/format';
import { keys, usePost, usePostComments } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import { space } from '@/theme';

export default function PostPage() {
  const id = useTripId();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const qc = useQueryClient();
  const { me, nameOf, byId, isOrganizer, active } = useTripData(id);
  const post = usePost(postId);
  const comments = usePostComments(postId);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (post.isLoading) return <Loading />;
  if (!post.data) {
    return (
      <Screen>
        <Banner tone="info" title="This post isn’t here any more">It may have been removed.</Banner>
        <Button title="Back to the feed" kind="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addPostComment(id, postId, text.trim());
      setText('');
      await Promise.all([qc.invalidateQueries({ queryKey: keys.postComments(postId) }), qc.invalidateQueries({ queryKey: keys.feed(id) })]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <FeedPostCard post={post.data} me={me} canModerate={isOrganizer} detailed onDeleted={() => router.back()} />
      <Stack gap={space.sm}>
        <SectionTitle>Comments</SectionTitle>
        {(comments.data ?? []).length === 0 ? <Text variant="caption" faint>No comments yet. Say something nice!</Text> : null}
        {(comments.data ?? []).map((c) => (
          <Row key={c.id} gap={space.sm} align="flex-start">
            <Avatar id={c.user_id} name={byId.get(c.user_id)?.profile.display_name || nameOf(c.user_id)} url={byId.get(c.user_id)?.profile.avatar_url} size={32} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="caption" muted>{c.user_id === me ? 'You' : firstName(nameOf(c.user_id))} · {timeAgo(c.created_at)}</Text>
              <Text>{c.body}</Text>
            </View>
            {c.user_id === me || isOrganizer ? (
              <IconButton
                icon="trash"
                label="Delete comment"
                size={18}
                onPress={async () => {
                  await deletePostComment(c.id).catch(() => undefined);
                  qc.invalidateQueries({ queryKey: keys.postComments(postId) });
                }}
              />
            ) : null}
          </Row>
        ))}
        {active ? (
          <Row gap={space.sm} align="flex-end">
            <Field value={text} onChangeText={setText} placeholder="Add a comment" maxLength={1000} style={{ flex: 1 }} testID="post-comment" onSubmitEditing={send} />
            <Button title="Send" small onPress={send} loading={busy} disabled={!text.trim()} testID="post-comment-send" />
          </Row>
        ) : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </Stack>
    </Screen>
  );
}
