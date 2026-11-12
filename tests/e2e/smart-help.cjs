/**
 * Smarter help, end to end: a clashing stop moves to the next free time in one
 * tap; the packing list suggests things for the weather and the journey; whoever
 * is owed money reminds whoever owes; Tripley Pro drafts a plan from the bucket
 * list, and the picked stops go into the plan. The weather service and the
 * drafting function are answered by the test (no outside calls, no AI).
 *
 * Needs the web app built with EXPO_PUBLIC_AUTH_METHODS=password,guest against
 * a local Supabase with every migration applied, and DATABASE_URL for it.
 *
 *   BASE_URL=http://localhost:8081 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node tests/e2e/smart-help.cjs
 */
const { chromium } = require('playwright');
const { Client } = require('pg');
const { watchCsp } = require('./csp-watch.cjs');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS || 'smart-help-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0ea' } }] };
const inDays = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const START = inDays(5);
const END = inDays(7);

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
const weatherAsked = [];
async function person(browser) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('https://tiles.openfreemap.org/**', (r) => (r.request().url().includes('/styles/') ? r.fulfill({ json: STYLE }) : r.fulfill({ status: 404 })));
  await ctx.route('https://photon.komoot.io/**', (r) => r.fulfill({ json: { type: 'FeatureCollection', features: [] }, headers: { 'access-control-allow-origin': '*' } }));
  await ctx.route('https://api.open-meteo.com/**', (r) => {
    weatherAsked.push(r.request().url());
    r.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: { daily: { temperature_2m_max: [12.2, 13.8, 11.1], temperature_2m_min: [4.1, 2.6, 5.0], precipitation_sum: [0, 6.3, 2.2] } },
    });
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  return page;
}
async function signUp(page, name, email) {
  await page.goto(`${BASE}/sign-up`);
  await page.getByTestId('signup-name').fill(name);
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill('smart-help-2026-ok');
  await page.getByTestId('signup-submit').click();
  await page.getByTestId('home-profile').waitFor({ timeout: 20000 });
}
async function addStop(page, tripId, title, from, to) {
  await page.goto(`${BASE}/trip/${tripId}/plan/new?day=${START}`);
  await page.getByTestId('stop-title').fill(title);
  await page.getByTestId('stop-start').fill(from);
  await page.getByTestId('stop-end').fill(to);
  await page.getByTestId('save-stop').click();
  await page.waitForURL((u) => !u.pathname.endsWith('/plan/new'), { timeout: 15000 });
}

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL for the local database.');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. Ana plans three days in Porto with Ben');
    const ana = await person(browser);
    const anaEmail = `ana.smart.${stamp}@example.com`;
    await signUp(ana, 'Ana Costa', anaEmail);
    await ana.goto(`${BASE}/trips/new`);
    await ana.getByTestId('trip-name').fill('Porto in winter');
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(ana.url())[1];
    const code = /\/join\/([0-9a-f]{12})/.exec(await ana.locator('body').innerText())[1];
    // The destination picked from the search (its map point) and the dates.
    await db.query(`update public.trips set destination = 'Porto, Portugal', destination_lat = 41.1496, destination_lng = -8.611, starts_on = $2, ends_on = $3 where id = $1`, [tripId, START, END]);
    const ben = await person(browser);
    await signUp(ben, 'Ben Ortiz', `ben.smart.${stamp}@example.com`);
    await ben.goto(`${BASE}/join/${code}`);
    await ben.getByTestId('join-trip').click();
    await ben.getByTestId('trip-overview').waitFor({ timeout: 20000 });

    console.log('2. A clash moves to the next free time in one tap');
    await addStop(ana, tripId, 'Livraria Lello', '10:00', '12:00');
    await addStop(ana, tripId, 'Lunch at Majestic', '11:30', '12:30');
    const lunch = (await db.query(`select id from public.itinerary_items where trip_id = $1 and title = 'Lunch at Majestic'`, [tripId])).rows[0].id;
    await ana.goto(`${BASE}/trip/${tripId}/plan/${lunch}`);
    await ana.getByTestId('stop-move-free').waitFor({ timeout: 15000 });
    const moveText = await ana.getByTestId('stop-move-free').innerText();
    expect(moveText.includes('12:00–13:00'), `it suggests 12:00–13:00, after the bookshop (${moveText.trim()})`);
    await ana.getByTestId('stop-move-free').click();
    await ana.getByText('Overlaps with another stop').waitFor({ state: 'detached', timeout: 15000 });
    ok('moved: no clash any more');

    console.log('3. Packing suggestions for the weather and the journey');
    await ana.goto(`${BASE}/trip/${tripId}/bookings`);
    await ana.getByTestId('booking-add').click();
    await ana.getByTestId('booking-title').fill('FR8352 London → Porto');
    await ana.getByTestId('booking-save').click();
    await ana.getByTestId('booking-FR8352 London → Porto').waitFor({ timeout: 15000 });
    await ana.goto(`${BASE}/trip/${tripId}/prepare`);
    await ana.getByTestId('pack-weather').waitFor({ timeout: 15000 });
    await ana.waitForFunction(() => document.querySelector('[data-testid="pack-weather"]')?.innerText.startsWith('Forecast'), null, { timeout: 15000 });
    expect((await ana.getByTestId('pack-weather').innerText()) === 'Forecast: 3–14 °C, rain on 2 of 3 days.', 'the forecast for Porto on the trip’s dates');
    expect(weatherAsked.some((u) => u.includes('latitude=41.150') && u.includes(`start_date=${START}`) && !u.includes('Porto')), 'only the map point and dates were sent');
    for (const want of ['Umbrella or rain jacket', 'Warm coat', 'Hat, gloves and scarf', 'Passport or ID', '3 sets of underwear and socks']) {
      expect((await ana.getByTestId(`pack-suggest-${want}`).count()) === 1, `suggests “${want}”`);
    }
    await ana.getByTestId('pack-suggest-Umbrella or rain jacket').click();
    await ana.getByTestId('task-Umbrella or rain jacket').waitFor({ timeout: 10000 });
    expect((await ana.getByTestId('pack-suggest-Umbrella or rain jacket').count()) === 0, 'one tap adds it, and it’s no longer suggested');
    await shot(ana, 'packing');

    console.log('4. Ana is owed money and reminds Ben');
    await ana.goto(`${BASE}/trip/${tripId}/bill/new`);
    await ana.getByTestId('bill-title').fill('Francesinhas');
    await ana.getByText('Split equally', { exact: true }).click();
    await ana.getByTestId('equal-total').fill('40');
    await ana.getByTestId('save-bill').click();
    await ana.waitForURL((u) => !u.pathname.endsWith('/bill/new'), { timeout: 15000 });
    await ana.goto(`${BASE}/trip/${tripId}/balances`);
    await ana.getByTestId('remind-settle').click();
    await ana.getByText('Reminded one person.').waitFor({ timeout: 10000 });
    await ana.getByTestId('remind-settle').click();
    await ana.getByText('Someone reminded everyone today. Try again tomorrow.').waitFor({ timeout: 10000 });
    ok('once a day');
    await ben.goto(`${BASE}/notifications`);
    await ben.getByText(/Ana Costa is reminding everyone to settle up/).first().waitFor({ timeout: 15000 });
    ok('Ben gets the reminder');
    expect((await ben.goto(`${BASE}/trip/${tripId}/balances`), (await ben.getByTestId('remind-settle').count()) === 0), 'Ben, who owes, has no reminder button');

    console.log('5. Tripley Pro drafts the plan from the bucket list');
    await db.query(
      `update public.accounts set plan = 'pro', plan_expires_at = now() + interval '30 days' where user_id = (select id from auth.users where email = $1)`,
      [anaEmail],
    );
    await ben.goto(`${BASE}/trip/${tripId}/idea/new`);
    await ben.getByTestId('idea-name').fill('Port wine cellar');
    await ben.getByTestId('save-idea').click();
    await ben.waitForURL((u) => !u.pathname.endsWith('/idea/new'), { timeout: 15000 });
    const idea = (await db.query(`select id from public.trip_suggestions where trip_id = $1 and name = 'Port wine cellar'`, [tripId])).rows[0].id;
    let asked = null;
    await ana.route('**/functions/v1/plan-draft', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
      asked = route.request().postDataJSON();
      await route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: {
          scans_left: 59,
          draft: {
            notes: 'Cellars on the second afternoon, close to the river.',
            days: [
              {
                day: inDays(6),
                stops: [
                  { title: 'Ribeira walk', starts_at: '10:00', ends_at: '11:30', place_name: 'Cais da Ribeira', notes: null, suggestion_id: null },
                  { title: 'Port wine cellar', starts_at: '15:00', ends_at: '16:30', place_name: null, notes: 'Book a tasting', suggestion_id: idea },
                  { title: 'Sunset at Jardim do Morro', starts_at: '17:30', ends_at: null, place_name: null, notes: null, suggestion_id: null },
                ],
              },
            ],
          },
        },
      });
    });
    await ana.goto(`${BASE}/trip/${tripId}/plan`);
    await ana.getByTestId('plan-draft').click();
    await ana.getByTestId('plan-draft-pace-relaxed').click();
    await ana.getByTestId('plan-draft-notes').fill('Slow mornings');
    await ana.getByTestId('plan-draft-make').click();
    await ana.getByTestId('plan-draft-add').waitFor({ timeout: 15000 });
    expect(asked && asked.trip_id === tripId && asked.pace === 'relaxed' && asked.notes === 'Slow mornings', 'asked for a relaxed draft with the group’s note');
    await ana.getByTestId('plan-draft-pick-Sunset at Jardim do Morro').click();
    expect((await ana.getByTestId('plan-draft-add').innerText()).includes('Add 2 to the plan'), 'the group picks what goes in');
    await shot(ana, 'draft');
    await ana.getByTestId('plan-draft-add').click();
    await ana.waitForURL((u) => !u.pathname.endsWith('/plan/draft'), { timeout: 15000 });
    const added = (await db.query(`select title, day::text, starts_at::text from public.itinerary_items where trip_id = $1 and day = $2 order by starts_at`, [tripId, inDays(6)])).rows;
    expect(JSON.stringify(added.map((r) => [r.title, r.starts_at])) === JSON.stringify([['Ribeira walk', '10:00:00'], ['Port wine cellar', '15:00:00']]), 'the two picked stops are in the plan, at their times');
    const planned = (await db.query('select itinerary_item_id from public.trip_suggestions where id = $1', [idea])).rows[0].itinerary_item_id;
    expect(!!planned, 'the bucket-list idea is now planned');

    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
    csp.assertNone();
    console.log('\nSmarter help: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await db.end();
  }
})();
