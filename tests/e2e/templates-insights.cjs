/**
 * Trip templates and organizer insights, end to end: Ana saves a trip as a
 * template and starts next year's trip from it (plans shifted to the new
 * dates); she sees who's on the map, who owes, and who still has to answer.
 *
 *   BASE_URL=http://localhost:8081 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node tests/e2e/templates-insights.cjs
 */
const { chromium } = require('playwright');
const { Client } = require('pg');
const { watchCsp } = require('./csp-watch.cjs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const stamp = Date.now().toString(36);
const STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0ea' } }] };
const inDays = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ok = (m) => console.log(`  ✓ ${m}`);
function expect(cond, m) {
  if (!cond) throw new Error(`Expectation failed: ${m}`);
  ok(m);
}
const errors = [];
async function person(browser) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('https://tiles.openfreemap.org/**', (r) => (r.request().url().includes('/styles/') ? r.fulfill({ json: STYLE }) : r.fulfill({ status: 404 })));
  await ctx.route('https://photon.komoot.io/**', (r) => r.fulfill({ json: { type: 'FeatureCollection', features: [] }, headers: { 'access-control-allow-origin': '*' } }));
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  return page;
}
async function signUp(page, name, email) {
  await page.goto(`${BASE}/sign-up`);
  await page.getByTestId('signup-name').fill(name);
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill('templates-2026-ok');
  await page.getByTestId('signup-submit').click();
  await page.getByTestId('home-profile').waitFor({ timeout: 20000 });
}

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL for the local database.');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. Ana’s ski week, with Ben');
    const ana = await person(browser);
    await signUp(ana, 'Ana Costa', `ana.tpl.${stamp}@example.com`);
    await ana.goto(`${BASE}/trips/new`);
    await ana.getByTestId('trip-name').fill('Ski week');
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(ana.url())[1];
    const code = /\/join\/([0-9a-f]{12})/.exec(await ana.locator('body').innerText())[1];
    await db.query('update public.trips set starts_on = $2, ends_on = $3 where id = $1', [tripId, inDays(10), inDays(16)]);
    const ben = await person(browser);
    await signUp(ben, 'Ben Ortiz', `ben.tpl.${stamp}@example.com`);
    await ben.goto(`${BASE}/join/${code}`);
    await ben.getByTestId('join-trip').click();
    await ben.getByTestId('trip-overview').waitFor({ timeout: 20000 });
    await ana.goto(`${BASE}/trip/${tripId}/plan/new?day=${inDays(12)}`);
    await ana.getByTestId('stop-title').fill('Fondue night');
    await ana.getByTestId('stop-start').fill('19:30');
    await ana.getByTestId('save-stop').click();
    await ana.waitForURL((u) => !u.pathname.endsWith('/plan/new'), { timeout: 15000 });

    console.log('2. Organizer insights');
    await ana.goto(`${BASE}/trip/${tripId}/settings`);
    await ana.getByTestId('settings-insights').click();
    await ana.getByTestId('insights-sharing').waitFor({ timeout: 15000 });
    const benRow = await ana.getByTestId('insights-Ben Ortiz').innerText();
    expect(benRow.includes('Sharing on · no position yet') && benRow.includes('All square') && benRow.includes('Still to answer: 1 plan'), `Ben: sharing on but no position yet, all square, one plan to answer (${benRow.replace(/\s+/g, ' ')})`);
    await ben.goto(`${BASE}/trip/${tripId}/insights`);
    await ben.getByText('Trip insights are for whoever organizes the trip.').waitFor({ timeout: 15000 });
    ok('only the organizer sees insights');

    console.log('3. Save as a template, then start next year’s trip from it');
    await ana.goto(`${BASE}/trip/${tripId}/settings`);
    await ana.getByTestId('settings-template').click();
    await ana.getByTestId('settings-template-note').waitFor({ timeout: 15000 });
    const note = await ana.getByTestId('settings-template-note').innerText();
    expect(note.startsWith('Saved as a template'), `saved, just for Ana (${note})`);
    await ana.goto(`${BASE}/trips/new`);
    await ana.getByTestId('template-Ski week').click();
    await ana.getByTestId('trip-name').fill('Ski week again');
    await ana.getByTestId('trip-start').fill(inDays(40));
    expect((await ana.getByTestId('trip-end').count()) === 0, 'the template sets the length');
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const newId = /\/trip\/([0-9a-f-]{36})/.exec(ana.url())[1];
    const t = (await db.query('select starts_on::text, ends_on::text from public.trips where id = $1', [newId])).rows[0];
    expect(t.starts_on === inDays(40) && t.ends_on === inDays(46), 'the new trip has the same length');
    const stop = (await db.query('select day::text, starts_at::text from public.itinerary_items where trip_id = $1', [newId])).rows;
    expect(stop.length === 1 && stop[0].day === inDays(42) && stop[0].starts_at === '19:30:00', 'fondue night is on day 3 again, same time');
    const members = (await db.query('select count(*)::int as n from public.trip_members where trip_id = $1', [newId])).rows[0].n;
    expect(members === 1, 'nobody else comes along until invited');

    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
    csp.assertNone();
    console.log('\nTemplates and insights: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await db.end();
  }
})();
