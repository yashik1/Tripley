export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString();
}

/** A dot is "stale" when we haven't heard from someone for a while. */
export function isStale(iso: string | null | undefined, mode: 'live' | 'saver' = 'live', now = Date.now()): boolean {
  if (!iso) return true;
  const limit = mode === 'saver' ? 60 : 10;
  return now - new Date(iso).getTime() > limit * 60_000;
}

export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  return start ? `From ${formatDate(start)}` : `Until ${formatDate(end!)}`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
