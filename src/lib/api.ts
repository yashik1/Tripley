/**
 * All reads and writes to Supabase. Screens use these through the React Query
 * hooks in ./queries.ts. Row Level Security on the server decides what each
 * person can see and change; these functions just shape the requests.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import type { ShareRow, SettlementRow } from './balances';
import type { ScannedReceipt } from './receipt';
import { supabase } from './supabase';
import type {
  Account,
  AppNotification,
  Bill,
  BillDetail,
  Invitation,
  InviteResult,
  Member,
  MemberLocation,
  Profile,
  SentInvitation,
  Settlement,
  SharingMode,
  Trip,
  TripFriend,
  TripPreview,
  TripWithCount,
} from './types';

function check<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Please sign in first.');
  return id;
}

// ---------------------------------------------------------------- profile

export async function getProfile(userId: string): Promise<Profile | null> {
  return check(await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()) as Profile | null;
}

export async function updateProfile(
  patch: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'default_currency' | 'payment_handles'>>,
): Promise<void> {
  const id = await uid();
  check(await supabase.from('profiles').update(patch).eq('id', id));
}

export async function getAccount(): Promise<Account | null> {
  const id = await uid();
  return check(
    await supabase.from('accounts').select('plan, plan_expires_at, ai_scans_used, ai_scans_period').eq('user_id', id).maybeSingle(),
  ) as Account | null;
}

export function isPro(account: Account | null | undefined): boolean {
  if (!account || account.plan !== 'pro') return false;
  return !account.plan_expires_at || new Date(account.plan_expires_at).getTime() > Date.now();
}

// ---------------------------------------------------------------- trips

export async function listMyTrips(): Promise<TripWithCount[]> {
  return check(
    await supabase.from('trips').select('*, trip_members(count)').order('created_at', { ascending: false }),
  ) as TripWithCount[];
}

export async function getTrip(id: string): Promise<Trip | null> {
  return check(await supabase.from('trips').select('*').eq('id', id).maybeSingle()) as Trip | null;
}

export async function createTrip(input: {
  name: string;
  base_currency: string;
  starts_on?: string | null;
  ends_on?: string | null;
}): Promise<Trip> {
  const organizer_id = await uid();
  return check(
    await supabase.from('trips').insert({ ...input, organizer_id }).select('*').single(),
  ) as Trip;
}

export async function updateTrip(
  id: string,
  patch: Partial<Pick<Trip, 'name' | 'starts_on' | 'ends_on' | 'invite_enabled' | 'ended_at'>>,
): Promise<void> {
  check(await supabase.from('trips').update(patch).eq('id', id));
}

export async function deleteTrip(id: string): Promise<void> {
  check(await supabase.from('trips').delete().eq('id', id));
}

export async function regenerateInviteCode(tripId: string): Promise<string> {
  return check(await supabase.rpc('regenerate_invite_code', { p_trip: tripId })) as string;
}

export function isTripActive(trip: Pick<Trip, 'ended_at' | 'ends_on'>): boolean {
  if (trip.ended_at) return false;
  if (!trip.ends_on) return true;
  const end = new Date(`${trip.ends_on}T23:59:59Z`).getTime() + 24 * 3600 * 1000;
  return Date.now() <= end;
}

// ---------------------------------------------------------------- members

export async function listMembers(tripId: string): Promise<Member[]> {
  return check(
    await supabase
      .from('trip_members')
      .select('*, profile:profiles(*)')
      .eq('trip_id', tripId)
      .order('joined_at', { ascending: true }),
  ) as Member[];
}

/** All my memberships, used to decide which trips to share location with. */
export async function listMySharingMemberships(): Promise<
  { trip_id: string; location_sharing: boolean; sharing_mode: SharingMode; trip: Pick<Trip, 'id' | 'name' | 'ended_at' | 'ends_on'> }[]
> {
  const me = await uid();
  return check(
    await supabase
      .from('trip_members')
      .select('trip_id, location_sharing, sharing_mode, trip:trips(id, name, ended_at, ends_on)')
      .eq('user_id', me),
  ) as never;
}

export async function updateMySharing(
  tripId: string,
  patch: { location_sharing?: boolean; sharing_mode?: SharingMode },
): Promise<void> {
  const me = await uid();
  check(await supabase.from('trip_members').update(patch).eq('trip_id', tripId).eq('user_id', me));
}

export async function removeMember(tripId: string, userId: string): Promise<void> {
  check(await supabase.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId));
}

