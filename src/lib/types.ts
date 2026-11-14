import type { PaymentHandles } from './payment-links';

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  default_currency: string;
  payment_handles: PaymentHandles;
  notification_prefs?: NotificationPrefs;
  show_achievements?: boolean;
  /** How the app looks for you: System, Light or Dark, and a colour palette. */
  appearance?: 'system' | 'light' | 'dark';
  palette?: 'teal' | 'ocean' | 'sunset' | 'forest' | 'lavender' | 'midnight' | 'berry';
};

export type Account = {
  plan: 'free' | 'pro';
  plan_expires_at: string | null;
  ai_scans_used: number;
  ai_scans_period: string | null;
  /** A month of Pro from inviting friends (kept apart from the subscription). */
  bonus_pro_until?: string | null;
};

/** What deleting the signed-in account will do (account_deletion_preview()). */
export type DeletionPreview = {
  /** Trips nobody else is on: deleted with everything in them. */
  trips_deleted: { id: string; name: string }[];
  /** Shared trips: you leave; if you organized one, new_organizer takes over. */
  trips_left: { id: string; name: string; new_organizer: string | null }[];
  /** Open cash kitties in shared trips where you hold the group's cash. */
  kitties_held: number;
  pro: boolean;
  /** Stored photos that are removed with the account. */
  files: { bucket: string; path: string }[];
};

export type Trip = {
  id: string;
  name: string;
  organizer_id: string;
  base_currency: string;
  starts_on: string | null;
  ends_on: string | null;
  invite_code: string;
  invite_enabled: boolean;
  ended_at: string | null;
  created_at: string;
  /** Where the trip goes, e.g. "Lisbon, Portugal" (optional). */
  destination: string | null;
  /** Map point of the destination, when it was picked from address search. */
  destination_lat: number | null;
  destination_lng: number | null;
  /** Date coordination: the days the group is choosing from, and how many days the trip lasts. */
  date_window_start: string | null;
  date_window_end: string | null;
  date_length: number | null;
  /** Cover photo in the private trip-photos bucket (shown through a signed link). */
  cover_path: string | null;
  /** Trip theme (set by the organizer): colours, cover art and ideas. */
  theme?: TripTheme | null;
  /** A famous photo of the destination from Wikipedia (Wikimedia Commons), with its credit. */
  place_photo_url?: string | null;
  place_photo_page?: string | null;
  place_photo_credit?: string | null;
  /** The destination the photo was looked up for (a new destination means a new lookup). */
  place_photo_for?: string | null;
  /** The organizer chose the illustration instead. */
  place_photo_off?: boolean;
};

export type TripTheme = 'beach' | 'ski' | 'city' | 'road_trip' | 'camping' | 'celebration';

export type TripMemberPreview = { user_id: string; profile: { display_name: string; avatar_url: string | null } | null };

export type TripWithCount = Trip & { trip_members: { count: number }[]; members?: TripMemberPreview[] };

/** Counts for the dashboard and planning progress (my_trip_overview). */
export type TripStats = {
  members: number;
  stops: number;
  places: number;
  stay_pinned: boolean;
  bills: number;
  spent_base_minor: number;
  [key: string]: number | boolean;
};

export type SharingMode = 'live' | 'saver';

export type Member = {
  trip_id: string;
  user_id: string;
  role: 'organizer' | 'member';
  location_sharing: boolean;
  sharing_mode: SharingMode;
  arrival_alerts: boolean;
  joined_at: string;
  profile: Profile;
};

export type MemberLocation = {
  trip_id: string;
  user_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  heading: number | null;
  speed_mps: number | null;
  battery_level: number | null;
  recorded_at: string;
  updated_at: string;
};

export type BillShare = { bill_id: string; user_id: string; amount_minor: number; amount_base_minor: number };

export type Bill = {
  id: string;
  trip_id: string;
  paid_by: string;
  created_by: string;
  title: string;
  bill_date: string;
  currency: string;
  fx_rate: number;
  split_mode: 'itemized' | 'equal';
  subtotal_minor: number;
  tax_minor: number;
  service_minor: number;
  tip_minor: number;
  discount_minor: number;
  total_minor: number;
  total_base_minor: number;
  receipt_path: string | null;
  source: 'manual' | 'ai';
  notes: string | null;
  kitty_id: string | null;
  fx_source: 'ecb' | 'manual' | null;
  fx_locked_at: string | null;
  client_id: string | null;
  created_at: string;
  bill_shares: BillShare[];
};

