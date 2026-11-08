import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { RefreshControl } from 'react-native';

import { Avatar, Banner, Button, Card, IconButton, ListRow, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { cancelInvitation, removeMember } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { errorMessage } from '@/lib/errors';
import { timeAgo } from '@/lib/format';
import { keys, useSentInvitations } from '@/lib/queries';
import { useTripData } from '@/lib/trip-hooks';
import { space, useTheme } from '@/theme';

export default function PeopleTab() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const qc = useQueryClient();
  const { members, me, isOrganizer, refetch, loading } = useTripData(id);
  const invites = useSentInvitations(id);
  const [error, setError] = useState<string | null>(null);

  const remove = async (userId: string, name: string) => {
    if (!(await confirm(`Remove ${name}?`, 'They will lose access to this trip. Their bills stay in the history.', 'Remove', true))) return;
    try {
      await removeMember(id, userId);
      await qc.invalidateQueries({ queryKey: keys.members(id) });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const cancel = async (invitationId: string) => {
    try {
      await cancelInvitation(invitationId);
      await qc.invalidateQueries({ queryKey: keys.sentInvites(id) });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => { refetch(); invites.refetch(); }} />}
      footer={<Button title="Invite friends" icon="personAdd" onPress={() => router.push(`/trip/${id}/invite`)} />}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Stack gap={space.sm}>
        <SectionTitle>{loading ? 'People' : `${members.length} ${members.length === 1 ? 'person' : 'people'}`}</SectionTitle>
        <Card>
          {members.map((m) => {
            const name = m.profile.display_name || 'Friend';
            return (
              <ListRow
                key={m.user_id}
                left={<Avatar id={m.user_id} name={name} url={m.profile.avatar_url} size={40} />}
                title={m.user_id === me ? `${name} (you)` : name}
                subtitle={[
                  m.role === 'organizer' ? 'Organizer' : null,
                  m.location_sharing ? (m.sharing_mode === 'saver' ? 'Sharing · battery saver' : 'Sharing location') : 'Paused sharing',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  isOrganizer && m.user_id !== me ? (
                    <IconButton icon="close" label={`Remove ${name}`} color={t.textFaint} onPress={() => remove(m.user_id, name)} />
                  ) : null
                }
              />
            );
          })}
        </Card>
      </Stack>

      {(invites.data ?? []).length > 0 ? (
        <Stack gap={space.sm}>
          <SectionTitle>Invited</SectionTitle>
          <Card>
            {invites.data!.map((inv) => (
              <ListRow
                key={inv.id}
                title={inv.invitee?.display_name || 'Invited friend'}
                subtitle={`Waiting · sent ${timeAgo(inv.created_at)}`}
                right={<Button title="Cancel" kind="ghost" small onPress={() => cancel(inv.id)} />}
              />
            ))}
          </Card>
        </Stack>
      ) : null}
      <Text variant="caption" faint>
        Everyone on the trip can see each other&apos;s location while sharing is on, and all the bills.
      </Text>
    </Screen>
  );
}