export async function leaveTrip(tripId: string): Promise<void> {
  await removeMember(tripId, await uid());
}

// ---------------------------------------------------------------- invites

export async function tripPreview(code: string): Promise<TripPreview | null> {
  const rows = check(await supabase.rpc('trip_preview', { p_code: code })) as TripPreview[] | null;
  return rows?.[0] ?? null;
}

export async function joinTripByCode(code: string): Promise<string> {
  return check(await supabase.rpc('join_trip_by_code', { p_code: code })) as string;
}

export async function myInvitations(): Promise<Invitation[]> {
  return (check(await supabase.rpc('my_invitations')) as Invitation[] | null) ?? [];
}

export async function respondToInvitation(invitationId: string, accept: boolean): Promise<string> {
  return check(
    await supabase.rpc('respond_to_invitation', { p_invitation: invitationId, p_accept: accept }),
  ) as string;
}

export async function listSentInvitations(tripId: string): Promise<SentInvitation[]> {
  return check(
    await supabase
      .from('trip_invitations')
      .select('id, trip_id, invitee_id, status, created_at, invitee:profiles!invitee_id(display_name)')
      .eq('trip_id', tripId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
  ) as never;
}

export async function cancelInvitation(invitationId: string): Promise<void> {
  check(await supabase.rpc('cancel_invitation', { p_invitation: invitationId }));
}

export async function inviteByPhone(tripId: string, phone: string): Promise<InviteResult> {
  return check(await supabase.rpc('invite_by_phone', { p_trip: tripId, p_phone: phone })) as InviteResult;
}

export async function inviteByEmail(tripId: string, email: string): Promise<InviteResult> {
  return check(await supabase.rpc('invite_by_email', { p_trip: tripId, p_email: email })) as InviteResult;
}

export async function inviteUser(tripId: string, userId: string): Promise<InviteResult> {
  return check(await supabase.rpc('invite_user', { p_trip: tripId, p_user: userId })) as InviteResult;
}

export async function myTripFriends(): Promise<TripFriend[]> {
  return (check(await supabase.rpc('my_trip_friends')) as TripFriend[] | null) ?? [];
}

// ---------------------------------------------------------------- locations

export async function listLocations(tripId: string): Promise<MemberLocation[]> {
  return check(await supabase.from('member_locations').select('*').eq('trip_id', tripId)) as MemberLocation[];
}

export type Coords = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  timestamp?: number;
  battery?: number | null;
};

/** Upload my latest position to each trip I'm sharing with. Returns trips that accepted it. */
export async function uploadMyLocation(tripIds: string[], c: Coords): Promise<string[]> {
  const me = await uid();
  const recorded_at = new Date(c.timestamp ?? Date.now()).toISOString();
  const results = await Promise.allSettled(
    tripIds.map(async (trip_id) => {
      const { error } = await supabase.from('member_locations').upsert(
        {
          trip_id,
          user_id: me,
          lat: c.latitude,
          lng: c.longitude,
          accuracy_m: c.accuracy ?? null,
          heading: c.heading != null && c.heading >= 0 ? c.heading : null,
          speed_mps: c.speed != null && c.speed >= 0 ? c.speed : null,
          battery_level: c.battery ?? null,
          recorded_at,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'trip_id,user_id' },
      );
      if (error) throw error;
      return trip_id;
    }),
  );
  return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
}

// ---------------------------------------------------------------- bills

export async function listBills(tripId: string): Promise<Bill[]> {
  return check(
    await supabase
      .from('bills')
      .select('*, bill_shares(*)')
      .eq('trip_id', tripId)
      .order('bill_date', { ascending: false })
      .order('created_at', { ascending: false }),
  ) as Bill[];
}

export async function getBill(billId: string): Promise<BillDetail | null> {
  const bill = check(
    await supabase
      .from('bills')
      .select('*, bill_shares(*), bill_items(*, bill_item_shares(user_id, weight))')
      .eq('id', billId)
      .maybeSingle(),
  ) as BillDetail | null;
  bill?.bill_items.sort((a, b) => a.position - b.position);
  return bill;
}

export type SaveBillPayload = {
  id?: string;
  trip_id: string;
  paid_by: string;
  title: string;
  bill_date?: string;
  currency: string;
  fx_rate: number;
  split_mode: 'itemized' | 'equal';
  tax_minor: number;
  service_minor: number;
  tip_minor: number;
  discount_minor: number;
  total_minor: number;
  total_base_minor: number;
  receipt_path?: string | null;
  source: 'manual' | 'ai';
  notes?: string | null;
  items: { name: string; quantity: number; line_total_minor: number; shares: { user_id: string; weight: number }[] }[];
  shares: { user_id: string; amount_minor: number; amount_base_minor: number }[];
};

