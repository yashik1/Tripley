/**
 * Trip Fun, end to end on the web: add a food find, spin the wheel (the pick
 * shows on the page), complete a scavenger challenge, vote for an award, and
 * a secret mission reaches whoever it's for.
 *
 *   BASE_URL=http://localhost:8081 node tests/e2e/trip-fun.cjs
 */
const { chromium } = require('playwright');
const { watchCsp } = require('./csp-watch.cjs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const stamp = Date.now().toString(36);
const ok = (m) => console.log(`  ✓ ${m}`);
function expect(cond, m) {
  if (!cond) throw new Error(`Expectation failed: ${m}`);
  ok(m);
}
const errors = [];
async function person(browser) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
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
  await page.getByTestId('signup-password').fill('trip-fun-2026-ok');
  await page.getByTestId('signup-submit').click();
  await page.getByTestId('home-profile').waitFor({ timeout: 20000 });
}
const open = async (page, tripId, feature) => {
  await page.goto(`${BASE}/trip/${tripId}/fun`);
  await page.getByText(feature, { exact: true }).click();
};

(async () => {
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. Ana and Ben on a trip');
    const ana = await person(browser);
    await signUp(ana, 'Ana Costa', `ana.fun.${stamp}@example.com`);
    await ana.goto(`${BASE}/trips/new`);
    await ana.getByTestId('trip-name').fill('Lisbon fun');
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(ana.url())[1];
    const code = /\/join\/([0-9a-f]{12})/.exec(await ana.locator('body').innerText())[1];
    const ben = await person(browser);
    await signUp(ben, 'Ben Ortiz', `ben.fun.${stamp}@example.com`);
    await ben.goto(`${BASE}/join/${code}`);
    await ben.getByTestId('join-trip').click();
    await ben.getByTestId('trip-overview').waitFor({ timeout: 20000 });

    console.log('2. Trip Fun from the overview; a food find is shared');
    await ana.goto(`${BASE}/trip/${tripId}/overview`);
    await ana.getByText('Trip Fun', { exact: true }).click();
    await ana.waitForURL((u) => u.pathname.endsWith('/fun'), { timeout: 10000 });
    await ana.getByText('Food Explorer', { exact: true }).click();
    await ana.getByPlaceholder('Dish or place name').fill('Pastel de nata');
    await ana.getByText('Add food find', { exact: true }).last().click();
    await ana.getByText('🍽️ Pastel de nata').waitFor({ timeout: 10000 });
    await open(ben, tripId, 'Food Explorer');
    await ben.getByText('🍽️ Pastel de nata').waitFor({ timeout: 10000 });
    ok('Ben sees Ana’s food find');

    console.log('3. The wheel shows its pick on the page');
    await open(ana, tripId, 'Spin the Adventure Wheel');
    await ana.getByTestId('fun-spin').click();
    const pick = await ana.getByTestId('fun-pick').innerText();
    expect(pick.startsWith('🎡 '), `the pick shows (${pick})`);

    console.log('4. A scavenger challenge, completed');
    await open(ana, tripId, 'Adventure Scavenger Hunt');
    await ana.getByText('＋ Find the best view in the area').click();
    await ana.getByText('🧭 Find the best view in the area').waitFor({ timeout: 10000 });
    await ana.getByText('Mark complete').first().click();
    await ana.getByText('✓ Completed').first().waitFor({ timeout: 10000 });
    ok('marked complete');

    console.log('5. Trip Awards');
    await open(ben, tripId, 'Trip Awards');
    await ben.locator('text="Ana Costa" >> visible=true').first().click();
    await ben.getByText('Your vote is saved. Tap another name to change it.').first().waitFor({ timeout: 10000 });
    ok('Ben voted Ana Food Scout');

    console.log('6. A secret mission reaches whoever it’s for (the database tests check nobody else sees it)');
    await open(ana, tripId, 'Secret Missions');
    await ana.getByPlaceholder('e.g. Get the group to say “wow”').fill('Order for the table in Portuguese');
    await ana.locator('text=/^Ben Ortiz/ >> visible=true').first().click();
    await ana.getByText('Assign mission', { exact: true }).last().click();
    await ana.getByText('🤫 Order for the table in Portuguese').waitFor({ timeout: 10000 });
    await open(ben, tripId, 'Secret Missions');
    await ben.getByText('🤫 Order for the table in Portuguese').waitFor({ timeout: 10000 });
    ok('Ben, who got it, sees it');

    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
    csp.assertNone();
    console.log('\nTrip Fun: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
