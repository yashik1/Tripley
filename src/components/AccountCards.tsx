import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Share, Switch, View } from 'react-native';

import { config } from '@/config';

import { saveGuestAccount, setNewPassword } from '@/lib/account';
import { claimReferral, myReferralCode, setShowAchievements, updateNotificationPrefs } from '@/lib/api';
import { passport } from '@/lib/passport';
import { keys, useAchievements } from '@/lib/queries';
import { errorMessage } from '@/lib/errors';
import type { NotificationPrefs } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { PALETTE_KEYS, PALETTES, space, useThemePrefs, useTheme, type AppearancePref } from '@/theme';
import { Icon } from './Icon';
import { PasswordField } from './AuthLayout';
import { Banner, Button, Card, Chip, Field, Row, Stack, Text } from './ui';

/** For guests: add an email and password to keep this account (same trips) and log in anywhere. */
export function SaveAccountCard({ onSaved }: { onSaved?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const { needsEmailConfirmation } = await saveGuestAccount(email, password);
      if (needsEmailConfirmation) setPending(email.trim());
      else onSaved?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    return (
      <Banner tone="info" title="Check your email" icon="mail">
        {`We sent a link to ${pending}. Open it to finish saving your account. Until then, stay signed in here.`}
      </Banner>
    );
  }

  return (
    <Card>
      <Stack gap={space.xs}>
        <Text variant="heading">Save your account</Text>
        <Text muted>
          Guest accounts only live in this browser. Add an email and password to keep your trips, bills and balances,
          and log in from any device.
        </Text>
      </Stack>
      <Field
        label="Email"
        testID="save-email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
      />
      <PasswordField value={password} onChangeText={setPassword} onSubmitEditing={save} newPassword testID="save-password" />
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Button title="Save my account" onPress={save} loading={busy} testID="save-account" />
    </Card>
  );
}

/** For email accounts: set a new password while logged in. */
export function ChangePasswordCard() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const save = async () => {
    setMessage(null);
    setBusy(true);
    try {
      await setNewPassword(password);
      setPassword('');
      setOpen(false);
      setMessage({ tone: 'success', text: 'Password changed.' });
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text variant="heading">Password</Text>
      {open ? (
        <>
          <PasswordField label="New password" value={password} onChangeText={setPassword} onSubmitEditing={save} newPassword testID="new-password" />
          <Button title="Save new password" small onPress={save} loading={busy} testID="change-password-save" />
        </>
      ) : (
        <Button title="Change password" kind="secondary" small onPress={() => setOpen(true)} testID="change-password" />
      )}
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
    </Card>
  );
}

