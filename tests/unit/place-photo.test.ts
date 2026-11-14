import { describe, expect, it } from 'vitest';

import { findPlacePhoto, isFreeLicence, isPlacePhotoFile, plainCredit, searchTerm, tripPlacePhoto } from '../../src/lib/place-photo';

type Reply = unknown | ((url: URL) => unknown);
/** A fetch that answers Wikipedia and Commons API calls from a table; records what was asked. */
function fakeFetch(routes: { wiki?: (p: URLSearchParams) => unknown; commons?: Record<string, unknown> }) {
  const calls: URL[] = [];
  const impl = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    let body: Reply = { query: { pages: [] } };
    if (url.host === 'en.wikipedia.org') body = routes.wiki?.(url.searchParams) ?? body;
    if (url.host === 'commons.wikimedia.org') {
      const file = (url.searchParams.get('titles') ?? '').replace(/^File:/, '');
      body = { query: { pages: [{ imageinfo: routes.commons?.[file] ? [routes.commons[file]] : undefined }] } };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
}

const info = (file: string, licence = 'CC BY-SA 4.0', artist = '<a href="//commons.wikimedia.org/wiki/User:Jane">Jane Doe</a>') => ({
  thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/1600px-${file}`,
  descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`,
  extmetadata: { LicenseShortName: { value: licence }, Artist: { value: artist } },
});

describe('which files count as a photo of the place', () => {
  it('photos yes; flags, maps, coats of arms and drawings no', () => {
    expect(isPlacePhotoFile('Lisbon_skyline_2023.jpg')).toBe(true);
    expect(isPlacePhotoFile('Torre de Belém.JPEG')).toBe(true);
    for (const f of ['Flag_of_Portugal.svg', 'Flag of Portugal.png', 'Portugal_location_map.jpg', 'Coat_of_arms_of_Lisbon.png', 'Lisbon_logo.png', 'Skyline.svg', 'LocatorMap.jpg']) {
      expect(isPlacePhotoFile(f), f).toBe(false);
    }
  });

  it('only free licences', () => {
    for (const l of ['CC BY-SA 4.0', 'CC BY 2.0', 'CC0', 'Public domain', 'PD-self', 'CC-BY-SA-3.0']) expect(isFreeLicence(l), l).toBe(true);
    for (const l of [undefined, '', 'Fair use', 'All rights reserved', 'Copyrighted free use? no']) expect(isFreeLicence(l), String(l)).toBe(false);
  });

  it('credits are plain text, short', () => {
    expect(plainCredit('<a href="x">Jane &amp; Joe</a> (<span>talk</span>)')).toBe('Jane & Joe ( talk )');
    expect(plainCredit('a'.repeat(150))).toHaveLength(100);
    expect(plainCredit(undefined)).toBe('');
  });

  it('searches for the place, not the country', () => {
    expect(searchTerm('Lisbon, Portugal')).toBe('Lisbon');
    expect(searchTerm('Kyoto, Kyoto Prefecture, Japan')).toBe('Kyoto');
    expect(searchTerm('Iceland')).toBe('Iceland');
  });
});

describe('findPlacePhoto', () => {
  it('a city: the lead photo of its Wikipedia article, with its credit', async () => {
    const f = fakeFetch({
      wiki: (p) => (p.get('generator') === 'search' ? { query: { pages: [{ title: 'Lisbon', index: 1, pageimage: 'Lisbon_montage.jpg' }] } } : undefined),
      commons: { 'Lisbon_montage.jpg': info('Lisbon_montage.jpg') },
    });
    const photo = await findPlacePhoto('Lisbon, Portugal', { fetchImpl: f.impl });
    expect(photo).toEqual({
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Lisbon_montage.jpg/1600px-Lisbon_montage.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:Lisbon_montage.jpg',
      credit: 'Jane Doe · CC BY-SA 4.0',
      for: 'Lisbon, Portugal',
    });
    const search = f.calls[0].searchParams;
    expect([search.get('gsrsearch'), search.get('pilicense'), search.get('origin')]).toEqual(['Lisbon', 'free', '*']);
  });

  it('a country: skips the flag and uses a photo from the article', async () => {
    const f = fakeFetch({
      wiki: (p) =>
        p.get('generator') === 'search'
          ? { query: { pages: [{ title: 'Portugal', index: 1, pageimage: 'Flag_of_Portugal.svg' }] } }
          : { query: { pages: [{ title: 'Portugal', images: [{ title: 'File:Flag_of_Portugal.svg' }, { title: 'File:Portugal_location_map.jpg' }, { title: 'File:Benagil_cave.jpg' }] }] } },
      commons: { 'Benagil_cave.jpg': info('Benagil_cave.jpg', 'CC BY 2.0', 'Ana Photographer') },
    });
    const photo = await findPlacePhoto('Portugal', { fetchImpl: f.impl });
    expect(photo?.page).toBe('https://commons.wikimedia.org/wiki/File:Benagil_cave.jpg');
    expect(photo?.credit).toBe('Ana Photographer · CC BY 2.0');
    expect(f.calls.filter((c) => c.host === 'commons.wikimedia.org').map((c) => c.searchParams.get('titles'))).toEqual(['File:Benagil_cave.jpg']);
  });

  it('refuses photos that aren’t free, or aren’t on Wikimedia', async () => {
    const nonFree = fakeFetch({
      wiki: () => ({ query: { pages: [{ title: 'X', index: 1, pageimage: 'A.jpg', images: [] }] } }),
      commons: { 'A.jpg': info('A.jpg', 'Fair use') },
    });
    expect(await findPlacePhoto('Somewhere', { fetchImpl: nonFree.impl })).toBeNull();
    const elsewhere = fakeFetch({
      wiki: () => ({ query: { pages: [{ title: 'X', index: 1, pageimage: 'B.jpg', images: [] }] } }),
      commons: { 'B.jpg': { ...info('B.jpg'), thumburl: 'https://evil.example/pixel.jpg' } },
    });
    expect(await findPlacePhoto('Somewhere', { fetchImpl: elsewhere.impl })).toBeNull();
    const flagged = fakeFetch({
      wiki: () => ({ query: { pages: [{ title: 'X', index: 1, pageimage: 'C.jpg', images: [] }] } }),
      commons: { 'C.jpg': { ...info('C.jpg'), extmetadata: { LicenseShortName: { value: 'CC BY 4.0' }, NonFree: { value: 'true' } } } },
    });
    expect(await findPlacePhoto('Somewhere', { fetchImpl: flagged.impl })).toBeNull();
  });

  it('“find another photo” skips the ones already shown', async () => {
    const f = fakeFetch({
      wiki: (p) =>
        p.get('generator') === 'search'
          ? { query: { pages: [{ title: 'Lisbon', index: 1, pageimage: 'Lisbon_montage.jpg' }] } }
          : { query: { pages: [{ title: 'Lisbon', images: [{ title: 'File:Lisbon_montage.jpg' }, { title: 'File:Belem tower.jpg' }] }] } },
      commons: { 'Lisbon_montage.jpg': info('Lisbon_montage.jpg'), 'Belem tower.jpg': info('Belem_tower.jpg') },
    });
    const first = await findPlacePhoto('Lisbon', { fetchImpl: f.impl });
    const second = await findPlacePhoto('Lisbon', { fetchImpl: f.impl, exclude: [first!.page] });
    expect(second?.page).toBe('https://commons.wikimedia.org/wiki/File:Belem_tower.jpg');
    expect(await findPlacePhoto('Lisbon', { fetchImpl: f.impl, exclude: [first!.page, second!.page] })).toBeNull();
  });

  it('nothing found, or too short to search: null', async () => {
    const empty = fakeFetch({ wiki: () => ({ query: {} }) });
    expect(await findPlacePhoto('Nowhereville', { fetchImpl: empty.impl })).toBeNull();
    const none = fakeFetch({});
    expect(await findPlacePhoto(' ', { fetchImpl: none.impl })).toBeNull();
    expect(none.calls).toHaveLength(0);
  });

  it('a server error is an error (the caller keeps the illustration)', async () => {
    const failing = (async () => new Response('busy', { status: 503 })) as typeof fetch;
    await expect(findPlacePhoto('Lisbon', { fetchImpl: failing })).rejects.toThrow(/503/);
  });
});

describe('tripPlacePhoto', () => {
  const saved = { place_photo_url: 'https://upload.wikimedia.org/a.jpg', place_photo_page: 'https://commons.wikimedia.org/wiki/File:A.jpg', place_photo_credit: 'Jane · CC0' };
  it('shows the saved photo, unless the organizer chose the illustration or none was found', () => {
    expect(tripPlacePhoto(saved)).toEqual({ url: saved.place_photo_url, page: saved.place_photo_page, credit: 'Jane · CC0' });
    expect(tripPlacePhoto({ ...saved, place_photo_off: true })).toBeNull();
    expect(tripPlacePhoto({ place_photo_url: null })).toBeNull();
  });
});
