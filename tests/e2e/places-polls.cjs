/**
 * Real places, date and time pickers, map search and better polls, end to end:
 *  - a trip destination, a bucket-list idea, a plan stop and a feed find are
 *    picked from address search (shown as found on the map);
 *  - dates and times can be picked from a calendar or clock;
 *  - the map has a search box: a result can be pinned or added to the bucket list;
 *  - a poll can take several choices, and the organizer can edit someone's poll.
 *
 * The address search server is replaced by canned answers in Photon's format,
 * so the test doesn't depend on a public service. Needs the web app built with
 * EXPO_PUBLIC_AUTH_METHODS=password,guest against a local Supabase.
 *
 *   BASE_URL=http://localhost:8081 SHOTS=./places-shots node tests/e2e/places-polls.cjs
 */
const { chromium } = require('playwright');
const { watchCsp } = require('./csp-watch.cjs');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS || 'places-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0ea' } }] };
const inDays = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Canned Photon answers (GeoJSON, coordinates [lon, lat]).
const feature = (lon, lat, props) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props });
const PLACES = {
  lisb: [
    feature(-9.1366, 38.7078, { osm_type: 'R', osm_id: 5400890, osm_key: 'place', osm_value: 'city', name: 'Lisbon', state: 'Lisbon', country: 'Portugal', countrycode: 'PT' }),
    feature(-8.6291, 41.1579, { osm_type: 'R', osm_id: 1, osm_key: 'place', osm_value: 'city', name: 'Lisbon Falls', state: 'Maine', country: 'United States', countrycode: 'US' }),
  ],
  'time out': [
    feature(-9.1458, 38.7071, {
      osm_type: 'W', osm_id: 123, osm_key: 'amenity', osm_value: 'food_court', name: 'Time Out Market',
      street: 'Avenida 24 de Julho', housenumber: '49', postcode: '1200-479', city: 'Lisboa', country: 'Portugal', countrycode: 'PT',
    }),
  ],
  azulejo: [
    feature(-9.1136, 38.7247, {
      osm_type: 'W', osm_id: 456, osm_key: 'tourism', osm_value: 'museum', name: 'Museu Nacional do Azulejo',
      street: 'Rua da Madre de Deus', housenumber: '4', postcode: '1900-312', city: 'Lisboa', country: 'Portugal', countrycode: 'PT',
    }),
  ],
  manteigaria: [
    feature(-9.1424, 38.7106, {
      osm_type: 'N', osm_id: 789, osm_key: 'shop', osm_value: 'pastry', name: 'Manteigaria',
      street: 'Rua do Loreto', housenumber: '2', postcode: '1200-108', city: 'Lisboa', country: 'Portugal', countrycode: 'PT',
    }),
  ],
};
const searches = [];

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
const errors = [];
async function person(browser) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('https://tiles.openfreemap.org/**', (r) => (r.request().url().includes('/styles/') ? r.fulfill({ json: STYLE }) : r.fulfill({ status: 404 })));
  await ctx.route('https://photon.komoot.io/**', (r) => {
    const url = new URL(r.request().url());
    searches.push(url);
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const key = Object.keys(PLACES).find((k) => q.includes(k));
    r.fulfill({ json: { type: 'FeatureCollection', features: key ? PLACES[key] : [] }, headers: { 'access-control-allow-origin': '*' } });
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  return page;
}
async function signUp(page, name, email) {
  await page.goto(`${BASE}/sign-up`);
  await page.getByTestId('signup-name').fill(name);
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill('places-2026-ok');
  await page.getByTestId('signup-submit').click();
  await page.getByTestId('home-profile').waitFor({ timeout: 20000 });
}
/** Picks a date or time the way the calendar/clock button does on the web (the browser's own picker UI can't be driven headless). */
async function pick(page, testID, value) {
  await page.getByTestId(`${testID}-pick`).click();
  await page.getByTestId(`${testID}-pick-input`).fill(value);
}

(async () => {
  const browser = await chromium.launch();
  const csp = watchCsp(browser);
  try {
    console.log('1. A new trip: the destination comes from search, the dates from a calendar');
    const ana = await person(browser);
    await signUp(ana, 'Ana Costa', `ana.places.${stamp}@example.com`);
    await ana.goto(`${BASE}/trips/new`);
    await ana.getByTestId('trip-name').fill('Lisbon long weekend');
    await ana.getByTestId('trip-destination').fill('Lisb');
    await ana.getByTestId('trip-destination-result-0').waitFor({ timeout: 10000 });
    const areaSearch = searches[searches.length - 1];
    expect(areaSearch.searchParams.getAll('layer').includes('city') && !areaSearch.searchParams.getAll('layer').includes('house'), 'a destination search only looks for towns, regions and countries');
    expect((await ana.getByTestId('trip-destination-results').innerText()).includes('Lisbon Falls'), 'similar names are offered to choose from');
    await shot(ana, 'destination-search');
    await ana.getByTestId('trip-destination-result-0').click();
    expect((await ana.getByTestId('trip-destination').inputValue()) === 'Lisbon, Portugal', 'picking fills in “Lisbon, Portugal”');
    expect((await ana.getByTestId('trip-destination-note').innerText()).startsWith('✓ Found on the map'), 'and says it was found on the map');
    await pick(ana, 'trip-start', inDays(10));
    expect((await ana.getByTestId('trip-start').inputValue()) === inDays(10), 'the start date was picked from the calendar');
    expect((await ana.getByTestId('trip-end-pick-input').getAttribute('min')) === inDays(10), 'the end calendar starts from the start date');
    await pick(ana, 'trip-end', inDays(13));
    await shot(ana, 'dates-picked');
    await ana.getByTestId('create-trip').click();
    await ana.getByText('Share the invite link').waitFor({ timeout: 15000 });
    const tripId = /\/trip\/([0-9a-f-]{36})/.exec(ana.url())[1];
    const code = /\/join\/([0-9a-f]{12})/.exec(await ana.locator('body').innerText())[1];
    await ana.goto(`${BASE}/trip/${tripId}/settings`);
    await ana.getByText('✓ Found on the map').first().waitFor({ timeout: 15000 });
    ok('trip settings remember the destination’s map point');

    console.log('2. Ben joins');
    const ben = await person(browser);
    await signUp(ben, 'Ben Ortiz', `ben.places.${stamp}@example.com`);
    await ben.goto(`${BASE}/join/${code}`);
    await ben.getByTestId('join-trip').click();
    await ben.getByTestId('trip-overview').waitFor({ timeout: 20000 });
    ok('Ben joined');

    console.log('3. A bucket-list idea found by name');
    await ana.goto(`${BASE}/trip/${tripId}/idea/new`);
    await ana.getByTestId('idea-address').fill('time out');
    await ana.getByTestId('idea-address-result-0').waitFor({ timeout: 10000 });
    const ideaSearch = searches[searches.length - 1];
    expect(ideaSearch.searchParams.get('lat') === '38.708' && ideaSearch.searchParams.get('lon') === '-9.137', 'searches look near the trip’s destination first');
    expect((await ana.getByText('Search by Photon · © OpenStreetMap contributors').count()) > 0, 'results credit OpenStreetMap');
    await ana.getByTestId('idea-address-result-0').click();
    expect((await ana.getByTestId('idea-name').inputValue()) === 'Time Out Market', 'the name is filled in from the place');
    expect(
      (await ana.getByTestId('idea-address').inputValue()) === 'Time Out Market, Avenida 24 de Julho 49, 1200-479 Lisboa, Portugal',
      'the full address is filled in',
    );
    await shot(ana, 'idea-found');
    await ana.getByTestId('idea-address').fill('Somewhere by the river');
    expect((await ana.getByTestId('idea-address-note').innerText()).startsWith('Not checked on the map yet'), 'typing over it marks it as not checked');
    await ana.getByTestId('idea-address').fill('time out');
    await ana.getByTestId('idea-address-result-0').click();
    await ana.getByTestId('save-idea').click();
    await ana.getByText('Time Out Market').first().waitFor({ timeout: 15000 });
    ok('the idea is on the bucket list');

    console.log('4. A plan stop: a time from the clock, the place from search');
    await ana.goto(`${BASE}/trip/${tripId}/plan/new`);
    await ana.getByTestId('stop-title').fill('Tile museum');
    await pick(ana, 'stop-start', '10:30');
    expect((await ana.getByTestId('stop-start').inputValue()) === '10:30', 'the start time was picked from the clock');
    await ana.getByTestId('stop-end').fill('12');
    await ana.getByTestId('stop-place').fill('azulejo');
    await ana.getByTestId('stop-place-result-0').click();
    expect((await ana.getByTestId('stop-place').inputValue()) === 'Museu Nacional do Azulejo', 'the place name is filled in');
    expect((await ana.getByTestId('stop-address').inputValue()).startsWith('Museu Nacional do Azulejo, Rua da Madre de Deus 4'), 'and its address');
    expect((await ana.getByTestId('stop-found').innerText()).startsWith('✓ Found on the map'), 'it’s on the map');
    await shot(ana, 'stop-found');
    await ana.getByTestId('save-stop').click();
    await ana.getByText('Tile museum').first().waitFor({ timeout: 15000 });
    ok('the stop is in the plan');

    console.log('5. A feed find from search');
    await ben.goto(`${BASE}/trip/${tripId}/post/new?kind=place`);
    await ben.getByTestId('post-place').fill('manteigaria');
    await ben.getByTestId('post-place-result-0').click();
    expect((await ben.getByTestId('post-place').inputValue()) === 'Manteigaria', 'the find is named from search');
    await ben.getByTestId('post-body').fill('Best custard tarts so far');
    await ben.getByTestId('post-submit').click();
    await ben.getByText('Best custard tarts so far').waitFor({ timeout: 15000 });
    ok('posted with its map point');

    console.log('6. Searching the map');
    await ana.goto(`${BASE}/trip/${tripId}/map`);
    await ana.getByTestId('map-search').fill('azulejo');
    await ana.getByTestId('map-search-result-0').click();
    await ana.getByTestId('map-search-card').waitFor();
    expect((await ana.getByTestId('map-search-card').innerText()).includes('Museu Nacional do Azulejo'), 'the result is shown under the map');
    await ana.locator('[data-testid="map-search-target"]').waitFor({ timeout: 10000 });
    ok('the map flies there and marks it');
    await shot(ana, 'map-search');
    await ana.getByTestId('map-search-idea').click();
    await ana.getByTestId('idea-name').waitFor();
    expect((await ana.getByTestId('idea-name').inputValue()) === 'Museu Nacional do Azulejo', '“Add to bucket list” opens the idea filled in');
    expect((await ana.getByTestId('idea-address-note').innerText()).startsWith('✓ Found on the map'), 'already found on the map');
    await ana.goBack();
    await ana.getByTestId('map-search').fill('azulejo');
    await ana.getByTestId('map-search-result-0').click();
    await ana.getByTestId('map-search-pin').click();
    await ana.getByTestId('place-name').waitFor();
    expect((await ana.getByTestId('place-name').inputValue()) === 'Museu Nacional do Azulejo', '“Pin it” opens the pin form filled in');
    await ana.getByTestId('save-place').click();
    await ana.locator('[data-testid^="map-place-"]').first().waitFor({ timeout: 15000 });
    ok('the place is pinned for everyone');

    console.log('7. A poll with more than one choice, and a closing time picked from a calendar');
    await ben.goto(`${BASE}/trip/${tripId}/poll/new`);
    await ben.getByTestId('poll-question').fill('Which days work for the boat trip?');
    await ben.getByTestId('poll-opt-0').fill('Friday');
    await ben.getByTestId('poll-opt-1').fill('Saturday');
    await ben.getByTestId('poll-multiple').click();
    await ben.getByTestId('poll-close-pick').click();
    await pick(ben, 'poll-close-day', inDays(2));
    await pick(ben, 'poll-close-time', '20:00');
    await shot(ben, 'poll-new');
    await ben.getByTestId('save-poll').click();
    await ben.waitForURL((u) => !u.pathname.endsWith('/poll/new'), { timeout: 15000 }).catch(async () => {
      throw new Error(`Saving the poll failed: ${(await ben.locator('body').innerText()).slice(-400)}`);
    });
    await ana.goto(`${BASE}/trip/${tripId}/polls`);
    const boat = ana.getByTestId('poll-Which days work for the boat trip?');
    await boat.waitFor({ timeout: 15000 }).catch(async (e) => {
      await shot(ana, 'polls-missing');
      console.log('PAGE:', (await ana.locator('body').innerText()).slice(0, 1500), 'ERRORS:', errors);
      throw e;
    });
    expect((await boat.innerText()).includes('Pick as many as you like'), 'it says you can pick several');
    // The same wording the app uses (src/lib/group-decisions.ts closingLabel), for 20:00 two days from now.
    const [y, mo, d] = inDays(2).split('-').map(Number);
    const hours = Math.round((new Date(y, mo - 1, d, 20, 0).getTime() - Date.now()) / 3_600_000);
    const label = hours < 36 ? `Closes in ${hours} h` : `Closes in ${Math.round(hours / 24)} days`;
    expect((await boat.innerText()).includes(label), `it closes at the picked time (“${label}”)`);
    await boat.getByTestId('poll-option-Friday').click();
    await boat.getByText('☑ Friday').waitFor({ timeout: 10000 });
    await boat.getByTestId('poll-option-Saturday').click();
    await boat.getByText('☑ Saturday').waitFor({ timeout: 10000 });
    expect((await boat.innerText()).includes('1 person voted'), 'two picks, one person');
    expect((await boat.innerText()).match(/100% · 1/g)?.length === 2, 'each picked option shows 100% of voters');
    await shot(ana, 'poll-multiple');

    console.log('8. The organizer edits Ben’s poll');
    expect((await boat.getByTestId('poll-edit').count()) === 1, 'the organizer can edit someone else’s poll');
    await boat.getByTestId('poll-edit').click();
    await ana.getByTestId('poll-question').waitFor();
    expect((await ana.getByTestId('poll-opt-1').inputValue()) === 'Saturday', 'the form starts from the poll as it is');
    await ana.getByTestId('poll-opt-1').fill('Saturday morning');
    await ana.getByTestId('poll-add-option').click();
    await ana.getByTestId('poll-opt-2').fill('Sunday');
    await ana.getByTestId('poll-remove-0').click();
    await ana.getByText(/Removing an option with a vote also removes that vote/).waitFor();
    ok('removing a voted option warns first');
    await shot(ana, 'poll-edit');
    await ana.getByTestId('save-poll').click();
    await ana.getByTestId('poll-option-Saturday morning').waitFor({ timeout: 15000 });
    const edited = ana.getByTestId('poll-Which days work for the boat trip?');
    const text = await edited.innerText();
    expect(text.includes('edited') && !text.includes('Friday') && text.includes('Sunday'), 'renamed, added and removed; marked as edited');
    expect(text.includes('☑ Saturday morning'), 'Ana’s pick followed the renamed option');
    await ben.goto(`${BASE}/trip/${tripId}/polls`);
    await ben.getByTestId('poll-option-Saturday morning').waitFor({ timeout: 15000 });
    expect((await ben.getByTestId('poll-Which days work for the boat trip?').innerText()).includes('edited'), 'Ben sees the edited poll');

    console.log('9. Only the poll’s creator or the organizer can edit');
    await ana.goto(`${BASE}/trip/${tripId}/poll/new`);
    await ana.getByTestId('poll-question').fill('Dinner tonight?');
    await ana.getByTestId('poll-opt-0').fill('Taberna');
    await ana.getByTestId('poll-opt-1').fill('Ramen');
    await ana.getByTestId('save-poll').click();
    await ben.goto(`${BASE}/trip/${tripId}/polls`);
    const dinner = ben.getByTestId('poll-Dinner tonight?');
    await dinner.waitFor({ timeout: 15000 });
    expect((await dinner.getByTestId('poll-edit').count()) === 0, 'Ben can’t edit the organizer’s poll');
    expect((await ben.getByTestId('poll-Which days work for the boat trip?').getByTestId('poll-edit').count()) === 1, 'but can edit his own');

    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
    csp.assertNone();
    console.log('\nPlaces, pickers, map search and polls: all checks passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
