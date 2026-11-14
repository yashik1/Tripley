/**
 * A famous photo of the destination, end to end on the web. Wikipedia and
 * Wikimedia Commons are answered from saved sample replies (no network), and
 * the photo itself is a local image.
 *   Ana creates "Lisbon, Portugal" (City theme): the cover shows the Lisbon
 *   photo with its credit and the theme's emoji, with a soft backdrop behind
 *   the overview. Ben joins and sees the same photo without asking Wikipedia.
 *   Ana finds another photo, switches it off and on, and changes the
 *   destination to Porto, which gets its own photo.
 *
 *   BASE_URL=http://localhost:8081 node tests/e2e/place-photo.cjs
 */
const fs = require('node:fs');
const { chromium } = require('playwright');
const { watchCsp } = require('./csp-watch.cjs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const stamp = Date.now().toString(36);
const PHOTO_BYTES = fs.readFileSync('assets/images/icon.png');

const ok = (m) => console.log(`  ✓ ${m}`);
function expect(cond, m) {
  if (!cond) throw new Error(`Expectation failed: ${m}`);
  ok(m);
}
const errors = [];

// Sample replies, shaped like the real APIs (formatversion=2).
const LEAD = { Lisbon: 'Lisbon_montage.jpg', Porto: 'Porto_Ribeira.jpg' };
const ARTICLE_IMAGES = { Lisbon: ['File:Flag_of_Portugal.svg', 'File:Lisbon_montage.jpg', 'File:Belem_Tower.jpg'], Porto: ['File:Porto_Ribeira.jpg'] };
const COMMONS = {
  'Lisbon_montage.jpg': ['<a href="//commons.wikimedia.org/wiki/User:Jane">Jane Doe</a>', 'CC BY-SA 4.0'],
  'Belem_Tower.jpg': ['Ana Photographer', 'CC BY 2.0'],
  'Porto_Ribeira.jpg': ['Rui Silva', 'CC0'],
};
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'api-user-agent, accept', 'access-control-allow-methods': 'GET' };
async function wikimedia(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const url = new URL(req.url());
  const p = url.searchParams;
  let body = { query: { pages: [] } };
  if (url.host === 'en.wikipedia.org') {
    if (p.get('generator') === 'search') {
      const title = Object.keys(LEAD).find((k) => k.toLowerCase() === (p.get('gsrsearch') || '').toLowerCase());
      body = title ? { query: { pages: [{ title, index: 1, pageimage: LEAD[title] }] } } : { query: {} };
    } else if (p.get('prop') === 'images') {
      const title = p.get('titles');
      body = { query: { pages: [{ title, images: (ARTICLE_IMAGES[title] || []).map((t) => ({ title: t })) }] } };
    }
  } else if (url.host === 'commons.wikimedia.org') {
    const file = (p.get('titles') || '').replace(/^File:/, '');
    const c = COMMONS[file];
    body = {
      query: {
        pages: [
          {
            imageinfo: c
              ? [
                  {
                    thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/1600px-${file}`,
                    descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`,
                    extmetadata: { Artist: { value: c[0] }, LicenseShortName: { value: c[1] } },
                  },
                ]
              : undefined,
          },
        ],
      },
    };
  }
  return route.fulfill({ status: 200, json: body, headers: cors });
}

async function person(browser) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('https://photon.komoot.io/**', (r) => r.fulfill({ json: { type: 'FeatureCollection', features: [] }, headers: { 'access-control-allow-origin': '*' } }));
  await ctx.route('https://en.wikipedia.org/**', wikimedia);
  await ctx.route('https://commons.wikimedia.org/**', wikimedia);
  await ctx.route('https://upload.wikimedia.org/**', (r) => r.fulfill({ status: 200, body: PHOTO_BYTES, headers: { 'content-type': 'image/png' } }));
  const page = await ctx.newPage();
  page.wikiCalls = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).host;
    if (host === 'en.wikipedia.org' || host === 'commons.wikimedia.org') page.wikiCalls.push(r.url());
  });
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  return page;
}
async function signUp(page, name, email) {
  await page.goto(`${BASE}/sign-up`);
  await page.getByTestId('signup-name').fill(name);
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill('place-photo-2026');
  await page.getByTestId('signup-submit').click();
  await page.getByTestId('home-profile').waitFor({ timeout: 20000 });
}
/** The cover photo's address, once it shows. */
async function coverSrc(page, file) {
  const img = page.getByTestId('cover-place-photo').first().locator('img').first();
  for (let i = 0; i < 60; i++) {
    const src = (await img.getAttribute('src').catch(() => null)) || '';
    if (!file || src.includes(file)) return src;
    await new Promise((r) => setTimeout(r, 250));
  }
  return (await img.getAttribute('src').catch(() => null)) || '';
}
async function status(page, text) {
  await page.getByTestId('place-photo-status').filter({ hasText: text }).waitFor({ timeout: 15000 });
  ok(`settings: “${(await page.getByTestId('place-photo-status').innerText()).trim()}”`);
}

