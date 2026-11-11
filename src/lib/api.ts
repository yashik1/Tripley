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
  DeletionPreview,
  AppNotification,
  Challenge,
  FeedPost,
  Bill,
  BillDetail,
  Invitation,
  InviteResult,
  ItineraryComment,
  ItineraryItem,
  ItineraryRsvp,
  Kitty,
  KittyOwnCash,
  Member,
  MemberLocation,
  NotificationPrefs,
  Place,
  PlaceKind,
  Poll,
  PostComment,
  PostKind,
  Profile,
  RsvpStatus,
  SentInvitation,
  Settlement,
  SharingMode,
  Suggestion,
  Trip,
  TripFriend,
  TripPreview,
  TripStats,
  TripTask,
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

export async function accountDeletionPreview(): Promise<DeletionPreview> {
  return check(await supabase.rpc('account_deletion_preview')) as DeletionPreview;
}

/**
 * Deletes the signed-in account. Stored photos go first, through the Storage
 * API (which removes the files themselves); the server refuses to delete the
 * account while any remain, so a failure here leaves everything in place and
 * can simply be tried again.
 */
export async function deleteMyAccount(): Promise<void> {
  const { files } = await accountDeletionPreview();
  const byBucket = new Map<string, string[]>();
  for (const f of files) byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path]);
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 100) {
      check(await supabase.storage.from(bucket).remove(paths.slice(i, i + 100)));
    }
  }
  check(await supabase.rpc('delete_my_account'));
}

export function isPro(account: Account | null | undefined): boolean {
  if (!account || account.plan !== 'pro') return false;
  return !account.plan_expires_at || new Date(account.plan_expires_at).getTime() > Date.now();
}

// ---------------------------------------------------------------- trips

export async function listMyTrips(): Promise<TripWithCount[]> {
  return check(
    await supabase
      .from('trips')
      .select('*, trip_members(count), members:trip_members(user_id, profile:profiles(display_name, avatar_url))')
      .order('created_at', { ascending: false })
      .limit(5, { referencedTable: 'members' }),
  ) as TripWithCount[];
}

/** Counts per trip for the dashboard (only trips you're in). */
export async function getTripOverview(): Promise<Record<string, TripStats>> {
  const rows = check(await supabase.rpc('my_trip_overview')) as { trip_id: string; stats: TripStats }[];
  return Object.fromEntries(rows.map((r) => [r.trip_id, r.stats]));
}

/** The organizer sets a cover photo: uploaded into the trip's private folder. */
export async function setTripCover(tripId: string, localUri: string): Promise<void> {
  const path = await uploadTripPhoto(tripId, localUri);
  check(await supabase.from('trips').update({ cover_path: path }).eq('id', tripId));
}

export async function getTrip(id: string): Promise<Trip | null> {
  return check(await supabase.from('trips').select('*').eq('id', id).maybeSingle()) as Trip | null;
}

export async function createTrip(input: {
  name: string;
  base_currency: string;
  starts_on?: string | null;
  ends_on?: string | null;
  destination?: string | null;
  destination_lat?: number | null;
  destination_lng?: number | null;
}): Promise<Trip> {
  const organizer_id = await uid();
  return check(
    await supabase.from('trips').insert({ ...input, organizer_id }).select('*').single(),
  ) as Trip;
}

export async function updateTrip(
  id: string,
  patch: Partial<
    Pick<Trip, 'name' | 'starts_on' | 'ends_on' | 'invite_enabled' | 'ended_at' | 'destination' | 'destination_lat' | 'destination_lng' | 'cover_path'>
  >,
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
  patch: { location_sharing?: boolean; sharing_mode?: SharingMode; arrival_alerts?: boolean },
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
  /** Made on the device; makes saving the same bill twice (e.g. after being offline) harmless. */
  client_id?: string;
  /** Paid from the cash kitty (paid_by must be its holder). */
  kitty_id?: string | null;
  fx_source?: 'ecb' | 'manual' | null;
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

/** Private receipt photos are shown through links that expire after 10 minutes. */
export const SIGNED_URL_SECONDS = 600;

export async function receiptUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('receipts').createSignedUrl(path, SIGNED_URL_SECONDS);
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

/**
 * Reads a receipt photo with AI. `requestId` stays the same for the same photo,
 * so a retry after a dropped connection returns the first result and isn't
 * charged again. One automatic retry on a network error.
 */
export async function scanReceipt(
  path: string,
  tripId: string,
  currencyHint: string,
  requestId: string,
): Promise<{ receipt: ScannedReceipt; scans_left: number }> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.functions.invoke('scan-receipt', {
      body: { path, trip_id: tripId, currency_hint: currencyHint, request_id: requestId },
    });
    if (!error) return data as { receipt: ScannedReceipt; scans_left: number };
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
      if (body?.error) throw new ScanError(body.error.code, body.error.message);
    }
    if (attempt >= 1) throw new ScanError('network', 'Could not reach receipt reading. You can type the items in.');
    await new Promise((r) => setTimeout(r, 1500));
  }
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

