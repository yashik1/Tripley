import type { PaymentHandles } from './payment-links';

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  default_currency: string;
  payment_handles: PaymentHandles;
};

export type Account = {
  plan: 'free' | 'pro';
  plan_expires_at: string | null;
  ai_scans_used: number;
  ai_scans_period: string | null;
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
};

export type TripWithCount = Trip & { trip_members: { count: number }[] };

export type SharingMode = 'live' | 'saver';

export type Member = {
  trip_id: string;
  user_id: string;
  role: 'organizer' | 'member';
  location_sharing: boolean;
  sharing_mode: SharingMode;
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
  created_at: string;
  responded_at: string | null;
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
