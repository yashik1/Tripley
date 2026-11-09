/**
 * The interactive redesign end to end: onboarding for a new user, destination
 * ideas, joining with a code, the dashboard (featured trip, countdown, real
 * planning progress, reminders, quick actions) and the trip overview.
 * Later phases (feed, bucket list, polls, preparation, passport) add steps.
 *
 * Needs the web app built with EXPO_PUBLIC_AUTH_METHODS=password,guest against a
 * local Supabase with all migrations, served on BASE_URL.
 *
 *   BASE_URL=http://localhost:8081 node tests/e2e/engagement.cjs
 */
const { chromium } = require('playwright');
const { watchCsp } = require('./csp-watch.cjs');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS || 'engagement-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0ea' } }] };
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

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
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, geolocation: { latitude: 38.72, longitude: -9.14 }, permissions: ['geolocation'] });
  await ctx.route('https://tiles.openfreemap.org/**', (r) => (r.request().url().includes('/styles/') ? r.fulfill({ json: STYLE }) : r.fulfill({ status: 404 })));
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.ctx = ctx;
  return page;
}
async function signUp(page, name, email) {
  await page.goto(`${BASE}/sign-up`);
  await page.getByTestId('signup-name').fill(name);
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill('engage-2026-ok');
  await page.getByTestId('signup-submit').click();
}

(async () => {
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. A new user gets a welcoming start');
    const ana = await person(browser);
    await signUp(ana, 'Ana Costa', `ana.engage.${stamp}@example.com`);
    await ana.getByTestId('onboarding').waitFor({ timeout: 20000 });
    expect(await ana.getByText('Plan your first trip together').isVisible(), 'onboarding explains the first steps');
    expect((await ana.getByTestId('new-trip').count()) === 1, 'one clear "create your first trip" button');

    console.log('2. A destination idea pre-fills a new trip');
    await ana.getByText('Explore ideas').click();
    await ana.getByTestId('idea-lisbon').waitFor();
    await shot(ana, 'explore');
    await ana.getByTestId('idea-lisbon').getByText('Plan a Lisbon trip').click();
    await ana.getByTestId('trip-name').waitFor();
    expect((await ana.getByTestId('trip-name').inputValue()) === 'Lisbon trip', 'trip name is filled in');
    expect((await ana.getByTestId('trip-destination').inputValue()) === 'Lisbon, Portugal', 'destination is filled in');
    expect((await ana.locator('body').innerText()).includes('EUR'), 'currency is the euro');
    await ana.getByPlaceholder('YYYY-MM-DD').first().fill(inDays(10));
    await ana.getByPlaceholder('YYYY-MM-DD').nth(1).fill(inDays(13));
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(ana.url())[1];
    const link = /https?:\/\/\S+\/join\/[0-9a-f]{12}/.exec(await ana.locator('body').innerText())?.[0] ?? `${BASE}/join/${/\/join\/([0-9a-f]{12})/.exec(await ana.locator('body').innerText())[1]}`;

    console.log('3. The dashboard features the trip, with real progress');
    await ana.goto(BASE);
    await ana.getByTestId('featured-trip').waitFor({ timeout: 15000 });
    expect((await ana.getByTestId('featured-countdown').innerText()).includes('In 10 days'), 'countdown: in 10 days');
    expect((await ana.getByTestId('featured-progress').innerText()) === '20%', 'planning 20% (only the dates are done)');
    await ana.getByTestId('reminder-invite').waitFor();
    ok('reminder: invite your travel buddies');
    await shot(ana, 'dashboard');

    console.log('4. A friend joins by pasting the link');
    const ben = await person(browser);
    await signUp(ben, 'Ben Ortiz', `ben.engage.${stamp}@example.com`);
    await ben.getByTestId('join-trip-code').waitFor({ timeout: 20000 });
    await ben.getByTestId('join-trip-code').click();
    await ben.getByTestId('join-code-input').fill('not a link');
    await ben.getByTestId('join-code-go').click();
    await ben.getByText(/doesn’t look like a Tripley invite/).waitFor();
    ok('a bad code is explained');
    await ben.getByTestId('join-code-input').fill(link);
    await ben.getByTestId('join-code-go').click();
    await ben.getByText('Lisbon trip').first().waitFor({ timeout: 15000 });
    await ben.getByTestId('join-trip').click();
    await ben.getByTestId('trip-overview').waitFor({ timeout: 20000 });
    ok('Ben joined and landed on the trip overview');

    console.log('5. Progress and reminders follow real changes');
    await ana.getByTestId('quick-activity').click();
    await ana.getByTestId('stop-title').fill('Tram 28');
    await ana.getByTestId('save-stop').click();
    await ana.waitForURL((u) => !u.pathname.endsWith('/plan/new'), { timeout: 15000 });
    ok('added a plan from the dashboard');
    await ana.goto(BASE);
    await ana.getByTestId('featured-trip').waitFor();
    await ana.waitForTimeout(1500);
    expect((await ana.getByTestId('featured-progress').innerText()) === '60%', 'planning 60%: dates, friends and a plan');
    expect((await ana.getByTestId('reminder-invite').count()) === 0, 'the invite reminder is gone once a friend joined');

    console.log('6. The trip overview');
    await ana.getByTestId('open-featured-trip').click();
    await ana.getByTestId('trip-overview').waitFor();
    await ana.getByRole('button', { name: 'See everyone on the trip' }).getByText('2 travellers').waitFor({ timeout: 15000 });
    await ana.getByText('Tram 28', { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 15000 });
    const overview = await ana.locator('body').innerText();
    expect(overview.includes('2 travellers') && overview.includes('Tram 28'), 'shows the group and what’s next');
    expect(overview.includes('Lisbon, Portugal'), 'shows the destination');
    await shot(ana, 'overview');

    csp.assertNone();
    console.log('\nAll engagement checks passed.');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('ENGAGEMENT CHECK FAILED:', e.message);
  process.exit(1);
});
