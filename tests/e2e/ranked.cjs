/**
 * Ranked polls, end to end: Ana asks the group to rank three places; each
 * person taps them in order and saves; when the poll closes the Borda winner
 * (first choices score most) gets the trophy and can go into the plan.
 *
 *   BASE_URL=http://localhost:8081 node tests/e2e/ranked.cjs
 */
const { chromium } = require('playwright');
const { watchCsp } = require('./csp-watch.cjs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const stamp = Date.now().toString(36);
const STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0ea' } }] };
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
  await page.getByTestId('signup-password').fill('ranked-2026-ok');
  await page.getByTestId('signup-submit').click();
  await page.getByTestId('home-profile').waitFor({ timeout: 20000 });
}
async function rank(page, tripId, labels) {
  await page.goto(`${BASE}/trip/${tripId}/polls`);
  const poll = page.getByTestId('poll-Where first?');
  await poll.waitFor({ timeout: 15000 });
  for (const l of labels) await poll.getByTestId(`poll-option-${l}`).click();
  await poll.getByTestId('poll-rank-save').click();
  await poll.getByTestId('poll-rank-save').waitFor({ state: 'detached', timeout: 10000 });
  return poll;
}

(async () => {
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. Ana asks the group to rank three places');
    const ana = await person(browser);
    await signUp(ana, 'Ana Costa', `ana.ranked.${stamp}@example.com`);
    await ana.goto(`${BASE}/trips/new`);
    await ana.getByTestId('trip-name').fill('Lisbon day trips');
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(ana.url())[1];
    const code = /\/join\/([0-9a-f]{12})/.exec(await ana.locator('body').innerText())[1];
    const ben = await person(browser);
    await signUp(ben, 'Ben Ortiz', `ben.ranked.${stamp}@example.com`);
    await ben.goto(`${BASE}/join/${code}`);
    await ben.getByTestId('join-trip').click();
    await ben.getByTestId('trip-overview').waitFor({ timeout: 20000 });

    await ana.goto(`${BASE}/trip/${tripId}/poll/new`);
    await ana.getByTestId('poll-question').fill('Where first?');
    await ana.getByTestId('poll-opt-0').fill('Sintra');
    await ana.getByTestId('poll-opt-1').fill('Belém');
    await ana.getByTestId('poll-add-option').click();
    await ana.getByTestId('poll-opt-2').fill('Cascais');
    await ana.getByTestId('poll-ranked').click();
    expect((await ana.getByTestId('poll-multiple').count()) === 0, 'a ranked poll isn’t also pick-several');
    await ana.getByTestId('save-poll').click();
    await ana.waitForURL((u) => !u.pathname.endsWith('/poll/new'), { timeout: 15000 });

    console.log('2. Each person taps them in order and saves');
    const anaPoll = await rank(ana, tripId, ['Belém', 'Sintra']);
    expect((await anaPoll.getByTestId('poll-option-Belém').innerText()).includes('1. Belém'), 'Ana’s first choice is numbered 1');
    await rank(ben, tripId, ['Sintra', 'Cascais']);
    ok('Ben ranked too');

    console.log('3. Closed: the Borda winner gets the trophy and can go into the plan');
    await ana.goto(`${BASE}/trip/${tripId}/polls`);
    const closing = ana.getByTestId('poll-Where first?');
    await closing.getByTestId('poll-close').click();
    await closing.getByTestId('poll-add-to-plan-Sintra').waitFor({ timeout: 15000 });
    const sintra = await closing.getByTestId('poll-option-Sintra').innerText();
    expect(sintra.includes('🏆') && sintra.includes('5 pts'), `Sintra wins with 5 points (3 + 2) over Belém’s 3 (${sintra.replace(/\s+/g, ' ').trim()})`);
    expect((await closing.getByTestId('poll-option-Belém').innerText()).includes('3 pts'), 'Belém has 3');

    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
    csp.assertNone();
    console.log('\nRanked polls: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
