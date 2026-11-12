/**
 * Organizer insights: who's sharing their location (and how fresh it is), who
 * owes or is owed, and who has answered the open questions (polls, upcoming
 * plans, dates). Built only from what every member can already see in the
 * trip; nothing new is collected.
 */
export type SharingState = 'live' | 'saver' | 'stale' | 'paused';

export type MemberInsight = {
  userId: string;
  sharing: SharingState;
  /** Minutes since their last position, when sharing. */
  lastSeenMin: number | null;
  netMinor: number;
  pollsVoted: number;
  pollsOpen: number;
  rsvpsAnswered: number;
  rsvpsUpcoming: number;
  datesAnswered: boolean | null;
};

export type TripInsights = {
  members: MemberInsight[];
  sharingCount: number;
  staleCount: number;
  owingCount: number;
  /** Everyone answered everything open. */
  allAnswered: boolean;
};

const STALE_MIN = 30;

export function tripInsights(input: {
  members: { user_id: string; location_sharing: boolean; sharing_mode: 'live' | 'saver' }[];
  locations: { user_id: string; updated_at: string }[];
  net: Map<string, number>;
  openPolls: { voters: string[] }[];
  upcomingStops: { id: string }[];
  rsvps: { item_id: string; user_id: string }[];
  datesOpen: boolean;
  datesAnswered: Set<string>;
  now: number;
}): TripInsights {
  const lastSeen = new Map(input.locations.map((l) => [l.user_id, l.updated_at]));
  const upcoming = new Set(input.upcomingStops.map((s) => s.id));
  const members = input.members.map((m) => {
    const seen = lastSeen.get(m.user_id);
    const mins = seen ? Math.max(0, Math.round((input.now - Date.parse(seen)) / 60_000)) : null;
    const sharing: SharingState = !m.location_sharing ? 'paused' : mins == null || mins > STALE_MIN ? 'stale' : m.sharing_mode;
    return {
      userId: m.user_id,
      sharing,
      lastSeenMin: m.location_sharing ? mins : null,
      netMinor: input.net.get(m.user_id) ?? 0,
      pollsVoted: input.openPolls.filter((p) => p.voters.includes(m.user_id)).length,
      pollsOpen: input.openPolls.length,
      rsvpsAnswered: new Set(input.rsvps.filter((r) => r.user_id === m.user_id && upcoming.has(r.item_id)).map((r) => r.item_id)).size,
      rsvpsUpcoming: upcoming.size,
      datesAnswered: input.datesOpen ? input.datesAnswered.has(m.user_id) : null,
    };
  });
  return {
    members,
    sharingCount: members.filter((m) => m.sharing === 'live' || m.sharing === 'saver').length,
    staleCount: members.filter((m) => m.sharing === 'stale').length,
    owingCount: members.filter((m) => m.netMinor < 0).length,
    allAnswered: members.every((m) => m.pollsVoted === m.pollsOpen && m.rsvpsAnswered === m.rsvpsUpcoming && m.datesAnswered !== false),
  };
}

export function lastSeenText(min: number | null): string {
  if (min == null) return 'no position yet';
  if (min < 2) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
