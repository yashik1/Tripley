/**
 * Themes, end to end on the web.
 *   Your appearance (Dark) and colour (Berry): applied at once, kept after a
 *   reload, and the same on another device signed in to your account.
 *   A trip theme (Beach): set by the organizer, it gives the trip its own
 *   colours (Ocean, over your Berry) and cover art, and suggests packing,
 *   scavenger-hunt and bucket-list ideas. Others see it but can't change it.
 *
 *   BASE_URL=http://localhost:8081 node tests/e2e/themes.cjs
 */
const { chromium } = require('playwright');
const { watchCsp } = require('./csp-watch.cjs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const stamp = Date.now().toString(36);
const PASSWORD = 'themes-2026-ok';
// Dark mode colours (src/lib/palettes.ts).
const DARK_BG = 'rgb(14, 24, 29)';
const BERRY_DARK = 'rgb(255, 122, 182)';
const OCEAN_DARK = 'rgb(106, 168, 255)';
const LIGHT_BG = 'rgb(247, 248, 245)';

const ok = (m) => console.log(`  ✓ ${m}`);
function expect(cond, m) {
  if (!cond) throw new Error(`Expectation failed: ${m}`);
  ok(m);
}
const errors = [];
async function person(browser) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, colorScheme: 'light' });
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
  await page.getByTestId('signup-password').fill(PASSWORD);
  await page.getByTestId('signup-submit').click();
  await page.getByTestId('home-profile').waitFor({ timeout: 20000 });
}
const bodyBg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const bgOf = (locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor);
async function waitForBg(locator, colour, what) {
  for (let i = 0; i < 50; i++) {
    if ((await bgOf(locator).catch(() => null)) === colour) return ok(what);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Expectation failed: ${what} (background is ${await bgOf(locator).catch(() => '?')}, expected ${colour})`);
}

(async () => {
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. Ana picks Dark and Berry');
    const ana = await person(browser);
    const email = `ana.themes.${stamp}@example.com`;
    await signUp(ana, 'Ana Costa', email);
    expect((await bodyBg(ana)) === LIGHT_BG, 'the app starts light on a light device');
    await ana.goto(`${BASE}/profile`);
    await ana.getByTestId('appearance').waitFor({ timeout: 15000 });
    await ana.getByTestId('appearance-dark').click();
    await ana.getByTestId('palette-berry').click();
    await waitForBg(ana.getByTestId('appearance-dark'), BERRY_DARK, 'buttons and highlights turn Berry');
    expect((await bodyBg(ana)) === DARK_BG, 'the page is dark even though the device is light');

    console.log('2. Kept after a reload, and on another device');
    await ana.reload();
    await ana.getByTestId('appearance').waitFor({ timeout: 15000 });
    await waitForBg(ana.getByTestId('appearance-dark'), BERRY_DARK, 'still Dark and Berry after a reload');
    const other = await person(browser);
    await other.goto(`${BASE}/sign-in`);
    await other.getByTestId('login-email').fill(email);
    await other.getByTestId('login-password').fill(PASSWORD);
    await other.getByTestId('login-submit').click();
    await other.getByTestId('home-profile').waitFor({ timeout: 20000 });
    await other.goto(`${BASE}/profile`);
    await waitForBg(other.getByTestId('appearance-dark'), BERRY_DARK, 'another browser signed in to the account gets Dark and Berry');
    expect((await bodyBg(other)) === DARK_BG, 'and its page is dark too');
    await other.context().close();

    console.log('3. A beach trip: its own colours and cover');
    await ana.goto(`${BASE}/trips/new`);
    await ana.getByTestId('trip-name').fill('Algarve');
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(ana.url())[1];
    const code = /\/join\/([0-9a-f]{12})/.exec(await ana.locator('body').innerText())[1];
    await ana.goto(`${BASE}/trip/${tripId}/settings`);
    await ana.getByTestId('settings-theme').waitFor({ timeout: 15000 });
    await waitForBg(ana.getByTestId('theme-none'), BERRY_DARK, 'before a theme, the trip uses Ana’s colour');
    await ana.getByTestId('theme-beach').click();
    await waitForBg(ana.getByTestId('theme-beach'), OCEAN_DARK, 'Beach: the trip switches to the Ocean colours, over Ana’s Berry');
    await ana.goto(`${BASE}/trip/${tripId}/overview`);
    await ana.getByTestId('cover-theme-beach').first().waitFor({ timeout: 15000 });
    ok('the trip cover shows the beach scene');
    await ana.goto(`${BASE}/profile`);
    await waitForBg(ana.getByTestId('appearance-dark'), BERRY_DARK, 'outside the trip, Ana’s own colour is back');

    console.log('4. Ideas for a beach trip');
    await ana.goto(`${BASE}/trip/${tripId}/prepare`);
    await ana.getByTestId('pack-suggest-Swimwear').waitFor({ timeout: 15000 });
    expect((await ana.getByTestId('pack-suggested').innerText()).includes('Swimwear: beach trip'), 'packing suggests swimwear, because it’s a beach trip');
    await ana.goto(`${BASE}/trip/${tripId}/challenges`);
    await ana.getByTestId('hunt-theme-ideas').waitFor({ timeout: 15000 });
    await ana.getByTestId('challenge-start-Catch the best sunset').waitFor();
    ok('the scavenger hunt suggests beach challenges first');
    await ana.goto(`${BASE}/trip/${tripId}/ideas`);
    await ana.getByTestId('idea-starter-Snorkelling').click();
    await ana.getByTestId('idea-name').waitFor({ timeout: 15000 });
    expect((await ana.getByTestId('idea-name').inputValue()) === 'Snorkelling', 'a bucket-list starter opens the form filled in');
    await waitForBg(ana.getByTestId('idea-cat-experience'), OCEAN_DARK, 'with its category (Experience) chosen');
    expect((await bgOf(ana.getByTestId('idea-cat-food'))) !== OCEAN_DARK, 'and not the default (Food)');

    console.log('5. Ben sees the theme but can’t change it');
    const ben = await person(browser);
    await signUp(ben, 'Ben Ortiz', `ben.themes.${stamp}@example.com`);
    await ben.goto(`${BASE}/join/${code}`);
    await ben.getByTestId('join-trip').click();
    await ben.getByTestId('trip-overview').waitFor({ timeout: 20000 });
    await ben.getByTestId('cover-theme-beach').first().waitFor({ timeout: 15000 });
    ok('Ben sees the beach cover');
    await ben.goto(`${BASE}/trip/${tripId}/settings`);
    await ben.getByTestId('settings-theme-readonly').waitFor({ timeout: 15000 });
    expect((await ben.getByTestId('settings-theme-readonly').innerText()).includes('Beach'), 'Ben sees “Trip theme: Beach”');
    expect((await ben.getByTestId('theme-beach').count()) === 0, 'and has no theme picker');
    expect((await bodyBg(ben)) === LIGHT_BG, 'Ben’s own appearance is untouched (light)');

    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
    csp.assertNone();
    console.log('\nThemes: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
