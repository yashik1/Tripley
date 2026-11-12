/**
 * Invite friends, end to end: Ana shares her link; Ben signs up from it and
 * plans a trip; once Ana is on it with him, both get a month of Pro.
 *
 *   BASE_URL=http://localhost:8081 node tests/e2e/referrals.cjs
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
async function signUp(page, name, email, from = '/sign-up') {
  await page.goto(`${BASE}${from}`);
  if (from !== '/sign-up') {
    // The landing page remembers the friend's code for after signing up.
    await page.waitForFunction(() => localStorage.getItem('tripley.pendingReferral'), null, { timeout: 15000 });
    await page.goto(`${BASE}/sign-up`);
  }
  await page.getByTestId('signup-name').fill(name);
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill('referrals-2026-ok');
  await page.getByTestId('signup-submit').click();
  await page.getByTestId('home-profile').waitFor({ timeout: 20000 });
}

(async () => {
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. Ana gets her invite code');
    const ana = await person(browser);
    await signUp(ana, 'Ana Costa', `ana.ref.${stamp}@example.com`);
    await ana.goto(`${BASE}/profile`);
    await ana.getByTestId('referral-code').waitFor({ timeout: 15000 });
    const code = (await ana.getByTestId('referral-code').innerText()).trim();
    expect(/^[A-HJ-NP-Z2-9]{8}$/.test(code), `a readable code (${code})`);

    console.log('2. Ben opens her link, signs up and plans a trip');
    const ben = await person(browser);
    await signUp(ben, 'Ben Ortiz', `ben.ref.${stamp}@example.com`, `/?ref=${code}`);
    await ben.goto(`${BASE}/trips/new`);
    await ben.getByTestId('trip-name').fill('Ben’s birthday trip');
    await ben.getByTestId('create-trip').click();
    await ben.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const join = /\/join\/([0-9a-f]{12})/.exec(await ben.locator('body').innerText())[1];
    await ben.goto(`${BASE}/profile`);
    await ben.getByTestId('invite-friends').waitFor({ timeout: 15000 });
    expect((await ben.locator('body').innerText()).includes('Free'), 'no reward yet: Ben is alone on his trip');

    console.log('3. Ana joins Ben’s trip: both get a month of Pro');
    await ana.goto(`${BASE}/join/${join}`);
    await ana.getByTestId('join-trip').click();
    await ana.getByTestId('trip-overview').waitFor({ timeout: 20000 });
    for (const [who, page] of [['Ana', ana], ['Ben', ben]]) {
      await page.goto(`${BASE}/profile`);
      await page.getByText(/A gift from inviting friends/).waitFor({ timeout: 20000 });
      ok(`${who} has Tripley Pro for a month`);
    }
    await ana.goto(`${BASE}/notifications`);
    await ana.getByText(/thanks to you\. You both get a month of Pro/).first().waitFor({ timeout: 15000 });
    ok('Ana is told why');

    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
    csp.assertNone();
    console.log('\nInvite friends: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
