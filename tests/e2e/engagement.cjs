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
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, geolocation: { latitude: 38.72, longitude: -9.14 }, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'] });
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
    expect((await ana.getByTestId('featured-progress').innerText()) === '17%', 'planning 17% (only the dates are done, 1 of 6)');
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
    expect((await ana.getByTestId('featured-progress').innerText()) === '50%', 'planning 50%: dates, friends and a plan (3 of 6)');
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

    console.log('7. The feed tells the trip’s story by itself');
    await ana.goto(`${BASE}/trip/${tripId}/feed`);
    await ana.getByText('Ana Costa started the trip').waitFor({ timeout: 15000 }).catch(() => ana.getByText('You started the trip').waitFor({ timeout: 5000 }));
    await ana.getByText('Ben Ortiz joined the trip 👋').waitFor({ timeout: 15000 });
    await ana.getByText('You added "Tram 28" to the plan').waitFor();
    ok('started, joined and planned show up without anyone posting');

    console.log('8. Updates, photos, reactions and comments');
    await ana.getByTestId('compose-update').click();
    await ana.getByTestId('post-body').fill('Can’t wait for Lisbon!');
    await ana.getByTestId('post-submit').click();
    await ana.getByText('Can’t wait for Lisbon!').waitFor({ timeout: 15000 });
    ok('Ana posted an update');
    await ben.goto(`${BASE}/trip/${tripId}/feed`);
    await ben.getByText('Can’t wait for Lisbon!').waitFor({ timeout: 15000 });
    expect((await ben.getByTestId('compose-announcement').count()) === 0, 'only the organizer can announce');
    await ben.getByTestId('compose-photos').click();
    const chooser = ben.waitForEvent('filechooser');
    await ben.getByTestId('post-add-photo').click();
    await (await chooser).setFiles('assets/images/icon.png');
    await ben.locator('img').first().waitFor({ timeout: 15000 });
    await ben.getByTestId('post-body').fill('Packing already');
    await ben.getByTestId('post-submit').click();
    await ben.getByTestId('post-photos').first().waitFor({ timeout: 30000 });
    await ben.getByTestId('post-photos').first().locator('img').first().waitFor({ timeout: 15000 });
    ok('Ben shared a photo; it shows from the private folder');
    await ana.getByTestId('post-photos').first().waitFor({ timeout: 15000 });
    ok('it reached Ana’s feed live');
    await ana.getByTestId('post-photos').first().getByTestId('react-open').click();
    await ana.getByTestId('react-🔥').click();
    await ana.getByTestId('post-photos').first().getByTestId('reaction-🔥').waitFor({ timeout: 10000 });
    ok('Ana reacted 🔥');
    await ana.getByTestId('post-photos').first().getByText('Comment').click();
    await ana.getByTestId('post-comment').fill('Gorgeous!');
    await ana.getByTestId('post-comment-send').click();
    await ana.getByText('Gorgeous!').waitFor();
    await ben.goto(`${BASE}/notifications`);
    await ben.getByText('Ana Costa commented: Gorgeous!').waitFor({ timeout: 15000 });
    ok('Ben was told about the comment');
    await shot(ana, 'post-with-comment');

    console.log('9. Announcements and notification choices');
    await ben.goto(`${BASE}/profile`);
    await ben.getByTestId('pref-posts').click();
    await ben.waitForTimeout(1500);
    await ana.goto(`${BASE}/trip/${tripId}/feed`);
    await ana.getByTestId('compose-announcement').click();
    await ana.getByTestId('post-body').fill('Meet at the airport at 7');
    await ana.getByTestId('post-submit').click();
    await ana.getByText('Meet at the airport at 7').waitFor({ timeout: 15000 });
    await ana.getByTestId('compose-update').click();
    await ana.getByTestId('post-body').fill('Quiet update');
    await ana.getByTestId('post-submit').click();
    await ana.getByText('Quiet update').waitFor({ timeout: 15000 });
    await ben.goto(`${BASE}/notifications`);
    await ben.getByText(/Meet at the airport at 7/).waitFor({ timeout: 15000 });
    await ben.waitForTimeout(1000);
    expect((await ben.getByText(/Quiet update/).count()) === 0, 'Ben, who turned post notifications off, still gets announcements but not updates');
    await shot(ana, 'feed');

    console.log('10. Long feeds load page by page');
    const token = (page) =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
        return JSON.parse(localStorage.getItem(key)).access_token;
      });
    const api = /EXPO_PUBLIC_SUPABASE_URL/.test('') ? '' : 'http://127.0.0.1:54321';
    for (const [page, count] of [[ana, 10], [ben, 10]]) {
      const jwt = await token(page);
      for (let i = 0; i < count; i++) {
        const r = await fetch(`${api}/rest/v1/rpc/create_post`, {
          method: 'POST',
          headers: { apikey: process.env.ANON_KEY || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH', Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
          body: JSON.stringify({ p_trip: tripId, p_kind: 'update', p_body: `Filler ${i}` }),
        });
        if (!r.ok) throw new Error(`posting filler failed: ${r.status} ${await r.text()}`);
      }
    }
    await ana.goto(`${BASE}/trip/${tripId}/feed`);
    await ana.getByText('Filler 9').first().waitFor({ timeout: 15000 });
    const firstPage = await ana.locator('[data-testid^="post-"], [data-testid^="feed-event-"]').count();
    await ana.mouse.move(200, 450);
    for (let i = 0; i < 12 && !(await ana.getByText('You’re all caught up').filter({ visible: true }).count()); i++) {
      await ana.mouse.wheel(0, 3000);
      await ana.waitForTimeout(800);
    }
    await ana.getByText('You’re all caught up').waitFor({ timeout: 15000 });
    const all = await ana.locator('[data-testid^="post-"], [data-testid^="feed-event-"]').count();
    expect(firstPage <= 20 && all > 20, `first page ${firstPage} posts, all ${all} after scrolling`);

    console.log('11. Bucket list: suggest, vote, add to the plan');
    await ben.goto(`${BASE}/trip/${tripId}/ideas`);
    await ben.getByTestId('suggest-idea').click();
    await ben.getByTestId('idea-name').fill('Time Out Market');
    await ben.getByTestId('idea-cost').fill('25');
    await ben.getByTestId('save-idea').click();
    await ben.getByTestId('idea-Time Out Market').waitFor({ timeout: 15000 });
    ok('Ben suggested a place');
    await ana.goto(`${BASE}/trip/${tripId}/ideas`);
    const idea = ana.getByTestId('idea-Time Out Market');
    await idea.waitFor({ timeout: 15000 });
    expect((await idea.innerText()).includes('about €25.00'), 'shows the rough cost');
    await idea.getByTestId('idea-vote').click();
    await ana.waitForFunction(() => document.querySelector('[data-testid="idea-votes"]')?.textContent === '1', null, { timeout: 10000 });
    ok('Ana voted for it');
    await idea.getByTestId('idea-add-to-plan').click();
    await idea.getByTestId('idea-in-plan').waitFor({ timeout: 15000 });
    ok('added to the plan');
    await ana.goto(`${BASE}/trip/${tripId}/plan`);
    await ana.getByTestId('stop-Time Out Market').waitFor({ timeout: 15000 });
    ok('it is now a stop in the schedule');
    await shot(ana, 'bucket-list-to-plan');

    console.log('12. Polls: ask, get reminded, vote, close');
    await ana.goto(`${BASE}/trip/${tripId}/polls`);
    await ana.getByTestId('start-poll').click();
    await ana.getByTestId('poll-question').fill('Where should we eat tonight?');
    await ana.getByTestId('poll-opt-0').fill('Taberna');
    await ana.getByTestId('poll-opt-1').fill('Pizza');
    await ana.getByTestId('save-poll').click();
    await ana.getByTestId('poll-Where should we eat tonight?').waitFor({ timeout: 15000 });
    ok('Ana started a poll');
    await ben.goto(BASE);
    await ben.getByTestId('reminder-poll').waitFor({ timeout: 15000 });
    ok('Ben’s dashboard reminds him to vote');
    await ben.getByTestId('reminder-poll').click();
    await ben.getByTestId('poll-option-Pizza').click();
    await ben.getByText(/1 vote · tap to change/).waitFor({ timeout: 10000 });
    ok('Ben voted');
    await ana.getByText('100% · 1').waitFor({ timeout: 15000 });
    ok('Ana sees the result live');
    await ana.getByTestId('poll-close').click();
    await ana.getByText('🏆 Pizza').waitFor({ timeout: 10000 });
    await ben.goto(`${BASE}/trip/${tripId}/polls`);
    await ben.getByText('🏆 Pizza').waitFor({ timeout: 15000 });
    expect((await ben.getByText('Decided').count()) > 0, 'closed: Pizza won, and Ben sees it under Decided (his post notifications are off)');
    await shot(ana, 'poll-decided');

    console.log('13. Getting ready: countdown, a private packing list, group tasks');
    await ana.goto(`${BASE}/trip/${tripId}/overview`);
    await ana.getByTestId('overview-prepare').click();
    await ana.getByTestId('prep-countdown').waitFor({ timeout: 15000 });
    expect((await ana.getByTestId('prep-countdown').innerText()) === '10 days until Lisbon!', 'countdown: 10 days until Lisbon!');
    await ana.getByTestId('prep-starters').click();
    await ana.getByTestId('task-Passport or ID').waitFor({ timeout: 15000 });
    await ana.getByRole('checkbox', { name: 'Passport or ID' }).click();
    await ana.waitForFunction(() => document.querySelector('[data-testid="prep-count"]')?.textContent === '1/10', null, { timeout: 10000 });
    ok('Ana added common items and packed her passport (1/10)');
    await ben.goto(`${BASE}/trip/${tripId}/prepare`);
    await ben.getByText('Only you can see your packing list.').waitFor({ timeout: 15000 });
    expect((await ben.getByTestId('task-Passport or ID').count()) === 0, 'Ben can’t see Ana’s packing list');
    await ben.getByTestId('prep-input').fill('Snorkel');
    await ben.getByTestId('prep-add').click();
    await ben.getByRole('checkbox', { name: 'Snorkel' }).click();
    await ben.getByTestId('prep-celebrate').waitFor({ timeout: 10000 });
    ok('Ben packed everything and got a little celebration');
    await ana.getByText('Group tasks').click();
    await ana.getByTestId('prep-input').fill('Book the ferry');
    await ana.getByText('Ben', { exact: true }).click();
    await ana.getByTestId('prep-add').click();
    await ana.getByText('For Ben').waitFor({ timeout: 15000 });
    await ben.getByText('Group tasks').click();
    await ben.getByRole('checkbox', { name: 'Book the ferry' }).click();
    await ana.getByText('Done by Ben').waitFor({ timeout: 15000 });
    ok('a group task assigned to Ben, ticked by Ben, seen by Ana live');
    await shot(ana, 'get-ready');

    console.log('14. A light-hearted challenge');
    await ben.goto(`${BASE}/trip/${tripId}/challenges`);
    await ben.getByTestId('challenge-start-Find the best local food').click();
    await ben.getByTestId('challenge-Find the best local food').waitFor({ timeout: 15000 });
    await ben.getByTestId('challenge-Find the best local food').getByTestId('challenge-enter').click();
    await ben.getByText('Update', { exact: true }).click();
    await ben.getByTestId('post-body').fill('Pastéis de nata at Manteigaria!');
    await ben.getByTestId('post-submit').click();
    await ben.waitForURL((u) => u.pathname.endsWith('/challenges'), { timeout: 15000 });
    await ben.getByText(/1 entry/).waitFor({ timeout: 15000 });
    ok('Ben started a challenge and entered with a post');
    await ana.goto(`${BASE}/trip/${tripId}/feed`);
    await ana.getByText('Ben Ortiz started a challenge: Find the best local food').waitFor({ timeout: 15000 });
    ok('the group sees it in the feed');

    console.log('15. Travel passport');
    await ana.goto(`${BASE}/profile`);
    await ana.getByTestId('passport').waitFor({ timeout: 15000 });
    const first = await ana.getByTestId('badge-first_trip').getAttribute('aria-label');
    expect(/First Trip: earned/.test(first ?? ''), 'First Trip is earned, with its date');
    const planner = await ana.getByTestId('badge-group_planner').getAttribute('aria-label');
    expect(/not yet\. Organize a trip that 3 or more people join/.test(planner ?? ''), 'Group Planner is locked and says how to earn it (only 2 in the trip)');
    expect(!(await ana.getByRole('switch', { name: 'Show my badges to people I travel with' }).isChecked()), 'badges are private by default');
    await shot(ana, 'passport');

    console.log('16. Trip memories after the trip');
    await ana.goto(`${BASE}/trip/${tripId}/settings`);
    await ana.getByText('End trip now').click();
    await ana.waitForTimeout(1500);
    await ana.goto(`${BASE}/trip/${tripId}/overview`);
    await ana.getByTestId('overview-memories').click();
    await ana.getByTestId('recap-preview').waitFor({ timeout: 15000 });
    let preview = await ana.getByTestId('recap-preview').innerText();
    expect(preview.includes('Lisbon trip · Lisbon, Portugal') && preview.includes('Ana, Ben'), 'the recap has the trip and the group');
    expect(preview.includes('Where should we eat tonight? → Pizza'), 'and what the group decided');
    expect(!preview.includes('spent together'), 'no money unless chosen');
    await ana.getByTestId('recap-people').click();
    preview = await ana.getByTestId('recap-preview').innerText();
    expect(!preview.includes('Ana, Ben'), 'switching off “who came” removes the names');
    await ana.getByTestId('recap-share').click();
    await ana.getByText(/Copied/).waitFor({ timeout: 10000 });
    const copied = await ana.evaluate(() => navigator.clipboard.readText());
    expect(copied === preview, 'the shared text is exactly the preview');
    await shot(ana, 'memories');

    csp.assertNone();
    console.log('\nAll engagement checks passed.');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('ENGAGEMENT CHECK FAILED:', e.message);
  process.exit(1);
});
