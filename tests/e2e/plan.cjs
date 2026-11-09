/**
 * The shared plan end to end: two people in Lisbon add stops, see a clash,
 * say who's going, comment, see stops on the map, and read the plan offline.
 * Only the person who added a stop (or the organizer) can edit it.
 *
 * Needs the web app built with EXPO_PUBLIC_AUTH_METHODS=password,guest against a
 * local Supabase with all migrations, served on BASE_URL.
 *
 *   BASE_URL=http://localhost:8081 node tests/e2e/plan.cjs
 */
const { chromium } = require('playwright');
const { watchCsp } = require('./csp-watch.cjs');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS || 'plan-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const museum = { latitude: 38.7246, longitude: -9.1136 };
const STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f2efe9' } }] };

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
async function person(browser) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2, geolocation: museum, permissions: ['geolocation'] });
  await ctx.route('https://tiles.openfreemap.org/**', (r) =>
    r.request().url().includes('/styles/') ? r.fulfill({ json: STYLE }) : r.fulfill({ status: 404 }),
  );
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.ctx = ctx;
  return page;
}
async function signUp(page, name, email) {
  await page.getByTestId('signup-name').fill(name);
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill('lisbon-plan-2026');
  await page.getByTestId('signup-submit').click();
}
async function addStop(page, tripId, f) {
  await page.goto(`${BASE}/trip/${tripId}/plan`);
  await page.getByTestId('add-stop').click();
  await page.getByTestId('stop-title').fill(f.title);
  if (f.start) await page.getByTestId('stop-start').fill(f.start);
  if (f.end) await page.getByTestId('stop-end').fill(f.end);
  if (f.place) await page.getByTestId('stop-place').fill(f.place);
  if (f.here) {
    // Emulated GPS only reports a fix when it changes; a phone reports them continuously.
    await page.ctx.setGeolocation({ latitude: museum.latitude + 0.00001, longitude: museum.longitude });
    await page.getByTestId('stop-here').click({ timeout: 10000 });
  }
  await page.getByTestId('save-stop').click();
  await page.getByTestId(`stop-${f.title}`).waitFor({ timeout: 15000 });
}

(async () => {
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. Ana starts a Lisbon trip; Ben joins');
    const ana = await person(browser);
    await ana.goto(`${BASE}/sign-up`);
    await signUp(ana, 'Ana Costa', `ana.plan.${stamp}@example.com`);
    await ana.getByTestId('new-trip').click({ timeout: 20000 });
    await ana.getByTestId('trip-name').fill('Lisbon');
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const code = /\/join\/([0-9a-f]{12})/.exec(await ana.locator('body').innerText())[1];
    const ben = await person(browser);
    await ben.goto(`${BASE}/join/${code}`);
    await ben.getByTestId('join-signup').click();
    await signUp(ben, 'Ben Ortiz', `ben.plan.${stamp}@example.com`);
    await ben.getByTestId('trip-overview').waitFor({ timeout: 20000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(ben.url())[1];

    console.log('2. An empty plan explains itself; Ana adds the museum');
    await ana.goto(`${BASE}/trip/${tripId}/plan`);
    await ana.getByText('Plan the trip together').waitFor({ timeout: 15000 });
    expect(true, 'empty plan shows a helpful start');
    await shot(ana, 'plan-empty');
    await addStop(ana, tripId, { title: 'Tile museum', start: '10:00', end: '12:00', place: 'Museu do Azulejo', here: true });
    ok('Ana’s stop is on the plan');

    console.log('3. Ben adds lunch that overlaps; both see the clash');
    await ben.getByTestId('add-stop').waitFor().catch(() => undefined);
    await addStop(ben, tripId, { title: 'Lunch', start: '11:30', end: '13:00', place: 'Time Out Market' });
    await ben.getByTestId('stop-Lunch').getByTestId('stop-clash').waitFor();
    expect((await ben.getByTestId('stop-Lunch').innerText()).includes('Overlaps with Tile museum'), 'Ben sees lunch overlaps the museum');
    await ana.goto(`${BASE}/trip/${tripId}/plan`);
    await ana.getByTestId('stop-Tile museum').getByTestId('stop-clash').waitFor({ timeout: 15000 });
    ok('Ana sees it too, live');
    const order = await ana.locator('[data-testid^="stop-"][data-testid$="museum"], [data-testid="stop-Lunch"]').allInnerTexts();
    expect(order[0].includes('Tile museum') && order[1].includes('Lunch'), 'stops are in time order');
    await shot(ana, 'plan-clash');

    console.log('4. Who’s going');
    await ben.goto(`${BASE}/trip/${tripId}/plan`);
    await ben.getByTestId('stop-Tile museum').getByTestId('rsvp-going').click();
    await ben.waitForTimeout(800);
    await ana.getByTestId('stop-Tile museum').click();
    await ana.getByTestId('stop-heading').waitFor();
    await ana.getByText(/Going: Ben/).waitFor({ timeout: 15000 });
    ok('Ana sees Ben is going to the museum');
    await shot(ana, 'stop-detail');

    console.log('5. Only who added a stop (or the organizer) edits it');
    expect((await ana.getByTestId('stop-edit').count()) === 1, 'Ana can edit her stop');
    await ben.getByTestId('stop-Tile museum').click();
    await ben.getByTestId('stop-heading').waitFor();
    expect((await ben.getByTestId('stop-edit').count()) === 0, 'Ben can’t edit Ana’s stop');

    console.log('6. A comment tells whoever added the stop');
    await ana.goto(`${BASE}/trip/${tripId}/plan`);
    await ana.getByTestId('stop-Lunch').click();
    await ana.getByTestId('stop-comment').fill('Book a table for two?');
    await ana.getByTestId('stop-comment-send').click();
    await ana.getByText('Book a table for two?').waitFor();
    await ben.goto(`${BASE}/notifications`);
    await ben.getByText('Ana Costa on "Lunch": Book a table for two?').waitFor({ timeout: 15000 });
    ok('Ben is told about Ana’s comment on his stop');

    console.log('7. Stops with a map point show on the map');
    await ana.goto(`${BASE}/trip/${tripId}/map`);
    await ana.locator('[data-testid^="map-place-stop:"]').first().waitFor({ timeout: 15000 });
    ok('the museum is on the map as a plan stop');
    await shot(ana, 'map-with-stop');

    console.log('8. The plan still opens with no connection');
    await ben.goto(`${BASE}/trip/${tripId}/plan`);
    await ben.getByTestId('stop-Lunch').waitFor();
    await ben.waitForTimeout(2600); // the offline copy is written every 2 s
    await ben.ctx.setOffline(true);
    await ben.reload();
    await ben.getByTestId('stop-Lunch').waitFor({ timeout: 20000 });
    ok('reloaded offline, the plan is still there');
    await ben.ctx.setOffline(false);

    csp.assertNone();
    console.log('\nAll plan checks passed.');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('PLAN CHECK FAILED:', e.message);
  process.exit(1);
});
