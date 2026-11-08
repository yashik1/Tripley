import { Banner, Card, Screen, Text } from '@/components/ui';
import { missingConfig } from '@/config';

/** Shown to developers when the Supabase keys aren't set. */
export default function SetupScreen() {
  const missing = missingConfig();
  return (
    <Screen>
      <Text variant="title">Almost there</Text>
      <Text muted>Tripley needs its backend keys before it can run.</Text>
      <Banner tone="warning" title="Missing settings" icon="settings">
        {missing.join(', ')}
      </Banner>
      <Card>
        <Text variant="label">How to fix</Text>
        <Text>1. Copy .env.example to .env.local</Text>
        <Text>2. Fill in your Supabase project URL and anon (publishable) key</Text>
        <Text>3. Restart: npx expo start</Text>
        <Text muted variant="caption">The README has the full setup guide.</Text>
      </Card>
    </Screen>
  );
}
