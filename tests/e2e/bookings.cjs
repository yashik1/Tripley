/**
 * Bookings and documents, end to end: a shared flight with its code goes into
 * the plan; a private booking stays private; a PDF is shared, opened, kept on
 * the device and opened again with no connection; Tripley Pro reads a
 * confirmation into a booking to check and save (the reading service is
 * answered by the test, so no AI is called).
 *
 * Needs the web app built with EXPO_PUBLIC_AUTH_METHODS=password,guest against
 * a local Supabase with every migration applied, and DATABASE_URL for it (to
 * make one test account Pro).
 *
 *   BASE_URL=http://localhost:8081 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node tests/e2e/bookings.cjs
 */
const { chromium } = require('playwright');
const { Client } = require('pg');
const { watchCsp } = require('./csp-watch.cjs');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS || 'bookings-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0ea' } }] };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const inDays = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  await page.getByTestId('signup-password').fill('bookings-2026-ok');
  await page.getByTestId('signup-submit').click();
  await page.getByTestId('home-profile').waitFor({ timeout: 20000 });
}
async function choosePdf(page, testId, name) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId(testId).click()]);
  await chooser.setFiles({ name, mimeType: 'application/pdf', buffer: PDF });
}

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL for the local database.');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. Ana starts a trip; Ben joins');
    const ana = await person(browser);
    const anaEmail = `ana.bookings.${stamp}@example.com`;
    await signUp(ana, 'Ana Costa', anaEmail);
    // Ana has Tripley Pro (bought elsewhere); Ben doesn't.
    await db.query(
      `update public.accounts set plan = 'pro', plan_expires_at = now() + interval '30 days' where user_id = (select id from auth.users where email = $1)`,
      [anaEmail],
    );
    await ana.goto(`${BASE}/trips/new`);
    await ana.getByTestId('trip-name').fill('Porto weekend');
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(ana.url())[1];
    const code = /\/join\/([0-9a-f]{12})/.exec(await ana.locator('body').innerText())[1];
    const ben = await person(browser);
    await signUp(ben, 'Ben Ortiz', `ben.bookings.${stamp}@example.com`);
    await ben.goto(`${BASE}/join/${code}`);
    await ben.getByTestId('join-trip').click();
    await ben.getByTestId('trip-overview').waitFor({ timeout: 20000 });

    console.log('2. Ana adds the train, with its code, for both of them');
    await ana.goto(`${BASE}/trip/${tripId}/bookings`);
    await ana.getByTestId('booking-add').click();
    await ana.getByTestId('booking-kind-train').click();
    await ana.getByTestId('booking-title').fill('Alfa Pendular to Porto');
    await ana.getByTestId('booking-provider').fill('CP');
    await ana.getByTestId('booking-reference').fill('CP-77Q2');
    await ana.getByTestId('booking-start-day').fill(inDays(10));
    await ana.getByTestId('booking-start-time').fill('09:39');
    await ana.getByTestId('booking-from').fill('Lisboa Santa Apolónia');
    await ana.getByTestId('booking-to').fill('Porto Campanhã');
    await ana.getByTestId('booking-save').click();
    await ana.getByTestId('booking-Alfa Pendular to Porto').waitFor({ timeout: 15000 });
    await ben.goto(`${BASE}/trip/${tripId}/bookings`);
    await ben.getByTestId('booking-ref-Alfa Pendular to Porto').waitFor({ timeout: 15000 });
    expect((await ben.getByText('Tripley Pro can read a confirmation for you.').count()) === 1, 'without Pro, reading a confirmation is offered as Pro');
    expect((await ben.getByTestId('booking-ref-Alfa Pendular to Porto').innerText()) === 'CP-77Q2', 'Ben sees the train and its code');
    expect((await ben.getByTestId('booking-edit-Alfa Pendular to Porto').count()) === 0, 'Ben can’t edit Ana’s booking');

    console.log('3. It goes into the plan in one tap');
    await ben.getByTestId('booking-plan-Alfa Pendular to Porto').click();
    await ben.getByTestId('booking-in-plan-Alfa Pendular to Porto').waitFor({ timeout: 15000 });
    await ben.getByTestId('booking-in-plan-Alfa Pendular to Porto').click();
    await ben.waitForURL((u) => /\/plan\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 15000 });
    await ben.getByText('Alfa Pendular to Porto').filter({ visible: true }).first().waitFor({ timeout: 15000 });
    ok('the train is a stop in the plan, at its time');
    await ben.goto(`${BASE}/trip/${tripId}/bookings`);
    await ben.getByTestId('booking-Alfa Pendular to Porto').waitFor({ timeout: 15000 });

    console.log('4. Ben’s own flight home stays private');
    await ben.getByTestId('booking-add').click();
    await ben.getByTestId('booking-title').fill('My flight home');
    await ben.getByTestId('booking-reference').fill('ZX9K2P');
    await ben.getByTestId('booking-private').click();
    await ben.getByTestId('booking-save').click();
    await ben.getByTestId('booking-My flight home').waitFor({ timeout: 15000 });
    expect((await ben.getByTestId('booking-My flight home').innerText()).includes('Only you can see this'), 'Ben sees it marked private');
    await ana.goto(`${BASE}/trip/${tripId}/bookings`);
    await ana.getByTestId('booking-Alfa Pendular to Porto').waitFor({ timeout: 15000 });
    expect((await ana.getByText('My flight home').count()) === 0, 'Ana doesn’t see Ben’s private booking');

    console.log('5. A shared PDF: open it, keep it offline, open it with no signal');
    await choosePdf(ana, 'doc-add', 'Museum_tickets.pdf');
    await ana.getByTestId('doc-Museum tickets').waitFor({ timeout: 15000 });
    await ben.reload();
    await ben.getByTestId('doc-Museum tickets').waitFor({ timeout: 15000 });
    // Headless Chromium downloads PDFs rather than showing them, so check what the app opens.
    await ben.evaluate(() => {
      window.__opened = [];
      const open = window.open.bind(window);
      window.open = (url, ...rest) => {
        window.__opened.push(String(url));
        return open(url, ...rest);
      };
    });
    const lastOpened = () => ben.evaluate(() => window.__opened[window.__opened.length - 1] ?? '');
    await ben.getByTestId('doc-open-Museum tickets').click();
    await ben.waitForFunction(() => window.__opened.length === 1, null, { timeout: 10000 });
    expect((await lastOpened()).includes('/storage/v1/object/sign/trip-docs/'), 'Ben opens it through a short-lived private link');
    await ben.getByTestId('doc-offline-Museum tickets').click();
    await ben.getByText('✓ On this device').waitFor({ timeout: 15000 });
    await ben.context().setOffline(true);
    await ben.getByTestId('doc-open-Museum tickets').click();
    await ben.waitForFunction(() => window.__opened.length === 2, null, { timeout: 10000 });
    expect((await lastOpened()).startsWith('blob:'), 'with no connection it opens from the device');
    await ben.context().setOffline(false);
    await shot(ben, 'bookings');

    console.log('6. Tripley Pro reads a confirmation into a booking');
    let asked = null;
    await ana.route('**/functions/v1/read-booking', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
      asked = route.request().postDataJSON();
      await route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: {
          scans_left: 59,
          booking: {
            kind: 'stay',
            title: 'Ribeira loft, 2 nights',
            provider: 'Ribeira Lofts',
            reference: 'RB-4410',
            start_day: inDays(10),
            start_time: '15:00',
            end_day: inDays(12),
            end_time: '11:00',
            from_place: 'Ribeira Lofts',
            to_place: null,
            address: 'Cais da Ribeira 22, Porto',
            travellers: ['ANA COSTA', 'BEN ORTIZ'],
            notes: 'Key box code sent the day before.',
          },
        },
      });
    });
    await ana.goto(`${BASE}/trip/${tripId}/bookings`);
    await ana.getByTestId('booking-read-file').waitFor({ timeout: 20000 });
    await choosePdf(ana, 'booking-read-file', 'Ribeira_confirmation.pdf');
    await ana.getByText('Read from your file').waitFor({ timeout: 20000 });
    expect(asked && asked.trip_id === tripId && asked.path.startsWith(`${tripId}/`) && asked.path.endsWith('.pdf'), 'the file was uploaded to the trip first, then read');
    expect((await ana.getByTestId('booking-reference').inputValue()) === 'RB-4410', 'the form is filled in from the confirmation');
    await shot(ana, 'read');
    await ana.getByTestId('booking-save').click();
    await ana.getByTestId('booking-Ribeira loft, 2 nights').waitFor({ timeout: 15000 });
    const card = await ana.getByTestId('booking-Ribeira loft, 2 nights').innerText();
    expect(card.includes('Ribeira confirmation'), 'the confirmation is attached to the booking');
    expect(/For (You, Ben|Ben, You)/.test(card), 'travellers matched to people on the trip');

    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
    csp.assertNone();
    console.log('\nBookings and documents: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await db.end();
  }
})();
