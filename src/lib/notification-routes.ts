/** Where tapping a notification (or a recent-activity row) takes you. */
import { router } from 'expo-router';

import type { IconName } from '@/components/Icon';
import type { AppNotification } from './types';

export function openNotification(n: Pick<AppNotification, 'kind' | 'data' | 'trip_id'>) {
  const tripId = typeof n.data.trip_id === 'string' ? n.data.trip_id : n.trip_id;
  if (n.kind === 'invitation') return router.dismissTo('/');
  if (n.kind === 'referral_reward') return router.push('/profile');
  if (!tripId) return;
  if (n.kind === 'kitty_holder' || typeof n.data.kitty_id === 'string') router.push(`/trip/${tripId}/kitty`);
  else if (n.kind === 'arrival' && typeof n.data.place_id === 'string') router.push(`/trip/${tripId}/place/${n.data.place_id}`);
  else if (n.kind.startsWith('settlement')) router.push(`/trip/${tripId}/balances`);
  else if (n.kind.startsWith('bill') && typeof n.data.bill_id === 'string') router.push(`/trip/${tripId}/bill/${n.data.bill_id}`);
  else if (n.kind === 'itinerary_comment' && typeof n.data.item_id === 'string') router.push(`/trip/${tripId}/plan/${n.data.item_id}`);
  else if (n.kind.startsWith('post') && typeof n.data.post_id === 'string') router.push(`/trip/${tripId}/post/${n.data.post_id}`);
  else if (n.kind.startsWith('poll') && typeof n.data.poll_id === 'string') router.push(`/trip/${tripId}/poll/${n.data.poll_id}`);
  else if (n.kind === 'member_joined') router.push(`/trip/${tripId}/people`);
  else if (n.kind === 'room_assigned') router.push(`/trip/${tripId}/stays`);
  else if (n.kind.startsWith('dates')) router.push(`/trip/${tripId}/dates`);
  else router.push(`/trip/${tripId}/overview`);
}

/** An icon for each kind of notification. */
export function notificationIcon(kind: string): IconName {
  if (kind === 'invitation' || kind === 'member_joined') return 'personAdd';
  if (kind.startsWith('bill')) return 'bills';
  if (kind.startsWith('settlement') || kind.startsWith('kitty')) return 'wallet';
  if (kind === 'arrival') return 'location';
  if (kind.startsWith('itinerary')) return 'calendar';
  if (kind.startsWith('post')) return 'feed';
  if (kind.startsWith('poll')) return 'poll';
  if (kind === 'room_assigned') return 'bed';
  if (kind === 'referral_reward') return 'gift';
  if (kind.startsWith('dates')) return 'calendar';
  return 'bell';
}
