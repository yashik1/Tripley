/**
 * The day's walking route, end to end: Ana pins the hotel and plans a day in
 * a zig-zag (a castle in the east, a 10:00–12:00 museum by the hotel in the
 * west, a 12:30 lunch in the far east, a viewpoint in the middle). The plan
 * shows the walk and suggests a shorter order that keeps the museum before
 * lunch and, since there's no time for sights on the way to lunch, fits them
 * in after it. Ana saves it; it still warns lunch is tight. Ben sees the new
 * order. The walk opens in Google Maps and shows on the trip map.
 *
 * Place search answers are canned (Photon's format). Needs the web app built
 * with EXPO_PUBLIC_AUTH_METHODS=password,guest against a local Supabase.
 *
 *   BASE_URL=http://localhost:8081 SHOTS=./route-shots node tests/e2e/route.cjs
 */
const { chromium } = require('playwright');
const { watchCsp } = require('./csp-watch.cjs');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS || 'route-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0ea' } }] };
const inDays = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// West to east across Lisbon, about 1 km apart; the viewpoint and castle a little north.
const SPOTS = {
  hotel: [-9.1605, 38.71],
  museum: [-9.16, 38.71],
  viewpoint: [-9.1485, 38.716],
  castle: [-9.137, 38.716],
  lunch: [-9.1255, 38.71],
};
const feature = (key, name) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: SPOTS[key] },
  properties: { osm_type: 'N', osm_id: Object.keys(SPOTS).indexOf(key) + 1, osm_key: 'tourism', osm_value: 'attraction', name, city: 'Lisboa', country: 'Portugal', countrycode: 'PT' },
});
const PLACES = {
  castle: [feature('castle', 'Castelo de São Jorge')],
  museum: [feature('museum', 'Museu Nacional do Azulejo')],
  viewpoint: [feature('viewpoint', 'Miradouro da Graça')],
  lunch: [feature('lunch', 'Time Out Market')],
};

