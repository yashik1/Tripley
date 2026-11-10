/**
 * Deleting an account, end to end: Ana organizes a trip with Ben, shares a
 * photo and pays for dinner, then deletes her account from her profile.
 * Her sign-in stops working, her post and photo are gone, the trip passes to
 * Ben, and the bill stays so the balance still adds up. A guest deletes too.
 *
 * Needs the web app built with EXPO_PUBLIC_AUTH_METHODS=password,guest against
 * a local Supabase with every migration applied.
 *
 *   BASE_URL=http://localhost:8081 SHOTS=./delete-shots node tests/e2e/delete-account.cjs
 */
const { chromium } = require('playwright');
const { watchCsp } = require('./csp-watch.cjs');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS || 'delete-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const PW = 'delete-me-2026';
const anaEmail = `ana.del.${stamp}@example.com`;
const benEmail = `ben.del.${stamp}@example.com`;
const STYLE = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dfeee6' } }] };

let n = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
function expect(cond, msg) {
  if (!cond) throw new Error(`Expectation failed: ${msg}`);
  ok(msg);
}
async function shot(page, name) {
  n += 1;
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTS}/${String(n).padStart(2, '0')}-${name}.png` });
}
async function person(browser) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  await ctx.route('https://tiles.openfreemap.org/**', (r) => (r.request().url().includes('/styles/') ? r.fulfill({ json: STYLE }) : r.fulfill({ status: 404 })));
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signUp(page, name, email) {
  await page.goto(`${BASE}/sign-up`);
  await page.getByTestId('signup-name').fill(name);
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill(PW);
  await page.getByTestId('signup-submit').click();
  await page.getByTestId('home-profile').waitFor({ timeout: 20000 });
}
async function newTrip(page, name) {
  await page.goto(`${BASE}/trips/new`);
  await page.getByTestId('trip-name').fill(name);
  await page.getByTestId('create-trip').click();
  await page.getByText('Share the invite link').waitFor({ timeout: 15000 });
  const tripId = /\/trip\/([0-9a-f-]{36})/.exec(page.url())[1];
  const code = /\/join\/([0-9a-f]{12})/.exec(await page.locator('body').innerText())[1];
  return { tripId, link: `${BASE}/join/${code}` };
}
const disabled = async (page, id) => (await page.getByTestId(id).getAttribute('aria-disabled')) === 'true';

(async () => {
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. Ana organizes a trip with Ben, and has one of her own');
    const ana = await person(browser);
    await signUp(ana, 'Ana Costa', anaEmail);
    const { tripId, link } = await newTrip(ana, 'Lisbon trip');
    await newTrip(ana, 'Solo weekend');
    const ben = await person(browser);
    await signUp(ben, 'Ben Ortiz', benEmail);
    await ben.goto(link);
    await ben.getByTestId('join-trip').click();
    await ben.getByTestId('trip-overview').waitFor({ timeout: 20000 });
    ok('Ben joined Lisbon trip');

    console.log('2. Ana shares a photo and pays for dinner');
    await ana.goto(`${BASE}/trip/${tripId}/feed`);
    await ana.getByTestId('compose-photos').click();
    const chooser = ana.waitForEvent('filechooser');
    await ana.getByTestId('post-add-photo').click();
    await (await chooser).setFiles('assets/images/icon.png');
    await ana.locator('img').first().waitFor({ timeout: 15000 });
    await ana.getByTestId('post-body').fill('Sunset over Lisbon');
    await ana.getByTestId('post-submit').click();
    await ana.getByTestId('post-photos').first().waitFor({ timeout: 30000 });
    await ben.goto(`${BASE}/trip/${tripId}/feed`);
    await ben.getByText('Sunset over Lisbon').waitFor({ timeout: 15000 });
    ok('Ben sees Ana’s photo post');
    await ana.goto(`${BASE}/trip/${tripId}/bill/new`);
    await ana.getByTestId('bill-title').fill('Dinner');
    await ana.getByText('Split equally', { exact: true }).click();
    await ana.getByTestId('equal-total').fill('60');
    await ana.getByTestId('save-bill').click();
    await ana.waitForURL((u) => !u.toString().includes('/bill/new'), { timeout: 15000 });
    await ana.goto(`${BASE}/trip/${tripId}/bills`);
    await ana.getByText('Dinner').first().waitFor({ timeout: 15000 });
    ok('Ana paid 60 for dinner, split with Ben');

    console.log('3. Ana opens Delete account and sees exactly what will happen');
    await ana.goto(`${BASE}/profile`);
    await ana.getByTestId('delete-account-open').click();
    await ana.getByTestId('delete-preview').waitFor({ timeout: 15000 });
    const preview = await ana.getByTestId('delete-preview').innerText();
    expect(preview.includes('Solo weekend is deleted with everything in it'), 'her own trip will be deleted');
    expect(preview.includes('You leave Lisbon trip, and Ben Ortiz becomes its organizer.'), 'the shared trip passes to Ben');
    expect(preview.includes('“Former member”'), 'bills stay under “Former member”');
    expect(await ana.getByText('Settle up first').isVisible(), 'reminded to settle up first');
    expect(await disabled(ana, 'delete-account-submit'), 'the delete button is off until she confirms');
    await ana.getByTestId('delete-confirm-input').fill('DELET');
    expect(await disabled(ana, 'delete-account-submit'), 'a typo doesn’t enable it');
    await shot(ana, 'delete-preview');
    await ana.getByTestId('delete-account-cancel').click();
    await ana.getByTestId('delete-account-open').waitFor();
    ok('“Keep my account” goes back without deleting anything');

    console.log('4. She confirms');
    await ana.getByTestId('delete-account-open').click();
    await ana.getByTestId('delete-confirm-input').fill('delete');
    expect(!(await disabled(ana, 'delete-account-submit')), 'typing DELETE (any case) enables the button');
    await ana.getByTestId('delete-account-submit').click();
    await ana.getByTestId('account-deleted').waitFor({ timeout: 30000 });
    await ana.getByTestId('hero-signup').waitFor();
    expect(new URL(ana.url()).pathname === '/', 'she lands on the home page, signed out');
    const device = await ana.evaluate(() => ({
      keys: Object.keys(localStorage),
      all: Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n'),
    }));
    expect(!device.keys.some((k) => /auth-token/.test(k)), 'her sign-in is gone from the device');
    expect(
      !['Lisbon trip', 'Solo weekend', 'Sunset over Lisbon', 'Dinner', anaEmail].some((x) => device.all.includes(x)),
      'none of her trips, posts or bills are left on the device',
    );
    await shot(ana, 'deleted');

    console.log('5. Her sign-in no longer works');
    await ana.goto(`${BASE}/sign-in`);
    await ana.getByTestId('login-email').fill(anaEmail);
    await ana.getByTestId('login-password').fill(PW);
    await ana.getByTestId('login-submit').click();
    await ana.getByText(/Wrong email or password/).waitFor({ timeout: 15000 });
    ok('logging in with the old email and password is refused');

    console.log('6. The trip carries on for Ben');
    await ben.goto(`${BASE}/notifications`);
    await ben.getByText(/now the organizer of this trip/).first().waitFor({ timeout: 15000 });
    ok('Ben is told he’s now the organizer');
    await ben.goto(`${BASE}/trip/${tripId}/feed`);
    await ben.getByTestId('compose-announcement').waitFor({ timeout: 15000 });
    ok('Ben can post announcements, which only the organizer can');
    expect((await ben.getByText('Sunset over Lisbon').count()) === 0, 'Ana’s photo post is gone from the feed');
    await ben.goto(`${BASE}/trip/${tripId}/bills`);
    await ben.getByText('Dinner').first().waitFor({ timeout: 15000 });
    await ben.getByText(/Former member/).first().waitFor({ timeout: 15000 });
    ok('the dinner bill is still there, paid by “Former member”');
    await ben.goto(`${BASE}/trip/${tripId}/balances`);
    await ben.getByText(/Former member/).first().waitFor({ timeout: 15000 });
    expect((await ben.locator('body').innerText()).includes('30'), 'Ben still owes his 30 share');
    await shot(ben, 'ben-balances');
    await ben.goto(`${BASE}/trip/${tripId}/people`);
    await ben.getByText('Ben Ortiz').first().waitFor({ timeout: 15000 });
    expect((await ben.getByText('Ana Costa').count()) === 0, 'Ana is no longer listed on the trip');

    console.log('7. The same email can start again from scratch');
    await signUp(ana, 'Ana Costa', anaEmail);
    await ana.getByTestId('onboarding').waitFor({ timeout: 15000 });
    ok('signing up again gives a brand new, empty account');

    console.log('8. A guest can delete too');
    const gus = await person(browser);
    await gus.goto(`${BASE}/sign-in?guest=1`);
    await gus.getByTestId('guest-name').fill('Gus');
    await gus.getByTestId('guest-continue').click();
    await gus.getByTestId('home-profile').waitFor({ timeout: 20000 });
    await newTrip(gus, 'Guest trip');
    await gus.goto(`${BASE}/delete-account`);
    await gus.getByTestId('delete-preview').waitFor({ timeout: 15000 });
    expect((await gus.getByTestId('delete-preview').innerText()).includes('Guest trip is deleted with everything in it'), 'the guest’s trip will be deleted');
    await gus.getByTestId('delete-confirm-input').fill('DELETE');
    await gus.getByTestId('delete-account-submit').click();
    await gus.getByTestId('account-deleted').waitFor({ timeout: 30000 });
    ok('guest account deleted');

    console.log('9. Signed out, the page isn’t reachable');
    await gus.goto(`${BASE}/delete-account`);
    await gus.waitForTimeout(1500);
    expect(new URL(gus.url()).pathname !== '/delete-account', 'signed-out visitors are sent away from /delete-account');

    csp.assertNone();
    console.log('\nDelete account: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
