/**
 * Where everyone sleeps, and splitting a stay's cost by room.
 *
 * "By room": the total is shared between the rooms people are in, bigger
 * rooms carrying more (size weight), and each room's part is split equally
 * between the people in it, so a couple in the big room splits that room.
 * "By person": everyone pays in proportion to their room's size weight, so
 * people in bigger rooms pay more each.
 *
 * Either way the result is a list of bill items (one per occupied room, shared
 * by its people), so it goes through the ordinary bill form and save_bill.
 */
import { allocate, computeSplit, type PersonShare } from './split';

export type StayRoom = { id: string; name: string; beds: number; size_weight: number; position: number };
export type StayGuest = { room_id: string; user_id: string };
export type SplitBy = 'room' | 'person';

export type StayItem = { name: string; minor: number; people: string[] };

/** Room size choices shown when adding a room. */
export const ROOM_SIZES: { weight: number; label: string }[] = [
  { weight: 0.75, label: 'Smaller' },
  { weight: 1, label: 'Standard' },
  { weight: 1.5, label: 'Bigger / en-suite' },
  { weight: 2, label: 'Suite' },
];

export function sizeLabel(weight: number): string {
  return ROOM_SIZES.find((s) => s.weight === Number(weight))?.label ?? `${Number(weight)}×`;
}

/** Rooms in display order, each with the people in it. */
export function roomsWithGuests<R extends StayRoom>(rooms: R[], guests: StayGuest[]): (R & { people: string[] })[] {
  return [...rooms]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((r) => ({ ...r, people: guests.filter((g) => g.room_id === r.id).map((g) => g.user_id) }));
}

/** Who on the trip has no bed in this stay yet. */
export function withoutBed(memberIds: string[], guests: StayGuest[]): string[] {
  const placed = new Set(guests.map((g) => g.user_id));
  return memberIds.filter((id) => !placed.has(id));
}

/** Size weights as whole numbers (hundredths), for exact allocation. */
const weightUnits = (w: number) => Math.round(Number(w) * 100);

/**
 * The bill items for splitting `totalMinor` across the occupied rooms.
 * Empty rooms are left out; nobody in any room gives no items.
 */
export function stayItems(totalMinor: number, rooms: StayRoom[], guests: StayGuest[], by: SplitBy): StayItem[] {
  const occupied = roomsWithGuests(rooms, guests).filter((r) => r.people.length > 0);
  if (occupied.length === 0 || totalMinor <= 0) return [];
  const weights = occupied.map((r) => weightUnits(r.size_weight) * (by === 'person' ? r.people.length : 1));
  const parts = allocate(totalMinor, weights);
  return occupied.map((r, i) => ({ name: r.name, minor: parts[i], people: r.people }));
}

/** What each person pays for these items, exactly as the bill form will compute it. */
export function stayShares(items: StayItem[]): PersonShare[] {
  if (items.length === 0) return [];
  const result = computeSplit({
    mode: 'itemized',
    items: items.map((it) => ({ name: it.name, lineTotalMinor: it.minor, shares: it.people.map((userId) => ({ userId, weight: 1 })) })),
  });
  return result.shares;
}

/** The bill form's pre-fill: a title and items with their people (sent as one URL parameter). */
export type BillPrefill = { title: string; items: { name: string; minor: number; people: string[] }[]; stayId?: string };

export function encodePrefill(p: BillPrefill): string {
  return JSON.stringify(p);
}

/** Reads a pre-fill back, dropping anything malformed (it arrives in a URL). */
export function decodePrefill(raw: string | undefined, memberIds: string[]): BillPrefill | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<BillPrefill>;
    const members = new Set(memberIds);
    if (typeof p.title !== 'string' || !Array.isArray(p.items)) return null;
    const items = p.items
      .filter((it) => it && typeof it.name === 'string' && Number.isSafeInteger(it.minor) && it.minor > 0 && Array.isArray(it.people))
      .slice(0, 30)
      .map((it) => ({ name: it.name.slice(0, 120), minor: it.minor, people: it.people.filter((u) => typeof u === 'string' && members.has(u)) }))
      .filter((it) => it.people.length > 0);
    if (items.length === 0) return null;
    const stayId = typeof p.stayId === 'string' && /^[0-9a-f-]{36}$/.test(p.stayId) ? p.stayId : undefined;
    return { title: p.title.slice(0, 120), items, stayId };
  } catch {
    return null;
  }
}
