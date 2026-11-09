/**
 * Screenshots of the main screens for design review (not a pass/fail test):
 * a new user's home, a trip with a plan and a bill, the trip's first screen,
 * the plan and the money tab, on a phone (light and dark) and on desktop.
 *
 *   BASE_URL=http://localhost:8081 SHOTS=./screens node tests/e2e/screens.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS || 'screens';
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0ea' } }] };
const iso = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => iso(new Date(Date.now() + n * 86400000));

async function context(browser, opts) {
  const ctx = await browser.newContext({ geolocation: { latitude: 38.7223, longitude: -9.1393 }, permissions: ['geolocation'], ...opts });
  await ctx.route('https://tiles.openfreemap.org/**', (r) => (r.request().url().includes('/styles/') ? r.fulfill({ json: STYLE }) : r.fulfill({ status: 404 })));
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  return page;
}
const snap = (page, name) => page.waitForTimeout(700).then(() => page.screenshot({ path: `${SHOTS}/${name}.png` }));

(async () => {
  const browser = await chromium.launch();
  try {
    const phone = await context(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await phone.goto(`${BASE}/sign-up`);
    await phone.getByTestId('signup-name').fill('Maya Rao');
    await phone.getByTestId('signup-email').fill(`maya.screens.${stamp}@example.com`);
    await phone.getByTestId('signup-password').fill('screens-2026-ok');
    await phone.getByTestId('signup-submit').click();
    await phone.getByTestId('new-trip').waitFor({ timeout: 20000 });
    await snap(phone, '01-home-new-user');

    await phone.getByTestId('new-trip').click();
    await phone.getByTestId('trip-name').fill('Lisbon long weekend');
    if (await phone.getByTestId('trip-destination').count()) await phone.getByTestId('trip-destination').fill('Lisbon, Portugal');
    await phone.getByPlaceholder('YYYY-MM-DD').first().fill(inDays(24));
    await phone.getByPlaceholder('YYYY-MM-DD').nth(1).fill(inDays(27));
    await phone.getByTestId('create-trip').click();
    await phone.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(phone.url())[1];
    const code = /\/join\/([0-9a-f]{12})/.exec(await phone.locator('body').innerText())[1];

    // A friend joins, so there's a group.
    const friend = await context(browser, { viewport: { width: 390, height: 844 } });
    await friend.goto(`${BASE}/join/${code}`);
    await friend.getByTestId('join-signup').click();
    await friend.getByTestId('signup-name').fill('Sam Okafor');
    await friend.getByTestId('signup-email').fill(`sam.screens.${stamp}@example.com`);
    await friend.getByTestId('signup-password').fill('screens-2026-ok');
    await friend.getByTestId('signup-submit').click();
    await friend.waitForURL(/\/trip\//, { timeout: 20000 });

    // A plan stop and a bill.
    await phone.goto(`${BASE}/trip/${tripId}/plan`);
    await phone.getByTestId('add-stop').click();
    await phone.getByTestId('stop-title').fill('Tile museum');
    await phone.getByTestId('stop-start').fill('10:00');
    await phone.getByTestId('stop-place').fill('Museu do Azulejo');
    await phone.getByTestId(`stop-day-${inDays(25)}`).click();
    await phone.getByTestId('save-stop').click();
    await phone.getByTestId('stop-Tile museum').waitFor({ timeout: 15000 });
    await phone.goto(`${BASE}/trip/${tripId}/bill/new`);
    await phone.getByTestId('bill-title').fill('Welcome dinner');
    await phone.getByText('Split equally', { exact: true }).click();
    await phone.getByTestId('equal-total').fill('84');
    await phone.getByTestId('save-bill').click();
    await phone.waitForTimeout(2500);

    await phone.goto(`${BASE}/`);
    await phone.waitForTimeout(2500);
    await snap(phone, '02-home-with-trip');
    await phone.screenshot({ path: `${SHOTS}/02b-home-with-trip-full.png`, fullPage: true });
    await phone.goto(`${BASE}/trip/${tripId}`);
    await phone.waitForTimeout(3000);
    await snap(phone, '03-trip-first-screen');
    await phone.goto(`${BASE}/trip/${tripId}/plan`);
    await phone.waitForTimeout(2000);
    await snap(phone, '04-trip-plan');
    await phone.goto(`${BASE}/trip/${tripId}/bills`);
    await phone.waitForTimeout(2000);
    await snap(phone, '05-trip-money');

    const dark = await context(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', storageState: await phone.context().storageState() });
    await dark.goto(`${BASE}/`);
    await dark.waitForTimeout(3000);
    await snap(dark, '06-home-dark');
    await dark.goto(`${BASE}/trip/${tripId}`);
    await dark.waitForTimeout(3000);
    await snap(dark, '07-trip-dark');

    const desktop = await context(browser, { viewport: { width: 1280, height: 860 }, storageState: await phone.context().storageState() });
    await desktop.goto(`${BASE}/`);
    await desktop.waitForTimeout(3000);
    await snap(desktop, '08-home-desktop');
    console.log(`Screens saved to ${SHOTS}`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('SCREENS FAILED:', e.message);
  process.exit(1);
});
