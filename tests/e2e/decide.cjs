/**
 * Deciding together, end to end: a friend who just joined gets a quick start;
 * the organizer asks when everyone can go, both tick their days, and the best
 * dates become the trip dates; bucket-list ideas become a poll, and the
 * winner goes into the plan in two taps.
 *
 * Needs the web app built with EXPO_PUBLIC_AUTH_METHODS=password,guest against
 * a local Supabase with every migration applied.
 *
 *   BASE_URL=http://localhost:8081 SHOTS=./decide-shots node tests/e2e/decide.cjs
 */
const { chromium } = require('playwright');
const { watchCsp } = require('./csp-watch.cjs');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS || 'decide-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0ea' } }] };
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
  await page.getByTestId('signup-password').fill('decide-2026-ok');
  await page.getByTestId('signup-submit').click();
  await page.getByTestId('home-profile').waitFor({ timeout: 20000 });
}
async function tick(page, days) {
  for (const d of days) await page.getByTestId(`day-${d}`).click();
}

(async () => {
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. A friend who just joined gets a quick start');
    const ana = await person(browser);
    await signUp(ana, 'Ana Costa', `ana.decide.${stamp}@example.com`);
    await ana.goto(`${BASE}/trips/new`);
    await ana.getByTestId('trip-name').fill('Porto weekend');
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(ana.url())[1];
    const code = /\/join\/([0-9a-f]{12})/.exec(await ana.locator('body').innerText())[1];
    const ben = await person(browser);
    await signUp(ben, 'Ben Ortiz', `ben.decide.${stamp}@example.com`);
    await ben.goto(`${BASE}/join/${code}`);
    await ben.getByTestId('join-trip').click();
    await ben.getByTestId('welcome-joined').waitFor({ timeout: 20000 });
    expect((await ben.getByTestId('welcome-joined').innerText()).includes('Pause it any time from the map'), 'the welcome explains what’s shared and how to pause');
    await shot(ben, 'welcome');
    await ben.getByTestId('welcome-map').click();
    await ben.waitForURL((u) => u.pathname.endsWith('/map'), { timeout: 10000 });
    ok('one tap to the map');
    await ana.goto(`${BASE}/trip/${tripId}/overview`);
    await ana.getByTestId('trip-overview').waitFor();
    expect((await ana.getByTestId('welcome-joined').count()) === 0, 'the organizer doesn’t get the welcome');

    console.log('2. Ana asks when everyone can go');
    await ana.goto(`${BASE}/trip/${tripId}/settings`);
    await ana.getByTestId('settings-find-dates').click();
    await ana.getByTestId('dates-from').fill(inDays(5));
    await ana.getByTestId('dates-to').fill(inDays(18));
    await ana.getByTestId('dates-length-3').click();
    await ana.getByTestId('dates-ask').click();
    await ana.getByTestId('dates-calendar').waitFor({ timeout: 15000 });
    ok('the calendar opens on the days to choose from');

    console.log('3. Both tick their days');
    await ben.goto(`${BASE}/trip/${tripId}/overview`);
    await ben.getByTestId('dates-card').click();
    await ben.getByTestId('dates-calendar').waitFor({ timeout: 15000 });
    await tick(ben, [inDays(8), inDays(9), inDays(10), inDays(11), inDays(12)]);
    await ben.getByTestId(`day-${inDays(13)}`).click();
    await ben.getByTestId(`day-${inDays(13)}`).click(); // twice: maybe
    await ben.getByTestId('dates-save').click();
    await ben.getByText('Saved. The group sees your days.').waitFor({ timeout: 10000 });
    // Once the saved answers come back, the button settles and the note stays.
    await ben.getByText('Your days are saved').waitFor({ timeout: 10000 });
    expect(await ben.getByText('Saved. The group sees your days.').isVisible(), 'Ben saved his days (one maybe), and the note stays after the refresh');
    await ana.reload();
    await ana.getByTestId('dates-calendar').waitFor({ timeout: 15000 });
    expect((await ana.getByTestId('dates-waiting').innerText()).includes('you'), 'Ana sees she hasn’t answered yet');
    await tick(ana, [inDays(9), inDays(10), inDays(11), inDays(12), inDays(13)]);
    await ana.getByTestId('dates-save').click();
    await ana.getByText('Saved. The group sees your days.').waitFor({ timeout: 10000 });
    const best = await ana.getByTestId('dates-option-0').innerText();
    expect(best.includes('Everyone can go'), `the best dates suit everyone (${best.split('\n')[0]})`);
    await shot(ana, 'best-dates');

    console.log('4. Ana sets the trip dates from the best option');
    await ana.getByTestId('dates-use-0').click();
    await ana.getByText('Trip dates set.').waitFor({ timeout: 10000 });
    await ana.goto(`${BASE}/trip/${tripId}/overview`);
    await ana.getByTestId('trip-overview').waitFor();
    expect((await ana.getByTestId('dates-card').count()) === 0, 'the “tick your days” card goes away once dates are set');
    const header = await ana.getByTestId('trip-overview').innerText();
    expect(!header.includes('No dates yet'), 'the trip shows its dates');

    console.log('5. Bucket-list ideas become a poll');
    for (const idea of ['Port wine cellar', 'Douro boat trip']) {
      await ben.goto(`${BASE}/trip/${tripId}/idea/new`);
      await ben.getByTestId('idea-name').fill(idea);
      await ben.getByTestId('save-idea').click();
      await ben.waitForURL((u) => !u.pathname.endsWith('/idea/new'), { timeout: 15000 });
    }
    await ana.goto(`${BASE}/trip/${tripId}/ideas`);
    await ana.getByTestId('poll-from-ideas').click();
    await ana.getByTestId('poll-idea-Port wine cellar').click();
    await ana.getByTestId('poll-idea-Douro boat trip').click();
    await ana.getByTestId('save-poll').click();
    await ana.waitForURL((u) => !u.pathname.endsWith('/poll/new'), { timeout: 15000 });
    await ben.goto(`${BASE}/trip/${tripId}/polls`);
    const poll = ben.getByTestId('poll-Which should we do?');
    await poll.waitFor({ timeout: 15000 });
    await poll.getByTestId('poll-option-Douro boat trip').click();
    await poll.getByText('✓ Douro boat trip').waitFor({ timeout: 10000 });
    ok('Ben voted for the boat trip');

    console.log('6. The winner goes into the plan in two taps');
    await ana.goto(`${BASE}/trip/${tripId}/polls`);
    const closing = ana.getByTestId('poll-Which should we do?');
    await closing.getByTestId('poll-close').click();
    await closing.getByTestId('poll-add-to-plan-Douro boat trip').click();
    await closing.locator('[data-testid^="poll-plan-day-"]').first().click();
    await closing.getByTestId('poll-in-plan-Douro boat trip').waitFor({ timeout: 15000 });
    ok('tap “Add to the plan”, tap a day: it’s in the plan');
    await shot(ana, 'winner-in-plan');
    await ana.goto(`${BASE}/trip/${tripId}/ideas`);
    await ana.getByText('Douro boat trip').first().waitFor({ timeout: 10000 });
    await ana.goto(`${BASE}/trip/${tripId}/plan`);
    await ana.getByText('Douro boat trip').first().waitFor({ timeout: 15000 });
    ok('the plan has the boat trip');

    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
    csp.assertNone();
    console.log('\nDeciding together: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
