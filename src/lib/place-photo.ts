/**
 * A famous photo of a trip's destination, from Wikipedia (the photo itself is
 * on Wikimedia Commons). Only freely licensed photos are used, always with
 * their credit (photographer and licence), which the licence requires.
 *
 * The organizer's device looks it up once and saves it on the trip, so
 * everyone sees the same photo and members' devices never ask Wikipedia.
 */
import { splitDestination } from './trip-fun';

export type PlacePhoto = {
  /** A ~1600 px copy on upload.wikimedia.org. */
  url: string;
  /** The photo's page on Wikimedia Commons (credit and licence). */
  page: string;
  /** "Jane Doe · CC BY-SA 4.0" */
  credit: string;
  /** The destination it was found for. */
  for: string;
};

export const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const UPLOAD = /^https:\/\/upload\.wikimedia\.org\/\S+$/;
const COMMONS_PAGE = /^https:\/\/commons\.wikimedia\.org\/\S+$/;

/** Flags, maps, coats of arms, logos and drawings aren't "a famous picture of the place". */
const NOT_A_PHOTO = /(flag|map|locator|location|coat[ _]of[ _]arms|emblem|seal|logo|icon|symbol|blank|diagram|chart|signature)/i;
export function isPlacePhotoFile(name: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(name) && !NOT_A_PHOTO.test(name);
}

/** Licences that allow showing the photo with a credit. */
export function isFreeLicence(short: string | undefined): boolean {
  return !!short && /^(cc[ -]by|cc[ -]?0|cc[ -]zero|public domain|pd\b|pd-)/i.test(short.trim());
}

/** Plain text from Commons' HTML credit ("<a href…>Jane Doe</a>" → "Jane Doe"), kept short. */
export function plainCredit(html: string | undefined): string {
  const text = (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, '’')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 100 ? `${text.slice(0, 99).trimEnd()}…` : text;
}

/** What to search Wikipedia for: the place's name ("Lisbon" from "Lisbon, Portugal"). */
export function searchTerm(destination: string): string {
  return splitDestination(destination).place.trim();
}

type Fetch = typeof fetch;
const headers = () => ({
  Accept: 'application/json',
  // Wikimedia asks apps to say who they are (no personal data here).
  'Api-User-Agent': `Tripley (https://${process.env.EXPO_PUBLIC_APP_DOMAIN || 'tripley.app'})`,
});

async function getJson(fetchImpl: Fetch, base: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  const res = await fetchImpl(`${base}?${qs.toString()}`, { headers: headers(), signal });
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
  return res.json();
}

type WikiPage = { title?: string; index?: number; pageimage?: string; images?: { title?: string }[] };
type CommonsInfo = {
  thumburl?: string;
  url?: string;
  descriptionurl?: string;
  extmetadata?: Record<string, { value?: string } | undefined>;
};

/** Credit, licence and a sized copy for one Commons file, or null if it can't be used. */
async function commonsPhoto(fetchImpl: Fetch, file: string, destination: string, signal?: AbortSignal): Promise<PlacePhoto | null> {
  const title = file.startsWith('File:') ? file : `File:${file}`;
  const body = (await getJson(
    fetchImpl,
    COMMONS_API,
    { action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1600' },
    signal,
  )) as { query?: { pages?: { imageinfo?: CommonsInfo[] }[] } };
  const info = body.query?.pages?.[0]?.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  const licence = meta.LicenseShortName?.value?.trim();
  if (meta.NonFree?.value?.toString().toLowerCase() === 'true' || !isFreeLicence(licence)) return null;
  const url = info.thumburl ?? info.url ?? '';
  const page = info.descriptionurl ?? '';
  if (!UPLOAD.test(url) || url.length > 1000 || !COMMONS_PAGE.test(page) || page.length > 1000) return null;
  const artist = plainCredit(meta.Artist?.value) || 'Wikimedia Commons';
  return { url, page, credit: `${artist} · ${licence}`.slice(0, 300), for: destination.slice(0, 200) };
}

/**
 * Find a famous, freely licensed photo of a destination: the lead photo of its
 * Wikipedia article, or (when that's a flag or map, as for countries) one of
 * the article's own photos. Null when nothing suitable turns up.
 */
export async function findPlacePhoto(
  destination: string,
  opts: { fetchImpl?: Fetch; signal?: AbortSignal; /** Commons pages to skip ("find another photo"). */ exclude?: string[] } = {},
): Promise<PlacePhoto | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const skip = new Set(opts.exclude ?? []);
  const usable = (p: PlacePhoto | null) => (p && !skip.has(p.page) ? p : null);
  const term = searchTerm(destination);
  if (term.length < 2) return null;
  const found = (await getJson(
    fetchImpl,
    WIKIPEDIA_API,
    {
      action: 'query',
      generator: 'search',
      gsrsearch: term,
      gsrnamespace: '0',
      gsrlimit: '3',
      prop: 'pageimages',
      piprop: 'name',
      pilicense: 'free',
      redirects: '1',
    },
    opts.signal,
  )) as { query?: { pages?: WikiPage[] } };
  const pages = [...(found.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (!pages.length) return null;

  // 1. The lead photo of the best matches.
  for (const p of pages) {
    if (p.pageimage && isPlacePhotoFile(p.pageimage)) {
      const photo = usable(await commonsPhoto(fetchImpl, p.pageimage, destination, opts.signal));
      if (photo) return photo;
    }
  }

  // 2. Otherwise a photo from the top article itself.
  const top = pages[0]?.title;
  if (!top) return null;
  const images = (await getJson(fetchImpl, WIKIPEDIA_API, { action: 'query', titles: top, prop: 'images', imlimit: '50', redirects: '1' }, opts.signal)) as {
    query?: { pages?: WikiPage[] };
  };
  const files = (images.query?.pages?.[0]?.images ?? [])
    .map((i) => (i.title ?? '').replace(/^File:/, ''))
    .filter(isPlacePhotoFile)
    .filter((f) => !skip.has(`https://commons.wikimedia.org/wiki/File:${f.replace(/ /g, '_')}`))
    .slice(0, 4);
  for (const f of files) {
    const photo = usable(await commonsPhoto(fetchImpl, f, destination, opts.signal));
    if (photo) return photo;
  }
  return null;
}

/** The destination photo to show for a trip, or null (none found, or the organizer chose the illustration). */
export function tripPlacePhoto(trip: {
  place_photo_url?: string | null;
  place_photo_page?: string | null;
  place_photo_credit?: string | null;
  place_photo_off?: boolean;
}): { url: string; page: string; credit: string } | null {
  if (trip.place_photo_off || !trip.place_photo_url || !trip.place_photo_page || !trip.place_photo_credit) return null;
  return { url: trip.place_photo_url, page: trip.place_photo_page, credit: trip.place_photo_credit };
}
