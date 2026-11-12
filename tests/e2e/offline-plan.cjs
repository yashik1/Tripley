/**
 * Adding to the plan with no connection: the stop waits on the device, shows
 * as waiting, and is added (once) when the connection is back.
 *
 * Needs the web app built against a local Supabase with every migration
 * applied, and DATABASE_URL for it.
 *
 *   BASE_URL=http://localhost:8081 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node tests/e2e/offline-plan.cjs
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

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL for the local database.');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route('https://tiles.openfreemap.org/**', (r) => (r.request().url().includes('/styles/') ? r.fulfill({ json: STYLE }) : r.fulfill({ status: 404 })));
    await ctx.route('https://photon.komoot.io/**', (r) => r.fulfill({ json: { type: 'FeatureCollection', features: [] }, headers: { 'access-control-allow-origin': '*' } }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));

    console.log('1. Ana plans a trip');
    await page.goto(`${BASE}/sign-up`);
    await page.getByTestId('signup-name').fill('Ana Costa');
    await page.getByTestId('signup-email').fill(`ana.offline.${stamp}@example.com`);
    await page.getByTestId('signup-password').fill('offline-2026-ok');
    await page.getByTestId('signup-submit').click();
    await page.getByTestId('home-profile').waitFor({ timeout: 20000 });
    await page.goto(`${BASE}/trips/new`);
    await page.getByTestId('trip-name').fill('Sintra day');
    await page.getByTestId('create-trip').click();
    await page.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(page.url())[1];
    await db.query('update public.trips set starts_on = $2, ends_on = $3 where id = $1', [tripId, inDays(3), inDays(4)]);
    await page.goto(`${BASE}/trip/${tripId}/plan`);
    await page.getByTestId('add-stop').waitFor({ timeout: 15000 });

    console.log('2. With no connection, a new stop waits on the phone');
    await ctx.setOffline(true);
    await page.getByTestId('add-stop').click();
    await page.getByTestId('stop-title').fill('Pena Palace');
    await page.getByTestId('stop-start').fill('10:00');
    await page.getByTestId('save-stop').click();
    await page.getByTestId('stop-waiting-Pena Palace').waitFor({ timeout: 15000 });
    expect((await page.getByTestId('stop-waiting-Pena Palace').innerText()).includes('Waiting for a connection'), 'it shows as waiting for a connection');
    expect((await db.query('select count(*)::int as n from public.itinerary_items where trip_id = $1', [tripId])).rows[0].n === 0, 'nothing reached the server yet');

    console.log('3. Back online, it’s added once');
    await ctx.setOffline(false);
    await page.getByTestId('stop-waiting-Pena Palace').waitFor({ state: 'detached', timeout: 45000 });
    await page.getByText('Pena Palace').first().waitFor({ timeout: 15000 });
    const rows = (await db.query('select title, starts_at::text, client_id is not null as has_id from public.itinerary_items where trip_id = $1', [tripId])).rows;
    expect(rows.length === 1 && rows[0].starts_at === '10:00:00' && rows[0].has_id, 'the stop is in the plan, exactly once');

    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
    csp.assertNone();
    console.log('\nOffline plan: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await db.end();
  }
})();