// ---------------------------------------------------------------- places

export async function listPlaces(tripId: string): Promise<Place[]> {
  return check(
    await supabase.from('trip_places').select('*').eq('trip_id', tripId).order('created_at', { ascending: false }),
  ) as Place[];
}

export async function addPlace(input: {
  trip_id: string;
  kind: PlaceKind;
  name: string;
  note?: string | null;
  lat: number;
  lng: number;
  radius_m?: number;
  alerts?: boolean;
  photo_path?: string | null;
}): Promise<Place> {
  const me = await uid();
  return check(await supabase.from('trip_places').insert({ ...input, created_by: me }).select('*').single()) as Place;
}

export async function updatePlace(
  id: string,
  patch: Partial<Pick<Place, 'kind' | 'name' | 'note' | 'radius_m' | 'alerts' | 'photo_path'>>,
): Promise<void> {
  check(await supabase.from('trip_places').update(patch).eq('id', id));
}

export async function deletePlace(id: string): Promise<void> {
  check(await supabase.from('trip_places').delete().eq('id', id));
}

// ---------------------------------------------------------------- activity feed

const FEED_SELECT =
  '*, author:profiles(display_name, avatar_url), post_photos(path, position), post_reactions(user_id, emoji), post_comments(count)';
export const FEED_PAGE = 20;

/** One page of a trip's feed, newest first; pass the oldest time seen to get the next page. */
export async function listFeed(tripId: string, before?: string): Promise<FeedPost[]> {
  let q = supabase.from('trip_posts').select(FEED_SELECT).eq('trip_id', tripId).order('created_at', { ascending: false }).limit(FEED_PAGE);
  if (before) q = q.lt('created_at', before);
  return check(await q) as FeedPost[];
}

/** Latest posts across all your trips (row-level security limits it to your trips). */
export async function listRecentPosts(limit = 6): Promise<FeedPost[]> {
  return check(
    await supabase.from('trip_posts').select(`${FEED_SELECT}, trip:trips(name)`).order('created_at', { ascending: false }).limit(limit),
  ) as FeedPost[];
}

export async function getPost(id: string): Promise<FeedPost | null> {
  return check(await supabase.from('trip_posts').select(FEED_SELECT).eq('id', id).maybeSingle()) as FeedPost | null;
}

export async function createPost(input: {
  tripId: string;
  kind: Exclude<PostKind, 'event'>;
  body?: string | null;
  photos?: string[];
  placeName?: string | null;
  lat?: number | null;
  lng?: number | null;
}): Promise<string> {
  return check(
    await supabase.rpc('create_post', {
      p_trip: input.tripId,
      p_kind: input.kind,
      p_body: input.body ?? null,
      p_photos: input.photos ?? [],
      p_place_name: input.placeName ?? null,
      p_lat: input.lat ?? null,
      p_lng: input.lng ?? null,
    }),
  ) as string;
}

export async function deletePost(id: string): Promise<void> {
  check(await supabase.from('trip_posts').delete().eq('id', id));
}

export async function toggleReaction(postId: string, emoji: string): Promise<boolean> {
  return check(await supabase.rpc('toggle_reaction', { p_post: postId, p_emoji: emoji })) as boolean;
}

export async function listPostComments(postId: string): Promise<PostComment[]> {
  return check(await supabase.from('post_comments').select('*').eq('post_id', postId).order('created_at')) as PostComment[];
}

export async function addPostComment(tripId: string, postId: string, body: string): Promise<void> {
  check(await supabase.from('post_comments').insert({ trip_id: tripId, post_id: postId, body }));
}

export async function deletePostComment(id: string): Promise<void> {
  check(await supabase.from('post_comments').delete().eq('id', id));
}

export async function updateNotificationPrefs(userId: string, prefs: NotificationPrefs): Promise<void> {
  check(await supabase.from('profiles').update({ notification_prefs: prefs }).eq('id', userId));
}

// ---------------------------------------------------------------- bucket list and polls

export type SuggestionInput = Pick<
  Suggestion,
  'category' | 'name' | 'description' | 'address' | 'lat' | 'lng' | 'photo_path' | 'cost_minor' | 'cost_currency' | 'preferred_day'
>;

export async function listSuggestions(tripId: string): Promise<Suggestion[]> {
  return check(
    await supabase.from('trip_suggestions').select('*, suggestion_votes(user_id)').eq('trip_id', tripId).order('created_at', { ascending: false }),
  ) as Suggestion[];
}

export async function addSuggestion(tripId: string, input: SuggestionInput): Promise<void> {
  check(await supabase.from('trip_suggestions').insert({ trip_id: tripId, ...input }));
}