export type BillItem = {
  id: string;
  bill_id: string;
  position: number;
  name: string;
  quantity: number;
  line_total_minor: number;
  bill_item_shares: { user_id: string; weight: number }[];
};

export type BillDetail = Bill & { bill_items: BillItem[] };

export type Settlement = {
  id: string;
  trip_id: string;
  from_user: string;
  to_user: string;
  amount_base_minor: number;
  method: string | null;
  note: string | null;
  status: 'paid' | 'confirmed' | 'disputed';
  kitty_id: string | null;
  kitty_role: 'contribution' | 'handover' | 'payout' | null;
  created_at: string;
  responded_at: string | null;
};

export type PlaceKind = 'stay' | 'airport' | 'meetup' | 'food' | 'sight' | 'memory' | 'other';

export type Place = {
  id: string;
  trip_id: string;
  created_by: string;
  kind: PlaceKind;
  name: string;
  note: string | null;
  lat: number;
  lng: number;
  radius_m: number;
  alerts: boolean;
  photo_path: string | null;
  created_at: string;
};

export type RsvpStatus = 'going' | 'maybe' | 'not_going';

/** A stop or activity in the shared day-by-day plan. Times are "HH:MM:SS" (local to the trip). */
export type ItineraryItem = {
  id: string;
  trip_id: string;
  day: string;
  position: number;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  place_name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ItineraryRsvp = { item_id: string; user_id: string; status: RsvpStatus };

export type ItineraryComment = { id: string; item_id: string; trip_id: string; user_id: string; body: string; created_at: string };

export type PostKind = 'update' | 'photos' | 'place' | 'announcement' | 'event';
export const REACTIONS = ['❤️', '😂', '😮', '👏', '🔥', '👍'] as const;
export type ReactionEmoji = (typeof REACTIONS)[number];

/** A post in a trip's activity feed, with its photos, reactions and comment count. */
export type FeedPost = {
  id: string;
  trip_id: string;
  author_id: string | null;
  kind: PostKind;
  body: string | null;
  place_name: string | null;
  lat: number | null;
  lng: number | null;
  event: { type: string; label?: string; [key: string]: unknown } | null;
  created_at: string;
  post_photos: { path: string; position: number }[];
  post_reactions: { user_id: string; emoji: string }[];
  post_comments: { count: number }[];
  trip?: { name: string } | null;
  author?: { display_name: string; avatar_url: string | null } | null;
};

export type SuggestionCategory = 'food' | 'sight' | 'beach' | 'hike' | 'experience' | 'shopping' | 'nightlife' | 'other';

/** A place or thing to do someone suggested for the trip, with everyone's votes. */
export type Suggestion = {
  id: string;
  trip_id: string;
  suggested_by: string;
  category: SuggestionCategory;
  name: string;
  description: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  photo_path: string | null;
  cost_minor: number | null;
  cost_currency: string | null;
  preferred_day: string | null;
  itinerary_item_id: string | null;
  created_at: string;
  suggestion_votes: { user_id: string }[];
};

export type Poll = {
  id: string;
  trip_id: string;
  created_by: string;
  question: string;
  allow_change: boolean;
  /** People can pick more than one option. */
  multiple: boolean;
  /** Everyone puts the options in order; the result is a Borda count. */
  ranked?: boolean;
  closes_at: string | null;
  closed_at: string | null;
  created_at: string;
  /** Set when whoever started it, or the organizer, edited it. */
  updated_at: string | null;
  poll_options: { id: string; label: string; position: number; suggestion_id?: string | null; itinerary_item_id?: string | null }[];
  poll_votes: { user_id: string; option_id: string; rank?: number | null }[];
};

/** One person's answer for one day: they can go, or maybe. */
export type Availability = { user_id: string; day: string; status: 'yes' | 'maybe' };

export type TripTask = {
  id: string;
  trip_id: string;
  kind: 'packing' | 'group';
  title: string;
  created_by: string;
  assignee_id: string | null;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  created_at: string;
};

export type Challenge = {
  id: string;
  trip_id: string;
  created_by: string;
  title: string;
  description: string | null;
  emoji: string;
  created_at: string;
  challenge_entries: { post_id: string; user_id: string }[];
};

export type PostComment = { id: string; post_id: string; trip_id: string; user_id: string; body: string; created_at: string };

/** Which notifications someone wants (unset = the default). */
export type NotificationPrefs = { posts?: boolean; announcements?: boolean; comments?: boolean; reactions?: boolean };

export type Kitty = {
  id: string;
  trip_id: string;
  name: string;
  holder_id: string;
  created_by: string;
  created_at: string;
  closed_at: string | null;
};

export type KittyOwnCash = {
  id: string;
  kitty_id: string;
  user_id: string;
  amount_base_minor: number;
  note: string | null;
  created_at: string;
};

export type Invitation = {
  invitation_id: string;
  trip_id: string;
  trip_name: string;
  invited_by_name: string;
  starts_on: string | null;
  ends_on: string | null;
  member_count: number;
  created_at: string;
};

export type SentInvitation = {
  id: string;
  trip_id: string;
  invitee_id: string;
  status: string;
  created_at: string;
  invitee: { display_name: string } | null;
};

export type TripPreview = {
  trip_id: string;
  name: string;
  organizer_name: string;
  member_count: number;
  member_names: string[];
  starts_on: string | null;
  ends_on: string | null;
  is_member: boolean;
};

export type TripFriend = { user_id: string; display_name: string; avatar_url: string | null };

export type AppNotification = {
  id: string;
  trip_id: string | null;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type InviteResult = 'invited' | 'already_member' | 'already_invited' | 'not_found';

export type Stay = {
  id: string;
  trip_id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  check_in: string | null;
  check_out: string | null;
  self_pick: boolean;
  bill_id: string | null;
  created_by: string;
  created_at: string;
};
export type Room = { id: string; stay_id: string; trip_id: string; name: string; beds: number; size_weight: number; position: number };
export type RoomGuest = { stay_id: string; room_id: string; user_id: string; assigned_by: string | null };
export type StaysData = { stays: Stay[]; rooms: Room[]; guests: RoomGuest[] };

export type Booking = {
  id: string;
  trip_id: string;
  kind: string;
  title: string;
  provider: string | null;
  reference: string | null;
  start_day: string | null;
  start_time: string | null;
  end_day: string | null;
  end_time: string | null;
  from_place: string | null;
  to_place: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  traveller_ids: string[];
  private: boolean;
  itinerary_item_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
export type TripDocument = {
  id: string;
  trip_id: string;
  booking_id: string | null;
  name: string;
  path: string;
  mime: string;
  size_bytes: number;
  private: boolean;
  uploaded_by: string;
  created_at: string;
};

export type TripTemplate = {
  id: string;
  name: string;
  destination: string | null;
  base_currency: string;
  days: number;
  data: { stops: unknown[]; ideas: unknown[]; tasks: string[]; packing: string[] };
  created_at: string;
};

// ---------------------------------------------------------------- Trip Fun

export type FunKind = 'mission' | 'scavenger' | 'soundtrack' | 'food';
export type FoodKind = 'dish' | 'restaurant' | 'experience';

/** A food find, a song, or (older or optional kinds) a mission or checklist item. */
export type FunEntry = {
  id: string;
  trip_id: string;
  kind: FunKind;
  title: string;
  details: string;
  created_by: string;
  assigned_to: string | null;
  is_complete: boolean;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
  food_kind: FoodKind | null;
  place_name: string | null;
  photo_path: string | null;
  link_url: string | null;
};

export type FunVote = { id: string; trip_id: string; award_key: string; voter_id: string; nominee_id: string; created_at: string };

/** One row of the Trip Fun feature catalogue (on or off, free or Pro). */
export type FunFeature = { feature_key: string; title: string; enabled: boolean; minimum_plan: 'free' | 'pro' };

/** A scrapbook memory: caption, description, the day it happened, photos. */
export type TripMemory = {
  id: string;
  trip_id: string;
  created_by: string;
  caption: string;
  description: string | null;
  happened_on: string;
  photo_paths: string[];
  created_at: string;
  updated_at: string;
};

/** A place in your travel passport (only you see these). */
export type PassportStamp = {
  id: string;
  user_id: string;
  trip_id: string | null;
  place: string;
  country: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
  visited_on: string;
  note: string | null;
  created_at: string;
};
