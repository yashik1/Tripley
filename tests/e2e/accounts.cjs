/**
 * Accounts end to end: landing page, sign up, log out/in, forgot + reset password
 * (link opened in a different browser), a guest saving their account, joining
 * from an invite by signing up, and a duplicate sign-up.
 *
 * Needs the web app built with EXPO_PUBLIC_AUTH_METHODS=password,guest against a
 * local Supabase (`npx supabase start`), whose mail catcher (Mailpit) is on
 * :54324. Locally the reset email links to the auth server; in production
 * GOTRUE_MAILER_URLPATHS_RECOVERY points it at /reset-password with the same
 * token, so the test opens that page with the token from the email.
 *
 *   BASE_URL=http://localhost:8081 SHOTS=./shots node tests/e2e/accounts.cjs
 */
const { chromium } = require('playwright');
const { watchCsp } = require('./csp-watch.cjs');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS || 'acct-shots';
const MAIL = process.env.MAIL_URL || 'http://127.0.0.1:54324';
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const ana = { name: 'Ana Costa', email: `ana.${stamp}@example.com`, pw: 'lisbon-sunset-24', pw2: 'porto-river-77' };
const gus = { name: 'Gus', email: `gus.${stamp}@example.com`, pw: 'guest-saved-11' };
const ben = { name: 'Ben Ortiz', email: `ben.${stamp}@example.com`, pw: 'ben-joins-123' };

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
async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...opts });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signOut(page) {
  await page.goto(`${BASE}/profile`);
  await page.getByText('Sign out').click();
  await page.getByTestId('hero-signup').waitFor({ timeout: 15000 });
}
async function logIn(page, email, pw) {
  await page.goto(`${BASE}/sign-in`);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(pw);
  await page.getByTestId('login-submit').click();
}
async function latestEmailTo(address) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)).json();
    if (list.messages?.length) return (await fetch(`${MAIL}/api/v1/message/${list.messages[0].ID}`)).json();
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email to ${address}`);
}

(async () => {
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. Landing page explains the app, with sign up and log in');
    const phone = await newPage(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await phone.goto(BASE);
    await phone.getByText('Know where everyone is. Split every bill fairly.').waitFor();
    await shot(phone, 'landing-phone');
    await phone.screenshot({ path: `${SHOTS}/landing-phone-full.png`, fullPage: true });
    const a = await newPage(browser, { deviceScaleFactor: 2 });
    await a.goto(BASE);
    await a.getByText('Everything a group trip needs').waitFor();
    for (const t of ['Live map of your group', 'Split bills item by item', 'Settle up in a tap', 'How it works']) {
      expect(await a.getByText(t).first().isVisible(), `landing shows "${t}"`);
    }
    await shot(a, 'landing-desktop');
    await a.screenshot({ path: `${SHOTS}/landing-desktop-full.png`, fullPage: true });

    console.log('2. Ana signs up with email and password');
    await a.getByTestId('hero-signup').click();
    await a.getByTestId('signup-name').fill(ana.name);
    await a.getByTestId('signup-email').fill(ana.email);
    await a.getByTestId('signup-password').fill('short');
    await a.getByTestId('signup-submit').click();
    await a.getByText('Use at least 8 characters.').waitFor();
    ok('short password is refused with a reason');
    await a.getByTestId('signup-password').fill(ana.pw);
    await shot(a, 'sign-up');
    await a.getByTestId('signup-submit').click();
    await a.getByText('Hi Ana').waitFor({ timeout: 15000 });
    expect(!(await a.getByText('Save your account').count()), 'signed in to trips, no guest warning');
    await a.getByTestId('new-trip').click();
    await a.getByTestId('trip-name').fill('Lisbon long weekend');
    await a.getByTestId('create-trip').click();
    await a.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const code = /\/join\/([0-9a-f]{12})/.exec(await a.locator('body').innerText())?.[1];
    expect(!!code, `trip created with invite ${code}`);

    console.log('3. Log out, wrong password, then log back in');
    await signOut(a);
    await logIn(a, ana.email, 'not-my-password');
    await a.getByText(/Wrong email or password/).waitFor();
    await shot(a, 'log-in-wrong-password');
    ok('wrong password explained');
    await logIn(a, ana.email, ana.pw);
    await a.getByText('Lisbon long weekend').first().waitFor({ timeout: 15000 });
    ok('logged back in and the trip is there');

    console.log('4. Forgot password: link opened in another browser');
    await signOut(a);
    await a.goto(`${BASE}/sign-in`);
    await a.getByTestId('forgot-link').click();
    await a.getByTestId('forgot-email').fill(ana.email);
    await shot(a, 'forgot-password');
    await a.getByTestId('forgot-submit').click();
    await a.getByText('Check your email').waitFor();
    await shot(a, 'forgot-sent');
    const mail = await latestEmailTo(ana.email);
    const link = (mail.Text ?? '').match(/https?:\/\/\S+/)?.[0] ?? '';
    const token = new URL(link).searchParams.get('token') ?? '';
    expect(/^[0-9a-f]{40,}$/.test(token), `reset email has a one-time token, not a same-browser one (${token.slice(0, 8)}…)`);
    // Production points the link at the website's /reset-password; same token.
    const other = await newPage(browser, { deviceScaleFactor: 2 });
    await other.goto(`${BASE}/reset-password?token=${token}&type=recovery`);
    await other.getByText('Choose a new password').waitFor({ timeout: 15000 });
    await other.getByTestId('reset-password').fill(ana.pw2);
    await shot(other, 'reset-password');
    await other.getByTestId('reset-submit').click();
    await other.getByText('Password changed').waitFor();
    await other.getByTestId('reset-done').click();
    await other.getByText('Lisbon long weekend').first().waitFor({ timeout: 15000 });
    ok('new password set from a different browser, signed in to trips');
    await other.goto(`${BASE}/reset-password?token=${token}&type=recovery`);
    // Signed in already, so the used token isn't re-checked here; check it signed out:
    const third = await newPage(browser);
    await third.goto(`${BASE}/reset-password?token=${token}&type=recovery`);
    await third.getByText("This link doesn't work").waitFor({ timeout: 15000 });
    ok('a used reset link is refused');
    await logIn(third, ana.email, ana.pw);
    await third.getByText(/Wrong email or password/).waitFor();
    ok('old password no longer works');
    await logIn(third, ana.email, ana.pw2);
    await third.getByText('Lisbon long weekend').first().waitFor({ timeout: 15000 });
    ok('new password works');

    console.log('5. A guest saves their account and keeps their trip');
    const g = await newPage(browser, { deviceScaleFactor: 2 });
    await g.goto(`${BASE}/sign-in`);
    await g.getByTestId('login-email').waitFor();
    await shot(g, 'log-in');
    await g.getByTestId('open-guest').click();
    await g.getByTestId('guest-name').fill(gus.name);
    await g.getByTestId('guest-continue').click();
    await g.getByTestId('home-save-account').waitFor({ timeout: 15000 });
    await g.getByTestId('new-trip').click();
    await g.getByTestId('trip-name').fill('Gus road trip');
    await g.getByTestId('create-trip').click();
    await g.getByText('Share the invite link').waitFor({ timeout: 15000 });
    await g.goto(BASE);
    await g.getByTestId('home-save-account').waitFor();
    await shot(g, 'guest-home-banner');
    await g.getByTestId('home-save-account').click();
    await g.getByTestId('save-email').fill(gus.email);
    await g.getByTestId('save-password').fill(gus.pw);
    await shot(g, 'guest-save-account');
    await g.getByTestId('save-account').click();
    await g.getByText('Account saved').waitFor({ timeout: 15000 });
    await shot(g, 'guest-saved');
    expect(await g.getByText(gus.email).first().isVisible(), 'profile now shows the email instead of "Guest account"');
    const g2 = await newPage(browser);
    await logIn(g2, gus.email, gus.pw);
    await g2.getByText('Gus road trip').first().waitFor({ timeout: 15000 });
    expect(!(await g2.getByText('Save your account').count()), 'logged in elsewhere: same trip, no guest warning');
    await g2.getByTestId('header-home').click();
    await g2.getByText('Know where everyone is. Split every bill fairly.').waitFor();
    expect(!(await g2.getByTestId('nav-login').count()), 'the Tripley logo opens the home page, with "My trips" instead of log in');
    await g2.getByTestId('nav-trips').click();
    await g2.getByText('Gus road trip').first().waitFor();
    ok('"My trips" goes back to the trips page');

    console.log('6. Ben opens Ana’s invite, signs up, and lands in the trip');
    const b = await newPage(browser);
    await b.goto(`${BASE}/join/${code}`);
    await b.getByText('Lisbon long weekend').first().waitFor();
    await shot(b, 'join-options');
    await b.getByTestId('join-signup').click();
    await b.getByTestId('signup-name').fill(ben.name);
    await b.getByTestId('signup-email').fill(ben.email);
    await b.getByTestId('signup-password').fill(ben.pw);
    await b.getByTestId('signup-submit').click();
    await b.getByTestId('trip-overview').waitFor({ timeout: 20000 });
    ok('signed up from the invite and joined the trip');

    console.log('7. Signing up again with a used email');
    const d = await newPage(browser);
    await d.goto(`${BASE}/sign-up`);
    await d.getByTestId('signup-name').fill('Someone');
    await d.getByTestId('signup-email').fill(ana.email);
    await d.getByTestId('signup-password').fill('another-pass-1');
    await d.getByTestId('signup-submit').click();
    await d.getByText(/already an account with this email/).waitFor();
    ok('duplicate email gets "log in instead"');

    console.log('8. One device, two accounts: nothing of Ana’s is left for Gus');
    const shared = await newPage(browser);
    const saved = () => shared.evaluate(() => ({ cache: localStorage.getItem('tripley.cache.v2') ?? '', owner: localStorage.getItem('tripley.cache.owner') }));
    await logIn(shared, ana.email, ana.pw2);
    await shared.getByText('Lisbon long weekend').first().waitFor({ timeout: 15000 });
    await shared.waitForTimeout(2600); // the offline copy is written at most every 2 s
    let s = await saved();
    expect(s.cache.includes('Lisbon long weekend') && !!s.owner, 'the offline copy holds Ana’s trip, tagged with her account');
    await signOut(shared);
    await shared.waitForTimeout(500);
    s = await saved();
    expect(!s.cache.includes('Lisbon long weekend') && !s.owner, 'signing out removes it from the device');
    await logIn(shared, gus.email, gus.pw);
    await shared.getByText('Gus road trip').first().waitFor({ timeout: 15000 });
    expect(!(await shared.getByText('Lisbon long weekend').count()), 'Gus sees only his own trip');
    await shared.waitForTimeout(2600);
    s = await saved();
    expect(s.cache.includes('Gus road trip') && !s.cache.includes('Lisbon long weekend'), 'the device now holds only Gus’s data');

    csp.assertNone();
    console.log('\nAll account checks passed.');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('ACCOUNT CHECK FAILED:', e.message);
  process.exit(1);
});