(async () => {
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. Ana plans Lisbon with the City theme');
    const ana = await person(browser);
    await signUp(ana, 'Ana Costa', `ana.place.${stamp}@example.com`);
    await ana.goto(`${BASE}/trips/new`);
    await ana.getByTestId('trip-name').fill('Lisbon break');
    await ana.getByTestId('trip-destination').fill('Lisbon, Portugal');
    await ana.getByTestId('theme-city').click();
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(ana.url())[1];
    const code = /\/join\/([0-9a-f]{12})/.exec(await ana.locator('body').innerText())[1];
    await ana.goto(`${BASE}/trip/${tripId}/overview`);
    await ana.getByTestId('cover-place-photo').first().waitFor({ timeout: 20000 });
    const src = await coverSrc(ana, 'Lisbon_montage.jpg');
    expect(src.startsWith('https://upload.wikimedia.org/') && src.includes('1600px-Lisbon_montage.jpg'), 'the cover shows the famous Lisbon photo, from Wikimedia');
    expect((await ana.getByTestId('cover-credit').first().innerText()).includes('Jane Doe · CC BY-SA 4.0'), 'with the photographer’s credit and licence');
    expect((await ana.getByTestId('trip-overview').innerText()).includes('🏙️'), 'and the City theme’s emoji');
    await ana.getByTestId('place-backdrop').waitFor({ timeout: 5000 });
    ok('a soft copy sits behind the top of the overview');
    expect(ana.wikiCalls.every((u) => /^https:\/\/(en\.wikipedia|commons\.wikimedia)\.org\/w\/api\.php\?/.test(u) && u.includes('origin=*')), 'only Wikipedia’s and Commons’ public APIs were asked');

    console.log('2. The credit opens the photo’s page');
    await ana.evaluate(() => {
      window.__opened = [];
      window.open = (u) => (window.__opened.push(String(u)), null);
    });
    await ana.getByTestId('cover-credit').first().click();
    await ana.waitForTimeout(300);
    const opened = await ana.evaluate(() => window.__opened);
    expect(opened.includes('https://commons.wikimedia.org/wiki/File:Lisbon_montage.jpg'), `it opens on Wikimedia Commons (${opened.join(', ')})`);

    console.log('3. Ben sees the same photo, without asking Wikipedia');
    const ben = await person(browser);
    await signUp(ben, 'Ben Ortiz', `ben.place.${stamp}@example.com`);
    await ben.goto(`${BASE}/join/${code}`);
    await ben.getByTestId('join-trip').click();
    await ben.getByTestId('trip-overview').waitFor({ timeout: 20000 });
    expect((await coverSrc(ben, 'Lisbon_montage.jpg')).includes('1600px-Lisbon_montage.jpg'), 'Ben’s cover is the same photo');
    expect(ben.wikiCalls.length === 0, `Ben’s browser made no Wikipedia calls (${ben.wikiCalls.length})`);

    console.log('4. Another photo, off and on again');
    await ana.goto(`${BASE}/trip/${tripId}/settings`);
    await status(ana, 'Jane Doe');
    await ana.getByTestId('place-photo-another').click();
    await status(ana, 'Ana Photographer · CC BY 2.0');
    await ana.getByTestId('place-photo-switch').click();
    await status(ana, 'the illustration shows instead');
    await ana.goto(`${BASE}/trip/${tripId}/overview`);
    await ana.getByTestId('cover-theme-city').first().waitFor({ timeout: 15000 });
    expect((await ana.getByTestId('cover-place-photo').count()) === 0 && (await ana.getByTestId('place-backdrop').count()) === 0, 'off: the City scene is back, with no backdrop');
    await ana.goto(`${BASE}/trip/${tripId}/settings`);
    await ana.getByTestId('place-photo-switch').click();
    await status(ana, 'Ana Photographer');

    console.log('5. A new destination gets its own photo');
    await ana.getByTestId('settings-destination').fill('Porto, Portugal');
    await ana.getByTestId('settings-save').click();
    await status(ana, 'Rui Silva · CC0');
    await ana.goto(`${BASE}/trip/${tripId}/overview`);
    expect((await coverSrc(ana, 'Porto_Ribeira.jpg')).includes('1600px-Porto_Ribeira.jpg'), 'the cover is now Porto');

    console.log('6. Nothing found: the illustration stays');
    await ana.goto(`${BASE}/trip/${tripId}/settings`);
    await ana.getByTestId('settings-destination').fill('Nowhereville');
    await ana.getByTestId('settings-save').click();
    await status(ana, 'No free photo found');
    await ana.goto(`${BASE}/trip/${tripId}/overview`);
    await ana.getByTestId('cover-theme-city').first().waitFor({ timeout: 15000 });
    ok('the City scene shows');

    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
    csp.assertNone();
    console.log('\nDestination photos: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
