// Delivers each new row in public.notifications as a push notification through
// the Expo push service (APNs on iPhone, FCM on Android).
//
// Wire it up in Supabase: Database -> Webhooks -> Create:
//   table public.notifications, event INSERT, type "Supabase Edge Functions",
//   function send-push, HTTP header  x-webhook-secret: <PUSH_WEBHOOK_SECRET>

import { requireEnv } from '../_shared/env.ts';
import { errorResponse, json, safeEqual } from '../_shared/http.ts';
import { adminClient, isUuid } from '../_shared/supabase.ts';

type NotificationRow = {
  id: string;
  user_id: string;
  trip_id: string | null;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

type ExpoTicket = { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST.');
  if (!safeEqual(req.headers.get('x-webhook-secret') ?? '', requireEnv('PUSH_WEBHOOK_SECRET'))) {
    return errorResponse(401, 'unauthorized', 'Bad secret.');
  }

  let payload: { type?: string; table?: string; record?: NotificationRow };
  try {
    payload = await req.json();
  } catch {
    return errorResponse(400, 'bad_request', 'Send JSON.');
  }
  const n = payload.record;
  if (payload.type !== 'INSERT' || payload.table !== 'notifications' || !n || !isUuid(n.user_id)) {
    return json({ ignored: true });
  }

  const admin = adminClient();
  const { data: tokens, error } = await admin
    .from('push_tokens')
    .select('token')
    .eq('user_id', n.user_id)
    .in('platform', ['ios', 'android']);
  if (error) throw error;
  if (!tokens?.length) return json({ sent: 0 });

  const messages = tokens.map((t) => ({
    to: t.token,
    title: n.title,
    body: n.body,
    sound: 'default',
    data: { ...n.data, kind: n.kind, notification_id: n.id },
    channelId: 'default',
  }));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (expoToken) headers.Authorization = `Bearer ${expoToken}`;

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    console.error('expo push failed', res.status, await res.text());
    return errorResponse(502, 'push_failed', 'Push service error.');
  }
  const { data: tickets } = (await res.json()) as { data: ExpoTicket[] };

  // Forget tokens for uninstalled apps.
  const dead = tickets
    .map((t, i) => (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? tokens[i].token : null))
    .filter((t): t is string => t !== null);
  if (dead.length) await admin.from('push_tokens').delete().in('token', dead);

  return json({ sent: tickets.filter((t) => t.status === 'ok').length, removed: dead.length });
});
