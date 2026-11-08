import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Contact } from 'expo-contacts';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Share, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { defaultCountry, PhoneInput, toE164 } from '@/components/PhoneInput';
import { Avatar, Banner, Button, Card, Chip, Field, Row, Screen, SectionTitle, Segmented, Stack, Text } from '@/components/ui';
import { inviteUrl } from '@/config';
import { inviteByEmail, inviteByPhone, inviteUser } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { keys, useFriends } from '@/lib/queries';
import { useTripData } from '@/lib/trip-hooks';
import type { InviteResult } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { space, useTheme } from '@/theme';

export default function Invite() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const { trip, byId, active } = useTripData(id);
  const friends = useFriends();
  const [method, setMethod] = useState<'phone' | 'email'>('phone');
  const [country, setCountry] = useState(defaultCountry());
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string; sms?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (!trip) return null;
  const link = inviteUrl(trip.invite_code);
  const text = `${profile?.display_name ?? 'I'} invited you to "${trip.name}" on Tripley. Join here: ${link}`;

  const shareLink = async () => {
    if (Platform.OS === 'web' && !navigator.share) {
      await Clipboard.setStringAsync(link);
      setCopied(true);
      return;
    }
    await Share.share(Platform.OS === 'ios' ? { message: text, url: link } : { message: text }).catch(() => undefined);
  };

  const describe = (r: InviteResult, who: string, smsTo?: string) => {
    switch (r) {
      case 'invited':
        return setMessage({ tone: 'success', text: `Invitation sent. ${who} will see it in Tripley.` });
      case 'already_member':
        return setMessage({ tone: 'warning', text: `${who} is already on this trip.` });
      case 'already_invited':
        return setMessage({ tone: 'warning', text: `${who} already has an invitation waiting.` });
      case 'not_found':
        return setMessage({
          tone: 'warning',
          text: `${who} isn't on Tripley yet. Send them the link and they can join in a minute.`,
          sms: smsTo,
        });
    }
  };

  const invite = async () => {
    setMessage(null);
    setBusy(true);
    try {
      if (method === 'phone') {
        const e164 = toE164(country.dial, phone);
        if (!e164) {
          setMessage({ tone: 'danger', text: 'Enter the full phone number.' });
          return;
        }
        describe(await inviteByPhone(id, e164), 'They', e164);
      } else {
        describe(await inviteByEmail(id, email.trim()), 'They');
      }
      await qc.invalidateQueries({ queryKey: keys.sentInvites(id) });
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const pickContact = async () => {
    try {
      const contact = await Contact.presentPicker();
      const phones = (await contact?.getPhones()) ?? [];
      const number = phones[0]?.number;
      if (number) setPhone(number.trim().startsWith('+') ? number.trim() : number);
    } catch {
      setMessage({ tone: 'danger', text: "Couldn't open contacts." });
    }
  };

  const smsLink = (to: string) => `sms:${to}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(text)}`;
  const pastFriends = (friends.data ?? []).filter((f) => !byId.has(f.user_id));

  return (
    <Screen>
      {!active ? <Banner tone="warning">This trip has ended, so new people can&apos;t join.</Banner> : null}
      <Card style={{ alignItems: 'center' }}>
        <Text variant="heading">Share the invite link</Text>
        <View style={{ padding: space.md, backgroundColor: '#fff', borderRadius: 12 }}>
          <QRCode value={link} size={168} />
        </View>
        <Text variant="caption" muted center>{link}</Text>
        <Row style={{ alignSelf: 'stretch' }}>
          <Button title="Share link" icon="share" onPress={shareLink} style={{ flex: 1 }} testID="share-link" />
          <Button
            title={copied ? 'Copied' : 'Copy'}
            icon={copied ? 'check' : 'copy'}
            kind="secondary"
            onPress={async () => {
              await Clipboard.setStringAsync(link);
              setCopied(true);
            }}
            style={{ flex: 1 }}
          />
        </Row>
        <Text variant="caption" faint center>
          Friends with the app go straight to the trip. Others can join in the browser and get the app later.
        </Text>
      </Card>

      <Stack gap={space.sm}>
        <SectionTitle>Or invite someone already on Tripley</SectionTitle>
        <Segmented
          value={method}
          onChange={(m) => {
            setMethod(m);
            setMessage(null);
          }}
          options={[
            { value: 'phone', label: 'Phone number' },
            { value: 'email', label: 'Email' },
          ]}
        />
        {method === 'phone' ? (
          <>
            <PhoneInput label="Their phone number" country={country} onCountry={setCountry} value={phone} onChangeText={setPhone} />
            {Platform.OS !== 'web' ? <Button title="Pick from contacts" icon="contacts" kind="ghost" small onPress={pickContact} /> : null}
          </>
        ) : (
          <Field label="Their email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="friend@example.com" />
        )}
        <Button title="Send invitation" onPress={invite} loading={busy} disabled={!active} testID="send-invite" />
        {message ? (
          <Banner
            tone={message.tone}
            action={
              message.sms ? (
                <Row>
                  <Button title="Text them the link" small onPress={() => Linking.openURL(smsLink(message.sms!))} />
                  <Button title="Share…" small kind="secondary" onPress={shareLink} />
                </Row>
              ) : undefined
            }>
            {message.text}
          </Banner>
        ) : null}
      </Stack>

      {pastFriends.length > 0 && active ? (
        <Stack gap={space.sm}>
          <SectionTitle>People from your other trips</SectionTitle>
          <Row style={{ flexWrap: 'wrap' }}>
            {pastFriends.map((f) => (
              <Row key={f.user_id} gap={space.xs}>
                <Avatar id={f.user_id} name={f.display_name} url={f.avatar_url} size={28} />
                <Chip
                  label={`Invite ${f.display_name.split(' ')[0] || 'friend'}`}
                  onPress={async () => {
                    try {
                      describe(await inviteUser(id, f.user_id), f.display_name || 'They');
                      await qc.invalidateQueries({ queryKey: keys.sentInvites(id) });
                    } catch (e) {
                      setMessage({ tone: 'danger', text: errorMessage(e) });
                    }
                  }}
                />
              </Row>
            ))}
          </Row>
        </Stack>
      ) : null}
      <Text variant="caption" faint style={{ color: t.textFaint }}>
        Phone numbers are only used to find people who already use Tripley. Nobody sees your number.
      </Text>
    </Screen>
  );
}