let n = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
function expect(cond, m) {
  if (!cond) throw new Error(`Expectation failed: ${m}`);
  ok(m);
}
async function shot(page, name) {
  n += 1;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${String(n).padStart(2, '0')}-${name}.png` });
}
const errors = [];
async function person(browser) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('https://tiles.openfreemap.org/**', (r) => (r.request().url().includes('/styles/') ? r.fulfill({ json: STYLE }) : r.fulfill({ status: 404 })));
  await ctx.route('https://photon.komoot.io/**', (r) => {
    const q = (new URL(r.request().url()).searchParams.get('q') || '').toLowerCase();
    const key = Object.keys(PLACES).find((k) => q.includes(k));
    r.fulfill({ json: { type: 'FeatureCollection', features: key ? PLACES[key] : [] }, headers: { 'access-control-allow-origin': '*' } });
  });
  await ctx.route('https://www.google.com/**', (r) => r.fulfill({ body: 'maps', contentType: 'text/plain' }));
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  page.ctx = ctx;
  return page;
}
async function signUp(page, name, email) {
  await page.goto(`${BASE}/sign-up`);
  await page.getByTestId('signup-name').fill(name);
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill('route-2026-ok');
  await page.getByTestId('signup-submit').click();
  await page.getByTestId('home-profile').waitFor({ timeout: 20000 });
}
async function addStop(page, tripId, day, { title, search, start, end }) {
  await page.goto(`${BASE}/trip/${tripId}/plan/new?day=${day}`);
  await page.getByTestId('stop-title').fill(title);
  if (start) await page.getByTestId('stop-start').fill(start);
  if (end) await page.getByTestId('stop-end').fill(end);
  await page.getByTestId('stop-place').fill(search);
  await page.getByTestId('stop-place-result-0').click();
  await page.getByTestId('save-stop').click();
  await page.waitForURL((u) => !u.pathname.endsWith('/plan/new'), { timeout: 15000 });
}
const stopOrder = (page) =>
  page.locator('[data-testid^="stop-"]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-testid')).filter((id) => /^stop-[A-Z]/.test(id)).map((id) => id.slice(5)),
  );

(async () => {
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    const day = inDays(1);
    console.log('1. Ana plans a zig-zag day');
    const ana = await person(browser);
    await signUp(ana, 'Ana Costa', `ana.route.${stamp}@example.com`);
    await ana.goto(`${BASE}/trips/new`);
    await ana.getByTestId('trip-name').fill('Lisbon long weekend');
    await ana.getByTestId('trip-start').fill(day);
    await ana.getByTestId('trip-end').fill(inDays(3));
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(ana.url())[1];
    const code = /\/join\/([0-9a-f]{12})/.exec(await ana.locator('body').innerText())[1];
    await ana.goto(`${BASE}/trip/${tripId}/place/new?lat=${SPOTS.hotel[1]}&lng=${SPOTS.hotel[0]}`);
    await ana.getByTestId('place-name').fill('Hotel Lisboa');
    await ana.getByTestId('save-place').click();
    await ana.waitForURL((u) => !u.pathname.endsWith('/place/new'), { timeout: 15000 });
    await addStop(ana, tripId, day, { title: 'Castle', search: 'castle' });
    await addStop(ana, tripId, day, { title: 'Tile museum', search: 'museum', start: '10:00', end: '12:00' });
    await addStop(ana, tripId, day, { title: 'Lunch', search: 'lunch', start: '12:30' });
    await addStop(ana, tripId, day, { title: 'Viewpoint', search: 'viewpoint' });

    await ana.goto(`${BASE}/trip/${tripId}/plan`);
    await ana.getByTestId(`plan-day-${day}`).click();
    await ana.getByTestId('route-card').waitFor({ timeout: 15000 });
    expect(JSON.stringify(await stopOrder(ana)) === JSON.stringify(['Castle', 'Tile museum', 'Lunch', 'Viewpoint']), 'the day is in the order it was planned');
    const summary = await ana.getByTestId('route-summary').innerText();
    expect(/km · about/.test(summary), `the walk is measured (${summary})`);
    expect((await ana.getByTestId('route-start-Hotel Lisboa').count()) === 1, 'it starts from the pinned hotel');

    console.log('2. A shorter order that keeps the bookings in time order');
    const suggestion = ana.getByTestId('route-suggestion');
    await suggestion.waitFor();
    expect(/A better order saves \d/.test(await suggestion.innerText()), 'a better order is suggested, with what it saves');
    const steps = [];
    for (let k = 1; k <= 4; k++) steps.push((await ana.getByTestId(`route-step-${k}`).innerText()).replace(/^\d+\.\s*/, ''));
    expect(
      JSON.stringify(steps) === JSON.stringify(['10:00 Tile museum', '12:30 Lunch', 'Castle', 'Viewpoint']),
      `museum first (by the hotel, booked at 10:00), straight to lunch, sights after (${steps.join(' → ')})`,
    );
    await shot(ana, 'route-suggestion');

    console.log('3. Saving it; lunch is still a rush');
    await ana.getByTestId('route-apply').click();
    await ana.getByText(/Saved: the new order saves about/).waitFor({ timeout: 15000 });
    await ana.getByTestId('route-best').waitFor({ timeout: 15000 });
    expect(JSON.stringify(await stopOrder(ana)) === JSON.stringify(['Tile museum', 'Lunch', 'Castle', 'Viewpoint']), 'the plan is saved in the new order');
    const tight = await ana.getByTestId('route-tight').innerText();
    expect(tight.includes('from Tile museum to Lunch, with 30 min'), `lunch is still flagged as tight (${tight})`);
    await shot(ana, 'route-saved');

    console.log('4. Ben sees the new order');
    const ben = await person(browser);
    await signUp(ben, 'Ben Ortiz', `ben.route.${stamp}@example.com`);
    await ben.goto(`${BASE}/join/${code}`);
    await ben.getByTestId('join-trip').click();
    await ben.getByTestId('trip-overview').waitFor({ timeout: 20000 });
    await ben.goto(`${BASE}/trip/${tripId}/plan`);
    await ben.getByTestId(`plan-day-${day}`).click();
    await ben.getByTestId('route-card').waitFor({ timeout: 15000 });
    expect(JSON.stringify(await stopOrder(ben)) === JSON.stringify(['Tile museum', 'Lunch', 'Castle', 'Viewpoint']), 'Ben sees the saved order');
    // Starting from the first stop instead of the hotel changes nothing that matters here, but Ben can try it.
    await ben.getByTestId('route-start-first').click();
    expect((await ben.getByTestId('route-round-trip').count()) === 0, 'no “back to the hotel” without the hotel');

    console.log('5. The walk in Google Maps and on the trip map');
    const popup = ana.ctx.waitForEvent('page');
    await ana.getByTestId('route-open').click();
    const maps = await popup;
    const url = new URL(maps.url());
    expect(url.hostname === 'www.google.com' && url.pathname === '/maps/dir/', 'opens Google Maps directions');
    expect(url.searchParams.get('travelmode') === 'walking', 'walking');
    expect(url.searchParams.get('origin') === url.searchParams.get('destination'), 'from the hotel and back');
    expect((url.searchParams.get('waypoints') || '').split('|').length === 4, 'through all four stops in order');
    await maps.close();
    await ana.getByTestId('route-map').click();
    await ana.getByTestId('map-route-chip').waitFor({ timeout: 15000 });
    const labels = await ana.locator('[data-testid^="map-place-stop:"]').allInnerTexts();
    expect(
      ['1. 10:00 – 12:00 Tile museum', '2. 12:30 Lunch', '3. Castle', '4. Viewpoint'].every((l) => labels.some((x) => x.includes(l))),
      `the map numbers the stops in walking order (${labels.join(' | ')})`,
    );
    await shot(ana, 'route-map');
    await ana.getByTestId('map-route-chip').click();
    await ana.waitForTimeout(500);
    expect((await ana.getByTestId('map-route-chip').count()) === 0, 'the route can be cleared from the map');

    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
    csp.assertNone();
    console.log('\nRoute: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
