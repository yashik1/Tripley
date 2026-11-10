/**
 * Privacy Policy and Terms of Use: reachable signed out from the home page,
 * the log-in and sign-up pages and by direct link, and signed in from the
 * profile; readable on a phone-sized screen.
 *
 * Needs the web app built with EXPO_PUBLIC_AUTH_METHODS=password,guest and no
 * EXPO_PUBLIC_SUPPORT_EMAIL (so the pages show the "until then" contact text).
 *
 *   BASE_URL=http://localhost:8081 SHOTS=./legal-shots node tests/e2e/legal.cjs
 */
const { chromium } = require('playwright');
const { watchCsp } = require('./csp-watch.cjs');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS || 'legal-shots';
fs.mkdirSync(SHOTS, { recursive: true });

let n = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
function expect(cond, msg) {
  if (!cond) throw new Error(`Expectation failed: ${msg}`);
  ok(msg);
}
async function shot(page, name) {
  n += 1;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${String(n).padStart(2, '0')}-${name}.png` });
}
const path = (page) => new URL(page.url()).pathname;

(async () => {
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();

    console.log('Home page footer');
    await page.goto(BASE);
    await page.getByTestId('hero-signup').waitFor({ timeout: 20000 });
    await page.getByTestId('link-privacy').scrollIntoViewIfNeeded();
    await shot(page, 'landing-footer');
    await page.getByTestId('link-privacy').click();
    await page.getByTestId('legal-privacy').waitFor();
    expect(path(page) === '/privacy', 'footer link opens /privacy');
    expect(await page.getByText('The short version').isVisible(), 'privacy page shows the short version first');
    const contact = await page.getByTestId('legal-contact').innerText();
    expect(contact.includes('Contact us') && contact.includes('Open Profile'), 'without a contact address, it points to what you can do in the app');
    expect((await page.title()).includes('Privacy Policy'), 'browser tab is titled Privacy Policy');
    await shot(page, 'privacy');

    await page.getByTestId('legal-other').click();
    await page.getByTestId('legal-terms').waitFor();
    expect(path(page) === '/terms', 'privacy page links to the terms');
    expect(await page.getByText('Bills, balances and payments', { exact: false }).first().isVisible(), 'terms cover bills and payments');
    await shot(page, 'terms');

    console.log('Direct links (what app stores point to)');
    for (const p of ['/privacy', '/terms']) {
      const res = await page.goto(`${BASE}${p}`);
      expect(res.status() === 200, `${p} loads directly (200)`);
      await page.getByTestId(`legal-${p.slice(1)}`).waitFor();
      await csp.checkHeaders(ctx.request, `${BASE}${p}`);
    }
    ok('security headers on both pages');

    console.log('Log in and sign up pages');
    await page.goto(`${BASE}/sign-in`);
    await page.getByTestId('agree-note').waitFor();
    await shot(page, 'sign-in-agree');
    await page.getByTestId('agree-note').getByText('Terms of Use').click();
    await page.getByTestId('legal-terms').waitFor();
    expect(path(page) === '/terms', 'log-in page links to the terms');
    await page.goto(`${BASE}/sign-up`);
    const note = await page.getByTestId('agree-note').innerText();
    expect(note.startsWith('By creating an account, you agree to the Terms of Use'), 'sign-up says what you agree to');
    await page.getByTestId('agree-note').getByText('Privacy Policy').click();
    await page.getByTestId('legal-privacy').waitFor();
    expect(path(page) === '/privacy', 'sign-up page links to the privacy policy');

    console.log('Signed in: profile');
    await page.goto(`${BASE}/sign-in?guest=1`);
    await page.getByTestId('guest-name').fill('Lena');
    await page.getByTestId('guest-continue').click();
    await page.getByTestId('home-profile').waitFor({ timeout: 20000 });
    await page.goto(`${BASE}/profile`);
    await page.getByTestId('data-help').waitFor();
    expect((await page.getByTestId('data-help').innerText()).includes('Privacy Policy'), 'profile explains where to ask for a copy of your data');
    expect(await page.getByTestId('delete-account-open').isVisible(), 'profile has a Delete account button');
    await page.getByTestId('link-privacy').scrollIntoViewIfNeeded();
    await shot(page, 'profile-links');
    await page.getByTestId('link-terms').click();
    await page.getByTestId('legal-terms').waitFor();
    expect(path(page) === '/terms', 'profile links to the terms while signed in');
    await page.goBack();
    await page.getByTestId('data-help').waitFor();
    ok('back returns to the profile');

    console.log('Phone-sized screen, dark mode');
    const phone = await browser.newContext({ viewport: { width: 375, height: 760 }, colorScheme: 'dark', deviceScaleFactor: 2 });
    const mobile = await phone.newPage();
    await mobile.goto(`${BASE}/privacy`);
    await mobile.getByTestId('legal-privacy').waitFor();
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow <= 0, 'no sideways scrolling at 375px');
    await shot(mobile, 'privacy-phone-dark');
    await mobile.getByText('Back to Tripley').click();
    await mobile.getByTestId('hero-signup').waitFor();
    expect(path(mobile) === '/', '“Back to Tripley” goes home when opened directly');

    csp.assertNone();
    console.log('\nLegal pages: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
