import type { DeletionPreview } from './types';

/** "Lisbon, Rome and Goa" */
function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** What deleting the account will do, in plain sentences, from the server's preview. */
export function deletionLines(p: DeletionPreview): string[] {
  const lines: string[] = [];
  if (p.trips_deleted.length) {
    lines.push(
      p.trips_deleted.length === 1
        ? `${p.trips_deleted[0].name} is deleted with everything in it, because you’re the only one on it.`
        : `${names(p.trips_deleted.map((t) => t.name))} are deleted with everything in them, because you’re the only one on them.`,
    );
  }
  for (const t of p.trips_left) {
    lines.push(
      t.new_organizer ? `You leave ${t.name}, and ${t.new_organizer} becomes its organizer.` : `You leave ${t.name}. It stays for everyone else.`,
    );
  }
  lines.push('Your posts, comments, photos, packing lists and shared location are deleted.');
  if (p.trips_left.length) {
    lines.push('Bills and payments you were part of stay in those trips, so your friends’ balances still add up. Your name there becomes “Former member”.');
  }
  lines.push('Your name, sign-in details and payment details are deleted. You won’t be able to log in again.');
  return lines;
}
