/**
 * End-to-end flow with four people in four browsers (one joins as a guest), against the web build
 * and a local Supabase (`npx supabase start` with test OTP numbers
 * 15550000001-3 = 123456 in supabase/config.toml).
 *
 *   BASE_URL=http://localhost:8081 SHOTS=./shots node tests/e2e/trip-flow.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS || 'e2e-shots';
fs.mkdirSync(SHOTS, { recursive: true });

const goa = {
  maya: { latitude: 15.5527, longitude: 73.7517 },
  sam: { latitude: 15.5571, longitude: 73.7552 },
  lee: { latitude: 15.5489, longitude: 73.7608 },
  priya: { latitude: 15.5512, longitude: 73.7581 },
};

let step = 0;
async function shot(page, name) {
  step += 1;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${String(step).padStart(2, '0')}-${name}.png` });
}

function expect(cond, message) {
  if (!cond) throw new Error(`Expectation failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function signIn(page, local, name) {
  await page.getByTestId('phone-input').fill(local);
  await page.getByTestId('send-code').click();
  await page.getByTestId('otp-input').fill('123456');
  await page.getByTestId('name-input').waitFor({ timeout: 15000 });
  await page.getByTestId('name-input').fill(name);
  await page.getByTestId('save-name').click();
}

(async () => {
  const browser = await chromium.launch();
  const ctx = async (who) => {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: 'en-US',
      geolocation: goa[who],
      permissions: ['geolocation'],
    });
    const p = await c.newPage();
    p.on('pageerror', (e) => console.log(`[${who}] page error:`, e.message));
    return p;
  };
  const maya = await ctx('maya');
  const sam = await ctx('sam');
  const lee = await ctx('lee');
  const priya = await ctx('priya');

  try {
    console.log('1. Maya signs up with her phone number and creates a trip');
    await maya.goto(BASE);
    await maya.getByTestId('phone-input').waitFor();
    await shot(maya, 'sign-in');
    await signIn(maya, '5550000001', 'Maya');
    await maya.getByText('Hi Maya').waitFor();
    await maya.getByTestId('new-trip').click();
    await maya.getByTestId('trip-name').fill('Goa trip');
    await maya.getByLabel(/^Currency /).click();
    await maya.getByPlaceholder(/Search, or type a code/).fill('INR');
    await maya.getByText('INR  ·  Indian Rupee').click();
    await shot(maya, 'new-trip');
    await maya.getByTestId('create-trip').click();
    await maya.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const body = await maya.locator('body').innerText();
    const code = /\/join\/([0-9a-f]{12})/.exec(body)?.[1];
    expect(!!code, `invite link created (${code})`);
    await shot(maya, 'invite');

    console.log('2. Sam opens the link signed out, signs up, and joins');
    await sam.goto(`${BASE}/join/${code}`);
    await sam.getByText('Goa trip').waitFor();
    await shot(sam, 'join-preview');
    await sam.getByText('I have an account, sign in').click();
    await signIn(sam, '5550000002', 'Sam');
    // After signing up, Tripley finishes joining the invite he opened.
    await sam.getByText("Who's where").waitFor({ timeout: 20000 });
    expect(true, 'Sam signed up and was taken straight into the trip');

    console.log('2b. Priya joins from the link as a guest (just her name)');
    await priya.goto(`${BASE}/join/${code}`);
    await priya.getByTestId('join-guest-name').fill('Priya');
    await shot(priya, 'join-as-guest');
    await priya.getByTestId('join-as-guest').click();
    await priya.getByText("Who's where").waitFor({ timeout: 20000 });
    expect(true, 'Priya joined as a guest without phone or email');

    console.log('3. Lee signs up; Maya invites Lee by phone; Lee accepts in the app');
    await lee.goto(BASE);
    await signIn(lee, '5550000003', 'Lee');
    await lee.getByText('Hi Lee').waitFor();
    await maya.getByTestId('phone-input').fill('5550000003');
    await maya.getByTestId('send-invite').click();
    await maya.getByText(/Invitation sent/).waitFor();
    expect(true, 'in-app invitation sent by phone number');
    await lee.getByText('Invitations').waitFor({ timeout: 15000 }).catch(async () => {
      await lee.reload();
      await lee.getByText('Invitations').waitFor();
    });
    await shot(lee, 'invitation');
    await lee.getByText('Join trip').click();
    await lee.getByText("Who's where").waitFor({ timeout: 15000 });
    expect(true, 'Lee accepted and sees the trip map');

    console.log('4. Live map: everyone shares location and sees each other');
    await maya.goto(`${BASE}/trip/${await tripIdFrom(sam)}/map`);
    await maya.getByText("Who's where").waitFor();
    const pins = maya.locator('[data-testid^="map-pin-"]');
    for (let i = 0; i < 20 && (await pins.count()) < 4; i++) await maya.waitForTimeout(1000);
    expect((await pins.count()) === 4, `Maya's map shows 4 people (${await pins.count()})`);
    await shot(maya, 'map');

    console.log('5. Maya adds the dinner bill and taps who had what');
    const tripId = await tripIdFrom(maya);
    await maya.goto(`${BASE}/trip/${tripId}/bill/new`);
    await maya.getByTestId('bill-title').fill("Dinner at Britto's");
    await maya.getByTestId('item-name-0').fill('Pizza');
    await maya.getByTestId('item-price-0').fill('2400');
    await maya.getByText('All', { exact: true }).first().click();
    await maya.getByTestId('add-item').click();
    await maya.getByTestId('item-name-1').fill('Beer');
    await maya.getByTestId('item-price-1').fill('900');
    await maya.locator('[data-testid^="assign-1-"]').filter({ hasText: 'Sam' }).click();
    await maya.getByTestId('tax-input').fill('300');
    await maya.getByText('₹1,636.36').first().waitFor();
    expect(true, 'live preview: Sam ₹1,636.36 (quarter of the pizza + beer + his part of the tax)');
    await shot(maya, 'bill-editor');
    await maya.getByTestId('save-bill').click();
    await maya.waitForURL((u) => !u.toString().includes('/bill/new'), { timeout: 15000 });
    await maya.goto(`${BASE}/trip/${tripId}/bills`);
    await maya.getByText("Dinner at Britto's").first().waitFor({ timeout: 15000 });
    await shot(maya, 'bills');

    console.log('6. Sam sees what he owes and marks it paid');
    await sam.goto(`${BASE}/trip/${tripId}/balances`);
    await sam.getByTestId('net-balance').waitFor();
    const samNet = await sam.getByTestId('net-balance').innerText();
    expect(samNet === '₹1,636.36', `Sam owes ${samNet}`);
    await shot(sam, 'balances-owe');
    await sam.locator('[data-testid^="pay-"]').first().click();
    await sam.getByTestId('mark-paid').waitFor();
    await shot(sam, 'settle-up');
    await sam.getByTestId('mark-paid').click();
    await sam.getByTestId('net-balance').waitFor();
    for (let i = 0; i < 10 && (await sam.getByTestId('net-balance').innerText()) !== '₹0.00'; i++) await sam.waitForTimeout(500);
    expect((await sam.getByTestId('net-balance').innerText()) === '₹0.00', 'Sam is settled up after marking paid');

    console.log('7. Maya confirms she got the money');
    await maya.goto(`${BASE}/trip/${tripId}/balances`);
    await maya.getByText('Confirm payments').waitFor({ timeout: 15000 });
    await shot(maya, 'confirm-payment');
    await maya.getByText('Got it').click();
    await maya.getByText('Confirmed', { exact: false }).first().waitFor({ timeout: 15000 });
    const mayaNet = await maya.getByTestId('net-balance').innerText();
    expect(mayaNet === '₹1,309.09', `Maya is still owed ${mayaNet} by Lee and Priya`);
    await shot(maya, 'balances-after');

    console.log('8. Notifications reached the right people');
    await sam.goto(`${BASE}/notifications`);
    await sam.getByText(/confirmed your payment/).waitFor({ timeout: 15000 });
    expect(true, 'Sam was told Maya confirmed the payment');
    await shot(sam, 'notifications');

    console.log('\nAll steps passed.');
  } catch (e) {
    console.error('\nFAILED:', e.message);
    for (const [n, p] of Object.entries({ maya, sam, lee, priya })) await p.screenshot({ path: `${SHOTS}/fail-${n}.png` }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();

async function tripIdFrom(page) {
  const m = /\/trip\/([0-9a-f-]{36})/.exec(page.url());
  if (m) return m[1];
  throw new Error(`no trip id in ${page.url()}`);
}