/** Which feed notifications this person wants. Saved on their profile; the server checks it before notifying. */
export function NotificationPrefsCard() {
  const t = useTheme();
  const { profile, user, refreshProfile } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prefs = profile?.notification_prefs ?? {};
  const rows: { key: keyof NotificationPrefs; label: string; detail: string; def: boolean }[] = [
    { key: 'posts', label: 'New posts and photos', detail: 'When someone posts in a trip', def: true },
    { key: 'announcements', label: 'Announcements', detail: 'From the trip organizer', def: true },
    { key: 'comments', label: 'Comments on your posts', detail: 'When someone replies to you', def: true },
    { key: 'reactions', label: 'Reactions to your posts', detail: 'Off unless you want them', def: false },
  ];
  const toggle = async (key: keyof NotificationPrefs, value: boolean) => {
    if (!user) return;
    setBusy(key);
    setError(null);
    try {
      await updateNotificationPrefs(user.id, { ...prefs, [key]: value });
      await refreshProfile();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card testID="notification-prefs">
      <Text variant="heading">Notifications</Text>
      {rows.map((r) => {
        const on = prefs[r.key] ?? r.def;
        return (
          <Row key={r.key} gap={space.md}>
            <View style={{ flex: 1 }}>
              <Text variant="label">{r.label}</Text>
              <Text variant="caption" muted>{r.detail}</Text>
            </View>
            <Switch
              value={on}
              disabled={busy === r.key}
              onValueChange={(v) => toggle(r.key, v)}
              trackColor={{ true: t.primary, false: t.border }}
              thumbColor="#fff"
              accessibilityLabel={r.label}
              testID={`pref-${r.key}`}
            />
          </Row>
        );
      })}
      <Text variant="caption" faint>Bills, payments and invitations are always sent; they affect your money and trips.</Text>
      {error ? <Text variant="caption" color={t.danger}>{error}</Text> : null}
    </Card>
  );
}

/** The travel passport: badges earned from real activity, and whether trip mates can see them. */
export function PassportCard() {
  const t = useTheme();
  const { profile, user, refreshProfile } = useAuth();
  const achievements = useAchievements(user?.id);
  const [busy, setBusy] = useState(false);
  const list = passport(achievements.data ?? []);
  const earned = list.filter((b) => b.earnedAt).length;
  const tint: Record<string, [string, string]> = {
    teal: [t.primarySoft, t.primary],
    coral: [t.coralSoft, t.coralText],
    yellow: [t.yellowSoft, t.yellowText],
    sky: [t.skySoft, t.sky],
  };
  return (
    <Card testID="passport">
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="heading">Travel passport</Text>
        <Text variant="label" color={t.primary} testID="passport-count">{earned}/{list.length}</Text>
      </Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {list.map((b) => {
          const [bg, fg] = b.earnedAt ? tint[b.color] : [t.surfaceAlt, t.textFaint];
          return (
            <View
              key={b.key}
              accessible
              accessibilityLabel={`${b.title}: ${b.earnedAt ? `earned ${new Date(b.earnedAt).toLocaleDateString()}` : `not yet. ${b.condition}`}`}
              testID={`badge-${b.key}`}
              style={{ flexBasis: 150, flexGrow: 1, borderRadius: 16, padding: space.sm, backgroundColor: bg, opacity: b.earnedAt ? 1 : 0.75, gap: 2 }}>
              <Text style={{ fontSize: 26 }}>{b.earnedAt ? b.emoji : '🔒'}</Text>
              <Text variant="label" color={b.earnedAt ? fg : t.textMuted}>{b.title}</Text>
              <Text variant="caption" muted style={{ fontSize: 12 }}>
                {b.earnedAt ? `${b.description} Earned ${new Date(b.earnedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.` : b.condition}
              </Text>
            </View>
          );
        })}
      </View>
      <Row gap={space.md}>
        <View style={{ flex: 1 }}>
          <Text variant="label">Show my badges to people I travel with</Text>
          <Text variant="caption" muted>Off: only you see them.</Text>
        </View>
        <Switch
          value={!!profile?.show_achievements}
          disabled={busy}
          onValueChange={async (v) => {
            if (!user) return;
            setBusy(true);
            await setShowAchievements(user.id, v).catch(() => undefined);
            await refreshProfile();
            setBusy(false);
          }}
          trackColor={{ true: t.primary, false: t.border }}
          thumbColor="#fff"
          accessibilityLabel="Show my badges to people I travel with"
          testID="passport-visible"
        />
      </Row>
    </Card>
  );
}

/**
 * Invite friends: your code and link (both of you get a month of Pro once the
 * friend is on a trip with someone), and a place to use a friend's code in
 * your first 14 days.
 */
export function InviteFriendsCard({ guest }: { guest: boolean }) {
  const qc = useQueryClient();
  const code = useQuery({ queryKey: ['referralCode'], queryFn: myReferralCode, enabled: !guest, staleTime: Infinity });
  const [friendCode, setFriendCode] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const link = code.data ? `https://${config.appDomain}/?ref=${code.data}` : null;
  const claim = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await claimReferral(friendCode.trim());
      await qc.invalidateQueries({ queryKey: keys.account });
      setNote(r === 'rewarded' ? 'Done: you both get a month of Pro.' : r === 'already' ? 'You’ve already used an invite code.' : 'Done. You both get a month of Pro once you’re on a trip with someone.');
      setFriendCode('');
    } catch (e) {
      setNote(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card testID="invite-friends">
      <Text variant="heading">Invite friends to Tripley</Text>
      {guest ? (
        <Text muted>Save your account to get an invite link.</Text>
      ) : (
        <>
          <Text muted>When a friend signs up with your link and goes on a trip with someone, you both get a month of Tripley Pro (up to 6 a year).</Text>
          {code.data ? (
            <Text variant="title" testID="referral-code">{code.data}</Text>
          ) : null}
          {link ? (
            <Button
              title="Share your link"
              icon="share"
              kind="secondary"
              small
              onPress={() => Share.share({ message: `Plan our next trip on Tripley: ${link}` }).catch(() => undefined)}
              testID="referral-share"
              style={{ alignSelf: 'flex-start' }}
            />
          ) : null}
        </>
      )}
      <Row gap={space.sm} align="flex-end">
        <Field label="Got a friend’s code?" value={friendCode} onChangeText={setFriendCode} autoCapitalize="characters" maxLength={8} style={{ flex: 1 }} testID="referral-claim-code" />
        <Button title="Use it" small onPress={claim} loading={busy} disabled={friendCode.trim().length !== 8} testID="referral-claim" />
      </Row>
      {note ? <Text variant="caption" muted testID="referral-note">{note}</Text> : null}
    </Card>
  );
}

/**
 * How the app looks for you: System, Light or Dark, and a colour. Saved to
 * your account, so every device you sign in on matches.
 */
export function AppearanceCard() {
  const t = useTheme();
  const { appearance, palette, setAppearance, setPalette, saveError } = useThemePrefs();
  const modes: { value: AppearancePref; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
  return (
    <Card testID="appearance">
      <Text variant="heading">Appearance</Text>
      <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
        {modes.map((m) => (
          <Chip key={m.value} label={m.label} selected={appearance === m.value} onPress={() => setAppearance(m.value)} testID={`appearance-${m.value}`} />
        ))}
      </Row>
      <Text variant="label" muted>Colour</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }} accessibilityRole="radiogroup">
        {PALETTE_KEYS.map((k) => {
          const chosen = palette === k;
          const swatch = PALETTES[k][t.scheme].primary;
          return (
            <Pressable
              key={k}
              onPress={() => setPalette(k)}
              accessibilityRole="radio"
              accessibilityState={{ checked: chosen }}
              accessibilityLabel={`${PALETTES[k].label} colour`}
              testID={`palette-${k}`}
              style={{ alignItems: 'center', gap: 4, width: 64 }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: swatch,
                  borderWidth: 3,
                  borderColor: chosen ? t.text : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                {chosen ? <Icon name="check" size={18} color={PALETTES[k][t.scheme].primaryText} /> : null}
              </View>
              <Text variant="caption" muted={!chosen}>{PALETTES[k].label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text variant="caption" faint>Trips with a theme use their own colours inside the trip.</Text>
      {saveError ? <Text variant="caption" color={t.danger}>{saveError}</Text> : null}
    </Card>
  );
}