export async function deleteSuggestion(id: string): Promise<void> {
  check(await supabase.from('trip_suggestions').delete().eq('id', id));
}

export async function toggleSuggestionVote(id: string): Promise<boolean> {
  return check(await supabase.rpc('toggle_suggestion_vote', { p_suggestion: id })) as boolean;
}

/** Adds the suggestion to the plan (once; pressing again returns the same stop). */
export async function addSuggestionToPlan(id: string, day?: string | null): Promise<string> {
  return check(await supabase.rpc('add_suggestion_to_plan', { p_suggestion: id, p_day: day ?? null })) as string;
}

export async function listPolls(tripId: string): Promise<Poll[]> {
  return check(
    await supabase
      .from('trip_polls')
      // Named: poll_votes also links polls to options, so the plain name is ambiguous.
      .select('*, poll_options!poll_options_poll_id_fkey(id, label, position), poll_votes(user_id, option_id)')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: false }),
  ) as Poll[];
}

export async function createPoll(
  tripId: string,
  question: string,
  options: string[],
  closesAt: string | null,
  allowChange: boolean,
  multiple = false,
): Promise<string> {
  return check(
    await supabase.rpc('create_poll', {
      p_trip: tripId,
      p_question: question,
      p_options: options,
      p_closes_at: closesAt,
      p_allow_change: allowChange,
      p_multiple: multiple,
    }),
  ) as string;
}

/** Edit an open poll (whoever started it, or the organizer). Options left out are removed with their votes. */
export async function updatePoll(
  pollId: string,
  input: { question: string; options: { id?: string | null; label: string }[]; closesAt: string | null; allowChange: boolean; multiple: boolean },
): Promise<void> {
  check(
    await supabase.rpc('update_poll', {
      p_poll: pollId,
      p_question: input.question,
      p_options: input.options.map((o) => ({ id: o.id ?? null, label: o.label })),
      p_closes_at: input.closesAt,
      p_allow_change: input.allowChange,
      p_multiple: input.multiple,
    }),
  );
}

export async function votePoll(pollId: string, optionId: string | null): Promise<void> {
  check(await supabase.rpc('vote_poll', { p_poll: pollId, p_option: optionId }));
}

export async function closePoll(pollId: string): Promise<void> {
  check(await supabase.rpc('close_poll', { p_poll: pollId }));
}

export async function deletePoll(pollId: string): Promise<void> {
  check(await supabase.from('trip_polls').delete().eq('id', pollId));
}

// ---------------------------------------------------------------- passport

/** Badges this person has earned (yours always; others' only if they share them with you). */
export async function getAchievements(userId: string): Promise<{ key: string; earned_at: string }[]> {
  return check(await supabase.rpc('user_achievements', { p_user: userId })) as { key: string; earned_at: string }[];
}

export async function setShowAchievements(userId: string, show: boolean): Promise<void> {
  check(await supabase.from('profiles').update({ show_achievements: show }).eq('id', userId));
}

// ---------------------------------------------------------------- getting ready

/** Your packing list and the group's tasks (row-level security keeps others' packing private). */
export async function listTasks(tripId: string): Promise<TripTask[]> {
  return check(await supabase.from('trip_tasks').select('*').eq('trip_id', tripId).order('created_at')) as TripTask[];
}

export async function addTasks(tripId: string, kind: TripTask['kind'], titles: string[], assigneeId?: string | null): Promise<void> {
  check(await supabase.from('trip_tasks').insert(titles.map((title) => ({ trip_id: tripId, kind, title, assignee_id: assigneeId ?? null }))));
}

export async function setTaskDone(id: string, done: boolean): Promise<void> {
  check(await supabase.from('trip_tasks').update({ done }).eq('id', id));
}

export async function deleteTask(id: string): Promise<void> {
  check(await supabase.from('trip_tasks').delete().eq('id', id));
}

export async function listChallenges(tripId: string): Promise<Challenge[]> {
  return check(
    await supabase.from('trip_challenges').select('*, challenge_entries(post_id, user_id)').eq('trip_id', tripId).order('created_at', { ascending: false }),
  ) as Challenge[];
}

export async function createChallenge(tripId: string, title: string, description: string | null, emoji: string): Promise<string> {
  return check(await supabase.rpc('create_challenge', { p_trip: tripId, p_title: title, p_description: description, p_emoji: emoji })) as string;
}

export async function enterChallenge(challengeId: string, postId: string): Promise<void> {
  check(await supabase.rpc('enter_challenge', { p_challenge: challengeId, p_post: postId }));
}

// ---------------------------------------------------------------- itinerary

export type ItineraryInput = Pick<
  ItineraryItem,
  'day' | 'title' | 'starts_at' | 'ends_at' | 'place_name' | 'address' | 'lat' | 'lng' | 'notes'
