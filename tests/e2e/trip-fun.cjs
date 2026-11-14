/**
 * Trip Fun, end to end on the web: the seven chosen features.
 *   Digital Travel Scrapbook, My Travel Passport, Adventure Scavenger Hunt,
 *   Trip Awards, Trip Soundtrack, Food Explorer, Living Trip Timeline.
 * Also: one Trip Fun tile on the overview (no separate Challenges tile), and
 * the Wheel and Secret Missions stay hidden while the catalogue has them off.
 *
 *   BASE_URL=http://localhost:8081 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node tests/e2e/trip-fun.cjs
 */
const { chromium } = require('playwright');
const { Client } = require('pg');
const { watchCsp } = require('./csp-watch.cjs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const stamp = Date.now().toString(36);
const PHOTO = 'assets/images/icon.png';
const inDays = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
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
async function upload(page, testId) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId(testId).click();
  await (await chooser).setFiles(PHOTO);
}
async function addPlan(page, tripId, day, title, time) {
  await page.goto(`${BASE}/trip/${tripId}/plan/new?day=${day}`);
  await page.getByTestId('stop-title').fill(title);
  await page.getByTestId('stop-start').fill(time);
  await page.getByTestId('save-stop').click();
  await page.waitForURL((u) => !u.pathname.endsWith('/plan/new'), { timeout: 15000 });
}
const visible = (page, text) => page.locator(`text=${JSON.stringify(text)} >> visible=true`).first();

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL for the local database.');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. Ana and Ben on a trip to Lisbon that has started, with two plans');
    const ana = await person(browser);
    await signUp(ana, 'Ana Costa', `ana.fun.${stamp}@example.com`);
    await ana.goto(`${BASE}/trips/new`);
    await ana.getByTestId('trip-name').fill('Lisbon fun');
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(ana.url())[1];
    const code = /\/join\/([0-9a-f]{12})/.exec(await ana.locator('body').innerText())[1];
    await db.query(`update public.trips set starts_on = $2, ends_on = $3, destination = 'Lisbon, Portugal' where id = $1`, [tripId, inDays(-1), inDays(3)]);
    const ben = await person(browser);
    await signUp(ben, 'Ben Ortiz', `ben.fun.${stamp}@example.com`);
    await ben.goto(`${BASE}/join/${code}`);
    await ben.getByTestId('join-trip').click();
    await ben.getByTestId('trip-overview').waitFor({ timeout: 20000 });
    await addPlan(ana, tripId, inDays(-1), 'Castle visit', '10:00');
    await addPlan(ana, tripId, inDays(1), 'Fado night', '21:00');

    console.log('2. One Trip Fun tile; the hub shows the seven chosen features');
    await ana.goto(`${BASE}/trip/${tripId}/overview`);
    await visible(ana, 'Trip Fun').waitFor({ timeout: 15000 });
    expect((await ana.locator('text="Challenges" >> visible=true').count()) === 0, 'no separate Challenges tile on the overview');
    await visible(ana, 'Trip Fun').click();
    await ana.waitForURL((u) => u.pathname.endsWith('/fun'), { timeout: 10000 });
    for (const key of ['travel_scrapbook', 'travel_passport', 'scavenger_hunt', 'trip_awards', 'trip_soundtrack', 'food_explorer', 'living_timeline']) {
      await ana.getByTestId(`fun-${key}`).waitFor({ timeout: 10000 });
    }
    ok('all seven tiles are there');
    expect((await ana.getByTestId('fun-adventure_wheel').count()) === 0 && (await ana.getByTestId('fun-secret_missions').count()) === 0, 'the Wheel and Secret Missions are hidden');

    console.log('3. Food Explorer: a restaurant with a photo and a dish, shared with Ben');
    await ana.getByTestId('fun-food_explorer').click();
    await ana.getByText('🏮 Restaurant', { exact: true }).click();
    await ana.getByTestId('food-title').fill('Taberna da Rua das Flores');
    await ana.getByTestId('food-notes').fill('Book ahead; the octopus.');
    await upload(ana, 'food-add-photo');
    await ana.getByTestId('food-add').click();
    await ana.getByTestId('food-Taberna da Rua das Flores').waitFor({ timeout: 20000 });
    await ana.getByTestId('food-Taberna da Rua das Flores').locator('img').first().waitFor({ timeout: 15000 });
    ok('the restaurant shows with its photo');
    await ana.getByText('🍽️ Dish', { exact: true }).first().click();
    await ana.getByTestId('food-title').fill('Pastel de nata');
    await ana.getByTestId('food-where').fill('Manteigaria');
    await ana.getByTestId('food-add').click();
    await ana.getByTestId('food-Pastel de nata').waitFor({ timeout: 15000 });
    await ben.goto(`${BASE}/trip/${tripId}/fun/food`);
    await ben.getByTestId('food-Taberna da Rua das Flores').waitFor({ timeout: 15000 });
    const card = await ben.getByTestId('food-Taberna da Rua das Flores').innerText();
    expect(card.includes('Restaurant') && card.includes('Book ahead'), 'Ben sees the restaurant, its kind and notes');
    expect((await ben.getByTestId('food-Pastel de nata').innerText()).includes('Manteigaria'), 'and the dish with where it was');
    await ben.getByTestId('food-filter-dish').click();
    expect((await ben.getByTestId('food-Taberna da Rua das Flores').count()) === 0, 'filtering by Dish hides the restaurant');

    console.log('4. Trip Soundtrack: a song with a link and a memory');
    await ben.goto(`${BASE}/trip/${tripId}/fun/soundtrack`);
    await ben.getByTestId('song-title').fill('Canção do Mar — Dulce Pontes');
    await ben.getByTestId('song-link').fill('javascript:alert(1)');
    await ben.getByTestId('song-add').click();
    await ben.getByText('That doesn’t look like a web link', { exact: false }).waitFor({ timeout: 5000 });
    ok('a non-web link is refused');
    await ben.getByTestId('song-link').fill('open.spotify.com/track/abc123');
    await ben.getByTestId('song-moment').fill('Playing in the taxi up to the castle');
    await ben.getByTestId('song-add').click();
    await ben.getByTestId('song-Canção do Mar — Dulce Pontes').waitFor({ timeout: 15000 });
    const song = await ben.getByTestId('song-Canção do Mar — Dulce Pontes').innerText();
    expect(song.includes('Listen on open.spotify.com') && song.includes('taxi up to the castle'), 'the song shows its link and memory');
    await ben.evaluate(() => {
      window.__opened = [];
      window.open = (u) => (window.__opened.push(String(u)), null);
    });
    await ben.getByTestId('song-open').click();
    await ben.waitForTimeout(300);
    const opened = await ben.evaluate(() => window.__opened);
    expect(opened.includes('https://open.spotify.com/track/abc123'), `the link opens (https) outside Tripley (${opened.join(', ')})`);

    console.log('5. Adventure Scavenger Hunt: challenges, one completed with photo proof');
    await ana.goto(`${BASE}/trip/${tripId}/fun`);
    await ana.getByTestId('fun-scavenger_hunt').click();
    await ana.getByTestId('challenge-start-Find the best view in town').click();
    await ana.getByTestId('challenge-Find the best view in town').waitFor({ timeout: 15000 });
    await ana.getByTestId('challenge-own').fill('Find the oldest café');
    await ana.getByTestId('challenge-own-start').click();
    await ana.getByTestId('challenge-Find the oldest café').waitFor({ timeout: 15000 });
    const progress = await ana.getByTestId('hunt-progress').innerText();
    expect(progress.includes('0 of 2 challenges done'), 'progress starts at 0 of 2');
    await ana.getByTestId('challenge-Find the best view in town').getByTestId('challenge-enter').click();
    await upload(ana, 'post-add-photo');
    await ana.getByTestId('post-body').fill('Miradouro da Senhora do Monte');
    await ana.getByTestId('post-submit').click();
    await ana.waitForURL((u) => u.pathname.endsWith('/challenges'), { timeout: 20000 });
    await ana.getByTestId('hunt-progress').getByText('1 of 2 challenges done').waitFor({ timeout: 15000 });
    const status = await ana.getByTestId('challenge-Find the best view in town').getByTestId('challenge-status').innerText();
    expect(status.startsWith('Done by you'), `the challenge is done, by Ana (${status})`);
    await ben.goto(`${BASE}/trip/${tripId}/challenges`);
    await ben.getByTestId('hunt-progress').getByText('1 of 2 challenges done').waitFor({ timeout: 15000 });
    ok('Ben sees the progress');

    console.log('6. Digital Travel Scrapbook: a memory with a caption, story, day and photo');
    await ben.goto(`${BASE}/trip/${tripId}/fun/scrapbook`);
    await ben.getByTestId('scrapbook-add').click();
    await ben.getByTestId('memory-caption').fill('Sunset at the miradouro');
    await ben.getByTestId('memory-description').fill('Everyone sang along to the busker.');
    await ben.getByTestId('memory-day').fill(inDays(-1));
    await upload(ben, 'memory-add-photo');
    // Saving waits while the picked photo is still being prepared (the button is disabled until it's in).
    await ben.getByTestId('memory-save').click();
    await ben.waitForURL((u) => u.pathname.endsWith('/fun/scrapbook'), { timeout: 20000 });
    await visible(ben, 'Sunset at the miradouro').waitFor({ timeout: 15000 });
    await ana.goto(`${BASE}/trip/${tripId}/fun/scrapbook`);
    await visible(ana, 'Sunset at the miradouro').waitFor({ timeout: 15000 });
    await visible(ana, 'Everyone sang along to the busker.').waitFor();
    await visible(ana, 'Day 1').waitFor();
    const count = await ana.getByTestId('scrapbook-count').innerText();
    expect(/^3 memories · 3 photos/.test(count), `Ana sees Ben’s memory, her hunt photo and her food photo, by day (${count})`);
    expect((await ana.locator('text="Edit" >> visible=true').count()) === 0, 'only the author can edit a memory');

    console.log('7. Trip Awards: no self-votes, results, and a winner');
    await ben.goto(`${BASE}/trip/${tripId}/fun/awards`);
    expect(await ben.getByTestId('vote-food_scout-Ben Ortiz').isDisabled(), 'Ben can’t vote for himself');
    await ben.getByTestId('vote-food_scout-Ana Costa').click();
    await ben.getByText('Your vote: Ana.', { exact: false }).first().waitFor({ timeout: 15000 });
    const leading = await ben.getByTestId('award-result-food_scout').innerText();
    expect(leading === 'Leading: Ana · 1 vote', `results show the leader (${leading})`);
    await db.query('update public.trips set ended_at = now() where id = $1', [tripId]);
    await ana.goto(`${BASE}/trip/${tripId}/fun/awards`);
    await ana.getByText('The winners').waitFor({ timeout: 15000 });
    const winner = await ana.getByTestId('award-result-food_scout').innerText();
    expect(winner === 'Winner: You · 1 vote', `once the trip is over the leader is the winner (${winner})`);

    console.log('8. Living Trip Timeline: everything in order');
    await ana.goto(`${BASE}/trip/${tripId}/fun/timeline`);
    await visible(ana, 'Castle visit').waitFor({ timeout: 15000 });
    const text = await ana.locator('body').innerText();
    const order = ['The trip begins', 'Castle visit', 'Sunset at the miradouro', 'Fado night', 'Last day of the trip'].map((s) => text.indexOf(s));
    expect(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), `trip days, plans and memories in date order (${order.join(', ')})`);
    for (const s of ['Taberna da Rua das Flores', 'Canção do Mar — Dulce Pontes', 'Miradouro da Senhora do Monte']) {
      expect(text.includes(s), `the timeline has “${s}”`);
    }
    await ana.getByTestId('timeline-filter-songs').click();
    await ana.waitForTimeout(300);
    const songsOnly = await ana.locator('body').innerText();
    expect(songsOnly.includes('Canção do Mar') && !songsOnly.includes('Castle visit'), 'filtering shows only songs');
    await ana.getByTestId('timeline-filter-plans').click();
    await visible(ana, 'Castle visit').click();
    await ana.waitForURL((u) => u.pathname.includes('/plan/'), { timeout: 10000 });
    ok('tapping a plan opens it');

    console.log('9. My Travel Passport: stamp the trip, add a place, see progress');
    await ana.goto(`${BASE}/profile`);
    await ana.getByTestId('profile-passport').click();
    await ana.waitForURL((u) => u.pathname.endsWith('/passport'), { timeout: 10000 });
    await ana.getByTestId('passport-trip-Lisbon fun').getByTestId('passport-stamp-trip').click();
    await ana.getByTestId('stamp-Lisbon').waitFor({ timeout: 15000 });
    const lisbon = await ana.getByTestId('stamp-Lisbon').innerText();
    expect(lisbon.includes('Portugal') && lisbon.includes('Lisbon fun'), `the stamp names the country and links the trip (${lisbon.replace(/\s+/g, ' ')})`);
    await ana.getByTestId('passport-add').click();
    await ana.getByTestId('stamp-place').fill('Kyoto');
    await ana.getByTestId('stamp-country').fill('Japan');
    await ana.getByTestId('stamp-day').fill('2025-04-02');
    await ana.getByTestId('stamp-save').click();
    await ana.getByTestId('stamp-Kyoto').waitFor({ timeout: 15000 });
    const stats = {
      countries: await ana.getByTestId('passport-stat-countries').innerText(),
      places: await ana.getByTestId('passport-stat-places').innerText(),
      trips: await ana.getByTestId('passport-stat-trips').innerText(),
    };
    expect(stats.countries === '2' && stats.places === '2' && stats.trips === '1', `2 countries, 2 places, 1 trip (${JSON.stringify(stats)})`);
    expect((await ana.getByTestId('milestone-first_stamp').getAttribute('aria-label')).endsWith('reached'), 'the first-stamp milestone is reached');
    await ben.goto(`${BASE}/passport`);
    await ben.getByTestId('passport-hero').waitFor({ timeout: 15000 });
    expect((await ben.getByTestId('stamp-Kyoto').count()) === 0 && (await ben.getByTestId('stamp-Lisbon').count()) === 0, 'Ben can’t see Ana’s stamps');
    await ana.getByTestId('stamp-Lisbon').getByText('Lisbon fun ›').click();
    await ana.waitForURL((u) => u.pathname.endsWith('/fun/scrapbook'), { timeout: 10000 });
    ok('a stamp opens its trip’s scrapbook');

    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
    csp.assertNone();
    console.log('\nTrip Fun: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await db.end();
  }
})();
