/**
 * Delete your account. Shows exactly what will happen first (from the server),
 * then asks you to type DELETE. Nothing is removed until you confirm.
 */
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { Banner, Button, Card, Field, Loading, Row, Screen, Stack, Text } from '@/components/ui';
import { deletionLines } from '@/lib/account-deletion';
import { accountDeletionPreview, deleteMyAccount } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { isGuest } from '@/lib/guest';
import { useAuth } from '@/providers/AuthProvider';
import { space, useTheme } from '@/theme';

const WORD = 'DELETE';

function Line({ children }: { children: string }) {
  const t = useTheme();
  return (
    <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
      <Text color={t.textMuted}>•</Text>
      <Text style={{ flex: 1 }}>{children}</Text>
    </Row>
  );
}

export default function DeleteAccount() {
  const { user, signOut } = useAuth();
  const guest = isGuest(user);
  const preview = useQuery({ queryKey: ['account-deletion-preview'], queryFn: accountDeletionPreview, staleTime: 0, gcTime: 0 });
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await deleteMyAccount();
      // Go home first so the app lands on the home page, not the log-in page.
      router.replace({ pathname: '/', params: { deleted: '1' } });
      await signOut();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  if (preview.isLoading) return <Loading />;
  const p = preview.data;

  return (
    <Screen
      footer={
        <Stack gap={space.sm}>
          <Button
            title="Delete my account"
            kind="danger"
            onPress={submit}
            loading={busy}
            disabled={!p || typed.trim().toUpperCase() !== WORD}
            testID="delete-account-submit"
          />
          <Button title="Keep my account" kind="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))} testID="delete-account-cancel" />
        </Stack>
      }>
      <Stack gap={space.xs}>
        <Text variant="title">Delete your account</Text>
        <Text muted>This is permanent. We can’t bring an account back once it’s deleted.</Text>
      </Stack>

      {preview.isError || !p ? (
        <Banner tone="danger" title="Couldn’t check your account">
          {`${errorMessage(preview.error)} You need a connection to delete your account.`}
        </Banner>
      ) : (
        <>
          <Card testID="delete-preview">
            <Text variant="heading">What happens</Text>
            {deletionLines(p).map((line) => (
              <Line key={line}>{line}</Line>
            ))}
          </Card>

          {p.kitties_held > 0 ? (
            <Banner tone="warning" title="You’re holding the group’s cash" icon="wallet">
              {p.kitties_held === 1
                ? 'You hold the cash for a kitty. Hand it over or give it back first; nobody can record it for you afterwards.'
                : `You hold the cash for ${p.kitties_held} kitties. Hand them over or give the cash back first; nobody can record it for you afterwards.`}
            </Banner>
          ) : null}
          {p.trips_left.length ? (
            <Banner tone="info" title="Settle up first" icon="balances">
              If you owe anyone money, or anyone owes you, settle up before you go. It can’t be marked as paid from your side afterwards.
            </Banner>
          ) : null}
          {p.pro ? (
            <Banner tone="warning" title="Cancel Tripley Pro separately" icon="ticket">
              Deleting your account doesn’t cancel your subscription. Cancel it in your app store’s subscriptions first, or you’ll keep being charged.
            </Banner>
          ) : null}
          {guest ? null : (
            <Text variant="caption" muted>
              You can sign up again later with the same email or phone number, but you’ll start with an empty account.
            </Text>
          )}

          <Field
            label={`Type ${WORD} to confirm`}
            testID="delete-confirm-input"
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={WORD}
            maxLength={12}
          />
        </>
      )}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}
