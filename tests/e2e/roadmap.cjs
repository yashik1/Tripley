/**
 * Places & arrival alerts, the friend finder, splitting with people who were
 * nearby, locked exchange rates, the cash kitty, regional pay links (SEPA QR),
 * and bills saved offline, end to end with three people in Rome.
 *
 * Needs the web app built with EXPO_PUBLIC_AUTH_METHODS=password,guest against a
 * local Supabase with all migrations, served on BASE_URL. The map style and the
 * exchange-rate API are answered locally (the test has no internet).
 *
 *   BASE_URL=http://localhost:8081 SHOTS=./shots node tests/e2e/roadmap.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS || 'roadmap-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const hotel = { latitude: 41.9, longitude: 12.49 };
const spots = {
  ana: hotel,
  ben: { latitude: 41.90045, longitude: 12.49 }, // ~50 m north of Ana
  cleo: { latitude: 41.918, longitude: 12.49 }, // ~2 km north
};
const STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f2efe9' } }],
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

async function person(browser, who) {
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 900 },
    deviceScaleFactor: 2,
    geolocation: spots[who],
    permissions: ['geolocation'],
  });
  await ctx.route('https://tiles.openfreemap.org/**', (r) =>
    r.request().url().includes('/styles/') ? r.fulfill({ json: STYLE }) : r.fulfill({ status: 404 }),
  );
  await ctx.route('https://api.frankfurter.dev/**', (r) => r.fulfill({ json: { base: 'USD', rates: { EUR: 0.92 } } }));
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.ctx = ctx;
  return page;
}

async function signUp(page, name, email) {
  await page.getByTestId('signup-name').fill(name);
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill('rome-trip-2026');
  await page.getByTestId('signup-submit').click();
}

async function moveTo(page, coords) {
  await page.ctx.setGeolocation(coords);
  await page.waitForTimeout(1500);
}

async function addEqualBill(page, tripId, title, total, opts = {}) {
  await page.goto(`${BASE}/trip/${tripId}/bill/new${opts.kitty ? `?kitty=${opts.kitty}` : ''}`);
  await page.getByTestId('bill-title').fill(title);
  if (opts.currency) {
    await page.getByLabel(/^Currency /).click();
    await page.getByPlaceholder(/Search, or type a code/).fill(opts.currency);
    await page.getByText(new RegExp(`^${opts.currency}  ·  `)).first().click();
    await page.waitForTimeout(500);
  }
  await page.getByText('Split equally', { exact: true }).click();
  await page.getByTestId('equal-total').fill(total);
  if (opts.before) await opts.before();
  await page.getByTestId('save-bill').click();
}

(async () => {
  const browser = await chromium.launch();
  try {
    console.log('1. Ana starts a Rome trip; Ben and Cleo join from the link');
    const ana = await person(browser, 'ana');
    await ana.goto(`${BASE}/sign-up`);
    await signUp(ana, 'Ana Costa', `ana.${stamp}@example.com`);
    await ana.getByTestId('new-trip').click({ timeout: 20000 });
    await ana.getByTestId('trip-name').fill('Rome');
    await ana.getByLabel(/^Currency /).click();
    await ana.getByPlaceholder(/Search, or type a code/).fill('EUR');
    await ana.getByText(/^EUR  ·  /).first().click();
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const code = /\/join\/([0-9a-f]{12})/.exec(await ana.locator('body').innerText())[1];
    const people = { ana };
    for (const [who, name] of [['ben', 'Ben Ortiz'], ['cleo', 'Cleo Park']]) {
      const p = await person(browser, who);
      await p.goto(`${BASE}/join/${code}`);
      await p.getByTestId('join-signup').click();
      await signUp(p, name, `${who}.${stamp}@example.com`);
      await p.getByText("Who's where").waitFor({ timeout: 20000 });
      people[who] = p;
    }
    const { ben, cleo } = people;
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(ben.url())[1];
    await ana.goto(`${BASE}/trip/${tripId}/map`);
    await ana.getByText("Who's where").waitFor();
    const pins = ana.locator('[data-testid^="map-pin-"]');
    for (let i = 0; i < 20 && (await pins.count()) < 3; i++) await ana.waitForTimeout(1000);
    expect((await pins.count()) === 3, 'everyone is on Ana’s map');

    console.log('2. Ana pins the hotel with arrival alerts');
    await ana.getByTestId('pin-place').click();
    await ana.getByText('Tap the map where the place is').waitFor();
    await shot(ana, 'pin-mode');
    await ana.getByTestId('pin-here').click();
    await ana.getByTestId('place-name').fill('Hotel Artemide');
    await ana.getByText('100 m', { exact: true }).click();
    await shot(ana, 'pin-a-place');
    await ana.getByTestId('save-place').click();
    await ana.locator('[data-testid^="map-place-"]').first().waitFor({ timeout: 15000 });
    ok('the hotel is on Ana’s map');
    await ben.locator('[data-testid^="map-place-"]').first().waitFor({ timeout: 15000 });
    ok('and on Ben’s, live');
    await shot(ana, 'map-with-place');

    console.log('3. Ben looks for Ana with the finder');
    const anaId = await ana.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
      return JSON.parse(localStorage.getItem(key)).user.id;
    });
    await ben.goto(`${BASE}/trip/${tripId}/find/${anaId}`);
    await ben.getByTestId('finder-distance').waitFor({ timeout: 15000 });
    const dist = await ben.getByTestId('finder-distance').innerText();
    const dir = await ben.locator('body').innerText();
    expect(/^(40|50|60) m$/.test(dist), `distance shown: ${dist}`);
    expect(/Ana is south of you/.test(dir), 'Ana is south of Ben (no compass on desktop: relative to north)');
    await shot(ben, 'finder');

    console.log('4. Ana logs dinner: only the people who were with her are picked');
    await addEqualBill(ana, tripId, 'Dinner at Roscioli', '30', {
      before: async () => {
        const banner = await ana.getByText('Split between the 2 of you here').isVisible();
        expect(banner, 'banner: split between the 2 of you here (Cleo was 2 km away)');
        await shot(ana, 'nearby-split');
      },
    });
    await ana.waitForURL((u) => !u.toString().includes('/bill/new'), { timeout: 15000 });
    await ana.goto(`${BASE}/trip/${tripId}/bills`);
    await ana.getByText('Dinner at Roscioli').click();
    await ana.getByText('Paid the bill').waitFor();
    const detail = await ana.locator('body').innerText();
    expect(!/Cleo/.test(detail) && /Ben/.test(detail), 'dinner is split between Ana and Ben only');

    console.log('5. A dollar bill locks the exchange rate');
    await addEqualBill(ana, tripId, 'Museum tickets', '40', { currency: 'USD' });
    await ana.waitForURL((u) => !u.toString().includes('/bill/new'), { timeout: 15000 });
    await ana.goto(`${BASE}/trip/${tripId}/bills`);
    await ana.getByText('Museum tickets').click();
    const lock = await ana.getByTestId('fx-lock').innerText();
    expect(/1 USD = 0\.92 EUR · European Central Bank rate · locked/.test(lock), `rate locked: "${lock.replace(/\s+/g, ' ')}"`);
    await shot(ana, 'locked-rate');

    console.log('6. Cleo arrives at the hotel; the others are told');
    await moveTo(cleo, { latitude: 41.9183, longitude: 12.49 }); // still far: first look at the zone
    await moveTo(cleo, { latitude: 41.9002, longitude: 12.4901 }); // ~25 m from the hotel
    let arrived = false;
    for (let i = 0; i < 15 && !arrived; i++) {
      await ben.goto(`${BASE}/notifications`);
      await ben.waitForTimeout(800);
      arrived = /Cleo Park arrived at Hotel Artemide/.test(await ben.locator('body').innerText());
    }
    expect(arrived, 'Ben gets "Cleo Park arrived at Hotel Artemide"');
    await shot(ben, 'arrival-alert');

    console.log('7. A cash kitty: Ben puts in €50, Ana spends €20, then hands it to Ben');
    await ana.goto(`${BASE}/trip/${tripId}/balances`);
    await ana.getByTestId('open-kitty').click();
    await ana.getByTestId('start-kitty').click();
    await ana.getByTestId('kitty-add').click();
    await ana.getByText('Ben', { exact: true }).click();
    await ana.getByTestId('kitty-amount').fill('50');
    await ana.getByTestId('kitty-add-save').click();
    const cashIs = async (page, want) => {
      for (let i = 0; i < 20; i++) {
        if ((await page.getByTestId('kitty-cash').innerText().catch(() => '')) === want) return true;
        await page.waitForTimeout(500);
      }
      return false;
    };
    expect(await cashIs(ana, '€50.00'), 'kitty has €50.00 (Ana recorded Ben’s cash)');
    await ana.getByTestId('kitty-spend').click();
    await ana.getByTestId('bill-title').fill('Taxi to Trastevere');
    await ana.getByText('Split equally', { exact: true }).click();
    await ana.getByTestId('equal-total').fill('20');
    expect(await ana.getByText(/Paid from the kitty: €50.00 in it now/).isVisible(), 'bill form says it’s paid from the kitty');
    await shot(ana, 'kitty-bill');
    await ana.getByTestId('save-bill').click();
    await ana.waitForURL((u) => u.toString().includes('/kitty'), { timeout: 15000 });
    expect(await cashIs(ana, '€30.00'), 'kitty down to €30.00 after the taxi');
    await ana.getByTestId('kitty-handover').click();
    await ana.getByText('Ben', { exact: true }).click();
    await ana.getByTestId('kitty-handover-save').click();
    await ana.getByText('Ben Ortiz is holding the cash').waitFor({ timeout: 10000 });
    await shot(ana, 'kitty');
    await ben.goto(`${BASE}/trip/${tripId}/kitty`);
    await ben.getByText('You’re holding the cash').waitFor({ timeout: 10000 });
    expect(await cashIs(ben, '€30.00'), 'Ben now holds the €30.00');

    console.log('8. Ana adds her IBAN; Cleo pays her with a SEPA QR code');
    await ana.goto(`${BASE}/profile`);
    await ana.getByTestId('handle-iban').fill('DE89 3704 0044 0532 0130 00');
    await ana.getByTestId('handle-iban_name').fill('Ana Costa');
    await ana.getByTestId('save-profile').click();
    await ana.getByText('Saved.').waitFor();
    // Cleo owes Ana her part of the taxi (Ana paid it from the kitty; Cleo was at the hotel by then).
    await cleo.goto(`${BASE}/trip/${tripId}/settle/${anaId}`);
    await cleo.getByTestId('sepa-qr').waitFor({ timeout: 15000 });
    expect(await cleo.getByText(/Bank transfer \(SEPA\)/).isVisible(), 'SEPA bank transfer is offered first for a euro trip');
    await shot(cleo, 'sepa-qr');

    console.log('9. Offline: Ben logs gelato with no signal; it syncs once he’s back');
    await ben.goto(`${BASE}/trip/${tripId}/bills`);
    await ben.getByText('Dinner at Roscioli').waitFor({ timeout: 15000 });
    await ben.waitForTimeout(2500); // let the offline copy and the app shell be saved
    await ben.ctx.setOffline(true);
    await addEqualBill(ben, tripId, 'Gelato', '8');
    await ben.waitForURL((u) => !u.toString().includes('/bill/new'), { timeout: 15000 });
    await ben.goto(`${BASE}/trip/${tripId}/bills`); // still offline: the saved app opens
    await ben.getByTestId('queued-bill').waitFor({ timeout: 15000 });
    expect((await ben.getByTestId('queued-bill').innerText()) === 'Gelato', 'Gelato is saved on Ben’s phone, waiting to sync');
    await shot(ben, 'offline-queued');
    await ben.reload();
    await ben.getByText('Dinner at Roscioli').waitFor({ timeout: 20000 });
    expect(true, 'reloading with no connection still opens the trip and its bills');
    await ben.ctx.setOffline(false);
    await ben.getByTestId('queued-bill').waitFor({ state: 'detached', timeout: 45000 });
    await ben.getByText('Gelato', { exact: true }).waitFor({ timeout: 15000 });
    ok('back online: Gelato synced');
    await ana.goto(`${BASE}/trip/${tripId}/bills`);
    await ana.getByText('Gelato', { exact: true }).waitFor({ timeout: 15000 });
    expect((await ana.getByText('Gelato', { exact: true }).count()) === 1, 'Ana sees it exactly once');
    await shot(ben, 'offline-synced');

    console.log('10. Landing page and installable app');
    const home = await person(browser, 'ana');
    await home.goto(BASE);
    for (const t of ['Arrival alerts and pins', 'Find a lost friend', 'Cash kitty', 'Works offline']) {
      await home.getByText(t).first().waitFor();
    }
    ok('home page lists the new features');
    const manifest = await (await home.request.get(`${BASE}/manifest.json`)).json();
    expect(manifest.short_name === 'Tripley' && manifest.icons.length === 3, 'web app manifest is served');
    expect(!!(await home.locator('link[rel="manifest"]').count()), 'page links the manifest');

    console.log('\nAll roadmap checks passed.');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('ROADMAP CHECK FAILED:', e.message);
  process.exit(1);
});
