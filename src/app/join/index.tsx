/** Join a trip by pasting the invite link (or typing the code) a friend sent. */
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Postcard } from '@/components/Travel';
import { Button, Field, Screen, Stack, Text } from '@/components/ui';
import { parseInviteCode } from '@/lib/trip-status';
import { radius, space } from '@/theme';

export default function JoinWithCode() {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    const code = parseInviteCode(input);
    if (!code) return setError('That doesn’t look like a Tripley invite. Paste the whole link, or the 12-character code.');
    router.push({ pathname: '/join/[code]', params: { code } });
  };
  return (
    <Screen footer={<Button title="Find the trip" icon="ticket" onPress={go} testID="join-code-go" />}>
      <View style={{ height: 120, borderRadius: radius.lg, overflow: 'hidden' }}>
        <Postcard seed="join-a-trip" emoji="🎟️" />
      </View>
      <Stack gap={space.xs}>
        <Text variant="title">Join a trip</Text>
        <Text muted>Paste the invite link a friend sent you, or type the code at the end of it.</Text>
      </Stack>
      <Field
        label="Invite link or code"
        testID="join-code-input"
        value={input}
        onChangeText={(v) => {
          setInput(v);
          setError(null);
        }}
        placeholder="https://…/join/ab12cd34ef56"
        autoCapitalize="none"
        autoCorrect={false}
        error={error}
        onSubmitEditing={go}
      />
      <Text variant="caption" faint>You’ll see the trip and who’s going before you join.</Text>
    </Screen>
  );
}