>;

export async function listItinerary(tripId: string): Promise<ItineraryItem[]> {
  return check(
    await supabase
      .from('itinerary_items')
      .select('*')
      .eq('trip_id', tripId)
      .order('day')
      .order('position')
      .order('created_at'),
  ) as ItineraryItem[];
}

export async function listRsvps(tripId: string): Promise<ItineraryRsvp[]> {
  return check(await supabase.from('itinerary_rsvps').select('item_id, user_id, status').eq('trip_id', tripId)) as ItineraryRsvp[];
}

export async function addItineraryItem(tripId: string, input: ItineraryInput): Promise<ItineraryItem> {
  return check(await supabase.from('itinerary_items').insert({ trip_id: tripId, ...input }).select('*').single()) as ItineraryItem;
}

export async function updateItineraryItem(id: string, input: Partial<ItineraryInput>): Promise<void> {
  check(await supabase.from('itinerary_items').update(input).eq('id', id));
}

export async function deleteItineraryItem(id: string): Promise<void> {
  check(await supabase.from('itinerary_items').delete().eq('id', id));
}

export async function moveItineraryItem(id: string, up: boolean): Promise<void> {
  check(await supabase.rpc('move_itinerary_item', { p_item: id, p_up: up }));
}

export async function setRsvp(itemId: string, status: RsvpStatus | null): Promise<void> {
  check(await supabase.rpc('set_itinerary_rsvp', { p_item: itemId, p_status: status }));
}

export async function listItineraryComments(itemId: string): Promise<ItineraryComment[]> {
  return check(
    await supabase.from('itinerary_comments').select('*').eq('item_id', itemId).order('created_at'),
  ) as ItineraryComment[];
}

export async function addItineraryComment(tripId: string, itemId: string, body: string): Promise<void> {
  check(await supabase.from('itinerary_comments').insert({ trip_id: tripId, item_id: itemId, body }));
}

export async function deleteItineraryComment(id: string): Promise<void> {
  check(await supabase.from('itinerary_comments').delete().eq('id', id));
}

/** Upload a photo (already resized to JPEG) for a place or memory into the trip's folder. */
export async function uploadTripPhoto(tripId: string, localUri: string): Promise<string> {
  const path = `${tripId}/${randomId()}.jpg`;
  const body = await (await fetch(localUri)).arrayBuffer();
  check(await supabase.storage.from('trip-photos').upload(path, body, { contentType: 'image/jpeg', upsert: false }));
  return path;
}

export async function tripPhotoUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('trip-photos').createSignedUrl(path, SIGNED_URL_SECONDS);
  return data?.signedUrl ?? null;
}

// ---------------------------------------------------------------- cash kitty

export async function listKitties(tripId: string): Promise<Kitty[]> {
  return check(
    await supabase.from('trip_kitties').select('*').eq('trip_id', tripId).order('created_at', { ascending: true }),
  ) as Kitty[];
}

export async function listKittyOwnCash(tripId: string): Promise<KittyOwnCash[]> {
  const rows = check(
    await supabase.from('kitty_own_cash').select('*, kitty:trip_kitties!inner(trip_id)').eq('kitty.trip_id', tripId),
  ) as (KittyOwnCash & { kitty?: unknown })[];
  return rows.map(({ kitty: _k, ...r }) => r);
}

export async function createKitty(tripId: string, name: string, holderId: string): Promise<string> {
  return check(await supabase.rpc('create_kitty', { p_trip: tripId, p_name: name, p_holder: holderId })) as string;
}

/** `clientId` makes a retry safe: the same id is only ever recorded once. */
export async function kittyAddCash(kittyId: string, fromUser: string, amountBaseMinor: number, clientId: string, note?: string): Promise<void> {
  check(
    await supabase.rpc('kitty_add_cash', {
      p_kitty: kittyId,
      p_from: fromUser,
      p_amount: amountBaseMinor,
      p_note: note ?? null,
      p_client_id: clientId,
    }),
  );
}

export async function kittyHandover(kittyId: string, toUser: string): Promise<void> {
  check(await supabase.rpc('kitty_handover', { p_kitty: kittyId, p_to: toUser }));
}

/** `clientId` makes a retry safe: the same id is only ever recorded once. */
export async function kittyPayout(kittyId: string, toUser: string, amountBaseMinor: number, clientId: string, note?: string): Promise<void> {
  check(
    await supabase.rpc('kitty_payout', {
      p_kitty: kittyId,
      p_to: toUser,
      p_amount: amountBaseMinor,
      p_note: note ?? null,
      p_client_id: clientId,
    }),
  );
}

export async function closeKitty(kittyId: string): Promise<void> {
  check(await supabase.rpc('close_kitty', { p_kitty: kittyId }));
}
