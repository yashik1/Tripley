/**
 * Spin the Adventure Wheel (an optional extra, off unless the feature
 * catalogue turns it on): picks an idea at random, including the group's
 * own food finds.
 */
import { useState } from 'react';

import { FunIntro } from '@/components/TripFun';
import { Button, Card, Screen, Text } from '@/components/ui';
import { useFunEntries } from '@/lib/queries';
import { useTripId } from '@/lib/trip-context';

const IDEAS = [
  'Try a local café or bakery',
  'Take a scenic walk somewhere new',
  'Visit a market',
  'Find a viewpoint for sunset',
  'Try a food you have never had',
  'Explore a neighbourhood without a plan',
  'Play a group photo challenge',
  'Ask a local for a recommendation',
];

export default function Wheel() {
  const id = useTripId();
  const entries = useFunEntries(id);
  const [pick, setPick] = useState<string | null>(null);
  const spin = () => {
    const options = [...IDEAS, ...(entries.data ?? []).filter((e) => e.kind === 'food').map((e) => e.title)];
    setPick(options[Math.floor(Math.random() * options.length)]);
  };
  return (
    <Screen>
      <FunIntro emoji="🎡" title="Spin the Adventure Wheel" blurb="Can’t decide? Let chance pick what the group does next." />
      <Card>
        <Text style={{ fontSize: 56, textAlign: 'center' }}>🎡</Text>
        {pick ? <Text variant="heading" center testID="fun-pick">🎡 {pick}</Text> : null}
        <Button title={pick ? 'Spin again' : 'Spin the wheel'} onPress={spin} testID="fun-spin" />
      </Card>
    </Screen>
  );
}
