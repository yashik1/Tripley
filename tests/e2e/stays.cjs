/**
 * Where everyone sleeps, end to end: the organizer adds a flat with a big and
 * a small room; friends pick their beds (a full room says so); the organizer
 * puts someone in a room; the stay is split by room and saved as a bill that
 * everyone sees in their balances.
 *
 * Needs the web app built with EXPO_PUBLIC_AUTH_METHODS=password,guest against
 * a local Supabase with every migration applied.
 *
 *   BASE_URL=http://localhost:8081 SHOTS=./stays-shots node tests/e2e/stays.cjs
 */
const { chromium } = require('playwright');
const { watchCsp } = require('./csp-watch.cjs');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS || 'stays-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0ea' } }] };

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
  await page.getByTestId('signup-password').fill('stays-2026-ok');
  await page.getByTestId('signup-submit').click();
  await page.getByTestId('home-profile').waitFor({ timeout: 20000 });
}
const roomText = (page, room) => page.getByTestId(`room-${room}`).innerText();

(async () => {
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. Ana starts a trip; Ben and Cleo join');
    const ana = await person(browser);
    await signUp(ana, 'Ana Costa', `ana.stays.${stamp}@example.com`);
    await ana.goto(`${BASE}/trips/new`);
    await ana.getByTestId('trip-name').fill('Lisbon long weekend');
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(ana.url())[1];
    const code = /\/join\/([0-9a-f]{12})/.exec(await ana.locator('body').innerText())[1];
    const ben = await person(browser);
    await signUp(ben, 'Ben Ortiz', `ben.stays.${stamp}@example.com`);
    await ben.goto(`${BASE}/join/${code}`);
    await ben.getByTestId('join-trip').click();
    await ben.getByTestId('trip-overview').waitFor({ timeout: 20000 });
    const cleo = await person(browser);
    await signUp(cleo, 'Cleo Park', `cleo.stays.${stamp}@example.com`);
    await cleo.goto(`${BASE}/join/${code}`);
    await cleo.getByTestId('join-trip').click();
    await cleo.getByTestId('trip-overview').waitFor({ timeout: 20000 });
    ok('three on the trip');

    console.log('2. Ana adds the flat: a big room with 2 beds and a small one with 1');
    await ana.goto(`${BASE}/trip/${tripId}/stays`);
    await ana.getByTestId('stay-add').click();
    await ana.getByTestId('stay-name').fill('Alfama flat');
    await ana.getByTestId('room-name-0').fill('Big room');
    await ana.getByTestId('room-size-0-1.5').click();
    await ana.getByTestId('room-name-1').fill('Small room');
    await ana.getByTestId('room-beds-down-1').click();
    expect((await ana.getByTestId('room-beds-1').innerText()) === '1', 'the small room has one bed');
    await ana.getByTestId('stay-save').click();
    await ana.getByTestId('stay-Alfama flat').waitFor({ timeout: 15000 });
    expect((await roomText(ana, 'Big room')).includes('0/2 beds · Bigger / en-suite'), 'the big room shows its beds and size');

    console.log('3. Friends pick their beds; the overview nudges whoever has none');
    await ben.goto(`${BASE}/trip/${tripId}/overview`);
    await ben.getByText('Pick your bed').waitFor({ timeout: 15000 });
    ok('Ben’s overview says to pick a bed');
    await ben.goto(`${BASE}/trip/${tripId}/stays`);
    await ben.getByTestId('room-pick-Big room').click();
    await ben.getByTestId('room-leave-Big room').waitFor({ timeout: 10000 });
    await cleo.goto(`${BASE}/trip/${tripId}/stays`);
    await cleo.getByTestId('room-pick-Small room').click();
    await cleo.getByTestId('room-leave-Small room').waitFor({ timeout: 10000 });
    await ana.waitForFunction(() => document.querySelector('[data-testid="room-Small room"]')?.innerText.includes('Cleo'), null, { timeout: 15000 });
    expect((await roomText(ana, 'Small room')).includes('1/1 beds'), 'Ana sees Cleo take the small room, live');
    expect((await ana.getByTestId('room-pick-Small room').count()) === 0, 'a full room offers no bed');
    await shot(cleo, 'rooms');

    console.log('4. Ana puts herself in the big room with Ben');
    await ana.getByTestId('room-pick-Big room').click();
    await ana.getByTestId('room-leave-Big room').waitFor({ timeout: 10000 });
    expect((await ana.getByTestId('stay-nobed-Alfama flat').innerText()) === 'Everyone has a bed.', 'everyone has a bed');

    console.log('5. The stay is split by room and saved as a bill');
    await ana.getByTestId('stay-split-Alfama flat').click();
    await ana.getByTestId('stay-split-total').fill('500');
    await ana.getByTestId('stay-split-preview').waitFor();
    const byRoom = {
      ana: await ana.getByTestId('stay-split-share-You').innerText(),
      ben: await ana.getByTestId('stay-split-share-Ben').innerText(),
      cleo: await ana.getByTestId('stay-split-share-Cleo').innerText(),
    };
    expect(/150/.test(byRoom.ana) && /150/.test(byRoom.ben) && /200/.test(byRoom.cleo), `by room: 150 / 150 / 200 (${Object.values(byRoom).join(', ')})`);
    await ana.getByTestId('stay-split-by-person').click();
    const cleoByPerson = await ana.getByTestId('stay-split-share-Cleo').innerText();
    expect(/125/.test(cleoByPerson), `by person: Cleo pays less for the smaller room (${cleoByPerson})`);
    await ana.getByTestId('stay-split-by-room').click();
    await shot(ana, 'split');
    await ana.getByTestId('stay-split-next').click();
    await ana.getByTestId('bill-title').waitFor({ timeout: 10000 });
    expect((await ana.getByTestId('bill-title').inputValue()) === 'Alfama flat', 'the bill is filled in with the stay');
    expect((await ana.getByTestId('item-name-0').inputValue()) === 'Big room', 'one item per room');
    await ana.getByTestId('save-bill').click();
    await ana.getByTestId('stay-bill-Alfama flat').waitFor({ timeout: 20000 });
    ok('saved: back on the rooms, linked to its bill');
    await ana.getByTestId('stay-bill-Alfama flat').click();
    await ana.waitForURL((u) => /\/bill\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 10000 });
    await ana.getByText('Big room').filter({ visible: true }).first().waitFor({ timeout: 10000 });
    ok('the bill shows its rooms');

    console.log('6. Cleo sees what she owes');
    await cleo.goto(`${BASE}/trip/${tripId}/balances`);
    await cleo.waitForFunction(() => /200/.test(document.body.innerText), null, { timeout: 15000 });
    ok('Cleo owes her room’s share');

    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
    csp.assertNone();
    console.log('\nRooms and beds: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