export async function saveBill(payload: SaveBillPayload): Promise<string> {
  return check(await supabase.rpc('save_bill', { p: payload })) as string;
}

export async function deleteBill(billId: string): Promise<void> {
  check(await supabase.from('bills').delete().eq('id', billId));
}

function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Upload a receipt photo (already resized to JPEG) into the trip's private folder. */
export async function uploadReceipt(tripId: string, localUri: string): Promise<string> {
  const path = `${tripId}/${randomId()}.jpg`;
  const body = await (await fetch(localUri)).arrayBuffer();
  check(await supabase.storage.from('receipts').upload(path, body, { contentType: 'image/jpeg', upsert: false }));
  return path;
}

export async function receiptUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export class ScanError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function scanReceipt(
  path: string,
  tripId: string,
  currencyHint: string,
): Promise<{ receipt: ScannedReceipt; scans_left: number }> {
  const { data, error } = await supabase.functions.invoke('scan-receipt', {
    body: { path, trip_id: tripId, currency_hint: currencyHint },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
      if (body?.error) throw new ScanError(body.error.code, body.error.message);
    }
    throw new ScanError('network', 'Could not reach receipt reading. You can type the items in.');
  }
  return data as { receipt: ScannedReceipt; scans_left: number };
}

// ---------------------------------------------------------------- balances

export async function listShareRows(tripId: string): Promise<ShareRow[]> {
  const rows = check(
    await supabase
      .from('bill_shares')
      .select('bill_id, user_id, amount_base_minor, bill:bills!inner(trip_id, paid_by, title)')
      .eq('bill.trip_id', tripId),
  ) as unknown as { bill_id: string; user_id: string; amount_base_minor: number; bill: { paid_by: string; title: string } }[];
  return rows.map((r) => ({
    billId: r.bill_id,
    billTitle: r.bill.title,
    paidBy: r.bill.paid_by,
    userId: r.user_id,
    amountBaseMinor: r.amount_base_minor,
  }));
}

export async function listSettlements(tripId: string): Promise<Settlement[]> {
  return check(
    await supabase.from('settlements').select('*').eq('trip_id', tripId).order('created_at', { ascending: false }),
  ) as Settlement[];
}

export function toSettlementRows(s: Settlement[]): SettlementRow[] {
  return s.map((x) => ({
    id: x.id,
    fromUser: x.from_user,
    toUser: x.to_user,
    amountBaseMinor: x.amount_base_minor,
    status: x.status,
  }));
}

export async function markPaid(input: {
  trip_id: string;
  to_user: string;
  amount_base_minor: number;
  method?: string | null;
  note?: string | null;
}): Promise<void> {
  check(await supabase.from('settlements').insert(input));
}

/** The person who was owed records money they received (cash, transfer...). */
export async function recordPaymentReceived(input: {
  trip_id: string;
  from_user: string;
  amount_base_minor: number;
  method?: string | null;
  note?: string | null;
}): Promise<void> {
  check(
    await supabase.rpc('record_payment_received', {
      p_trip: input.trip_id,
      p_from: input.from_user,
      p_amount: input.amount_base_minor,
      p_method: input.method ?? null,
      p_note: input.note ?? null,
    }),
  );
}

export async function respondToSettlement(id: string, status: 'confirmed' | 'disputed'): Promise<void> {
  check(await supabase.rpc('respond_to_settlement', { p_settlement: id, p_status: status }));
}

export async function undoSettlement(id: string): Promise<void> {
  check(await supabase.from('settlements').delete().eq('id', id));
}

// ---------------------------------------------------------------- notifications

export async function listNotifications(): Promise<AppNotification[]> {
  return check(
    await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100),
  ) as AppNotification[];
}

export async function markAllNotificationsRead(): Promise<void> {
  check(await supabase.rpc('mark_notifications_read'));
}

export async function savePushToken(token: string): Promise<void> {
  const user_id = await uid();
  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
  check(
    await supabase
      .from('push_tokens')
      .upsert({ token, user_id, platform, updated_at: new Date().toISOString() }, { onConflict: 'token' }),
  );
}

export async function removePushToken(token: string): Promise<void> {
  check(await supabase.from('push_tokens').delete().eq('token', token));
}
