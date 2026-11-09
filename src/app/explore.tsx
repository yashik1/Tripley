/**
 * Destination ideas to start a trip from. A hand-picked list (not live data);
 * choosing one pre-fills a new trip with the place and its currency.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Postcard } from '@/components/Travel';
import { Button, Card, Chip, Row, Screen, Stack, Text } from '@/components/ui';
import { DESTINATION_TAGS, DESTINATIONS } from '@/lib/destinations';
import { radius, space, useTheme } from '@/theme';

export default function Explore() {
  const t = useTheme();
  const [tag, setTag] = useState<string | null>(null);
  const list = DESTINATIONS.filter((d) => !tag || d.tags.includes(tag as never));
  return (
    <Screen>
      <Stack gap={space.xs}>
        <Text variant="title">Where to next?</Text>
        <Text muted>A few favourites for group trips. Pick one to start planning; you can change everything later.</Text>
      </Stack>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.xs }}>
        <Chip label="All" selected={!tag} onPress={() => setTag(null)} />
        {DESTINATION_TAGS.map((x) => (
          <Chip key={x} label={x} selected={tag === x} onPress={() => setTag(tag === x ? null : x)} />
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {list.map((d) => (
          <Card key={d.id} style={{ padding: 0, gap: 0, overflow: 'hidden', flexBasis: 280, flexGrow: 1 }} testID={`idea-${d.id}`}>
            <View style={{ height: 110 }}>
              <Postcard seed={d.id} emoji={d.emoji} />
            </View>
            <View style={{ padding: space.md, gap: space.sm }}>
              <View>
                <Text variant="heading">{d.name}</Text>
                <Text variant="caption" muted>{d.country} · pay in {d.currency}</Text>
              </View>
              <Text variant="caption">{d.blurb}</Text>
              <Row gap={6} style={{ flexWrap: 'wrap' }}>
                {d.tags.map((x) => (
                  <View key={x} style={{ backgroundColor: t.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text variant="caption" muted style={{ fontSize: 11 }}>{x}</Text>
                  </View>
                ))}
              </Row>
              <Button
                title={`Plan a ${d.name} trip`}
                small
                kind="secondary"
                onPress={() =>
                  router.push({ pathname: '/trips/new', params: { name: `${d.name} trip`, destination: `${d.name}, ${d.country}`, currency: d.currency } })
                }
              />
            </View>
          </Card>
        ))}
      </View>
      <Text variant="caption" faint center>Ideas are a starting point, not live recommendations.</Text>
    </Screen>
  );
}
