# Tripley interactive redesign: implementation report

Branch `feature/tripley-interactive-experience`. It builds on the security work (the merged PR #1). Nothing was merged into `main` or into the deployed branch.

**Phases are complete only where marked.** Phases 1 to 5 are implemented and tested. Phase 6 (Explore Nearby) is deferred; see "Deferred". Everything here was tested against a local Supabase stack, not production.

## 1. Branch and commits

| Phase | Commit | What |
|---|---|---|
| 1 | `3088b75` | Visual identity, dashboard, trip overview, trip cards, money chart |
| 2 | `2991d93` | Activity feed, plus a fix for photo uploads under the CSP (below) |
| 3 | `ea189e7` | Bucket list and polls |
| 4 | `d45d046` | Getting ready (packing, group tasks, countdown) and challenges |
| 5 | `8c89222` | Travel passport and trip memories |
| – | the commit after it | This report, screenshots and README |

No pull request was opened. Open one from the branch when you're ready to review: https://github.com/yashik1/Tripley/compare/claude/tender-johnson-cscqn1...feature/tripley-interactive-experience

**Hotfix already live: `5db2edf` on `claude/tender-johnson-cscqn1`.** The security branch's Content-Security-Policy blocked reading a just-picked photo (a `blob:` URL) on the web. Receipt and place photo uploads would have failed on the live site. The fix allows `blob:` and `data:` in `connect-src`. Railway deployed it at 20:54 UTC (status SUCCESS).

## 2. Screens redesigned

Before and after screenshots are in `docs/redesign/`:

- `before-*.png` and `after-*.png`: the same steps on the old and new build.
- Dark mode and desktop are included.

| Screen | Change |
|---|---|
| Home (dashboard) | Rebuilt, including the onboarding for new users |
| Trip cards | Cover, status, countdown, avatars and progress |
| Trip Overview | New; trips open here |
| Plan | Schedule, Bucket list and Polls switch; compact day chips |
| Money | Bills and Balances switch; "Who paid, whose share" chart |
| Feed | New |
| Get ready | New |
| Challenges | New |
| Memories | New |
| Explore ideas | New |
| Join with a code | New |
| Profile | Passport, notification settings |
| Trip settings | Cover photo, destination |
| Everything else | Picks up the new palette, shadows, rounder cards and pill buttons |

## 3. Features implemented (all working, all tested)

**Visual identity:**
- Your palette, with deep teal for buttons. White text on the bright teal #18A999 fails WCAG contrast (2.9:1), so #18A999 is used as an accent instead.
- Coral and yellow accents.
- Contrast was checked for every text and background pair; all are at or above 4.5:1 except the faint caption colour, which is 4.2:1.
- Soft shadows, light and dark mode, and system fonts (no extra download).

**Dashboard:**
- **Greeting:** your photo and a notification badge.
- **Featured trip:** the trip on now, or else the next to start, or else the newest being planned. It shows the cover, countdown, travellers and real planning progress.
- **Quick actions:** create a trip, join with a code, invite friends, explore ideas, add an activity.
- **Reminders from real data:** unanswered plans, polls waiting for your vote, invite friends, pin your stay, add a first plan.
- **Recent activity:** the group's posts.
- **Rest of the page:** other and completed trips, skeleton loading, and an onboarding card for new users.

**Trip overview:**
- Destination header with countdown, the group, and what's next.
- "Get ready" card and the planning checklist.
- Quick actions, and tiles for plan, bucket list, polls, challenges, map, money and people.
- The recap card when the trip is on or over.

**Activity feed:**
- Post types: updates, up to 6 photos, places you found (with directions), and organizer announcements.
- Automatic posts for: started, joined, pinned, planned, bill added (no amounts), idea suggested, poll started, challenge started.
- Six emoji reactions, with a gentle animation.
- Comments.
- Notification preferences.
- 20 posts per page with infinite scroll, pull-to-refresh, and live updates.

**Bucket list:**
- Each suggestion has a category, description, address, map point, photo, rough cost and preferred day.
- One vote each.
- "Add to plan" happens exactly once, even when two people press it at the same moment.

**Polls:**
- 2 to 8 options, one vote each (changeable or fixed, or withdrawn), and an optional closing time.
- Closed by its creator or the organizer.
- Animated result bars, and the winner is announced.

**Getting ready:**
- Countdown ("10 days until Lisbon!").
- A private packing list with "add common items".
- Group tasks with assignees ("Done by Ben").
- Progress bars, a small celebration when a list is complete, and packing counted in planning progress.

**Challenges:** optional and light-hearted. You start one from a list of ideas and enter with your own post; the top entries are ranked by reactions. No location or personal details are involved.

**Travel passport:**
- Nine badges, each computed by the server from real records, with the date earned.
- Locked badges show exactly how to earn them.
- Private by default; you can show them to people you travel with.

**Trip memories:**
- Photos, counts, plan highlights, places and poll results.
- You choose the sections, preview the text, and share it with the system share sheet (or it's copied to the clipboard on the web).
- Locations, receipts and individual amounts are never included. Photos stay private.

**Feel:**
- Card and button press feedback, animated progress and checkboxes, reaction pops and skeleton loaders.
- All animation is off when the device asks for reduced motion.

## 4. Partially implemented

- **Shared files** in the trip detail: not built. Photos live in the feed and memories; documents such as tickets or PDFs need their own bucket and viewer.
- **Recap sharing:** text only. Sharing selected photos would need a public copy of private images, which I didn't want to create without your decision.
- **Expense categories:** the money chart shows who paid and whose share, but not categories, because bills have no category yet. Adding one means changing `save_bill`.
- **Navigation:** the brief's app-wide tabs (Home, Trips, Explore, Activity, Profile) were adapted rather than copied, to avoid duplicating screens. The home dashboard is the hub, and each trip has five tabs (Overview, Plan, Map, Feed, Money).
- **Haptics:** not added, because it would mean a new native module and a new build.
- **Offline:** the feed, plan, bucket list and polls can be read offline. Posting, voting and editing need a connection and say so; they aren't queued.

## 5. Deferred: Explore Nearby (Phase 6)

Live nearby restaurants and attractions need a places provider, and each option has a catch:

- **Google Places:** paid per request; needs an API key held on the server.
- **Foursquare:** paid tiers; attribution rules.
- **OpenStreetMap (Overpass):** free, but rate-limited; the public instances aren't for production traffic.

The brief asks to weigh cost and terms before integrating, so I didn't wire in fake data. The "Explore ideas" screen is clearly labelled as a hand-picked list of 12 destinations that pre-fill a new trip; it is not live data.

**Recommendation:** Overpass through a small server-side function, with caching and a per-user rate limit. Saving a result into the bucket list already works through the existing suggestion flow.

## 6. Database changes

Five forward-only migrations. None deletes or rewrites data.

1. `20261112000000_trip_overview.sql`:
   - `trips.destination` and `trips.cover_path` (must be in the trip's own folder).
   - `my_trip_overview()`, a security-invoker function, so row-level security applies.
2. `20261113000000_activity_feed.sql`:
   - Tables `trip_posts`, `post_photos`, `post_reactions` and `post_comments`.
   - Column `profiles.notification_prefs`.
   - Functions `create_post`, `toggle_reaction` and `wants_notification`.
   - Automatic-post triggers.
3. `20261114000000_bucket_list_polls.sql`:
   - Tables `trip_suggestions`, `suggestion_votes`, `trip_polls`, `poll_options` and `poll_votes`.
   - Functions `toggle_suggestion_vote`, `add_suggestion_to_plan`, `create_poll`, `vote_poll` and `close_poll`.
4. `20261115000000_preparation.sql`:
   - Tables `trip_tasks`, `trip_challenges` and `challenge_entries`.
   - Functions `create_challenge` and `enter_challenge`.
   - `my_trip_overview` gains packing and task counts.
5. `20261116000000_passport.sql`:
   - Column `profiles.show_achievements`.
   - Function `user_achievements` (computed, so nothing is stored).

## 7. Row-level security and storage

- **Membership:** every new table has row-level security on. Reads require current trip membership. Ended trips are read-only.
- **Writes:**
  - Posts, reactions, votes, polls and challenges are written only through `SECURITY DEFINER` functions with an empty `search_path`. Each checks `auth.uid()`, membership and same-trip ids.
  - Plain inserts use column-level grants, plus triggers that force the author or creator to the signed-in person.
- **Privacy:** packing lists are visible only to their owner. Leaving a trip removes your reactions, votes and RSVPs.
- **Photos:** posts, ideas and covers use the existing private `trip-photos` bucket (8 MB, JPEG, PNG or WebP only, upload rate limit). A post or idea can reference only a photo the same person uploaded into that trip's folder. Photos are shown through 10-minute signed links that are never saved offline.
- **Rate limits:** 20 posts per 10 minutes; 15 comments per minute; 10 polls and 30 ideas per 10 minutes; 100 tasks per 10 minutes.
- **Notifications:** carry short text and ids only; never locations or amounts.
- **Function permissions:** the snapshot test pins every function a signed-in user may call (now 40). Signed-out visitors can still only call the invite preview.

## 8. Security test results

The earlier risk areas were re-checked by re-running their tests, not assumed fixed:

- webhook idempotency and event ordering
- atomic receipt-scan quota
- function permissions and `search_path`
- kitty payout races
- offline cache isolation
- upload validation
- location visibility and retention

All pass. One new bug was found and fixed: the CSP photo-upload problem above, now covered by a browser upload test.

## 9. Test commands and results

All run on this branch: Node 22, a throwaway Postgres 16, a local Supabase stack in Docker, and Chromium.

| Command | Result |
|---|---|
| `npx tsc --noEmit` | Pass |
| `npx eslint .` | Pass |
| `npx vitest run` (unit and database, 28 files) | 316 passed |
| `node tests/e2e/engagement.cjs` | Pass (16 steps; listed below) |
| `node tests/e2e/roadmap.cjs` | Pass |
| `node tests/e2e/accounts.cjs` | Pass (includes account switching) |
| `node tests/e2e/plan.cjs` | Pass |
| `node tests/e2e/trip-flow.cjs` (phone sign-in build) | Pass |
| `npm run export:web` | Pass (both builds) |
| `npm audit` | 13 moderate, 0 high, 0 critical (Expo build tooling; no new dependencies) |
| Secret scan (pattern search of this branch's diff and `dist/`) | No secrets. One match was supabase-js code that checks key prefixes. |

The engagement suite covers:

1. Onboarding for a new user.
2. Explore ideas pre-filling a trip.
3. The dashboard's countdown, progress and reminders.
4. Joining with a code.
5. Progress updating as plans and friends are added.
6. The trip overview.
7. The automatic feed story.
8. Posts, a real photo upload, reactions and comments with notifications.
9. Announcements and notification preferences.
10. Paging past 20 posts.
11. The bucket list, through to adding an idea to the plan.
12. Polls: reminder, vote, live results, close.
13. Packing privacy, the celebration, and group tasks.
14. Challenges.
15. The passport.
16. Memories and share privacy.

Every browser suite fails on any Content-Security-Policy violation; none occurred.

Row-level security was tested as signed-out, member A, member B and non-member in `tests/db/{security,engagement,bucket-polls,preparation,passport}.test.ts`. That includes two-connection race tests for the kitty payout and for add-to-plan.

**Not run:**
- Native iOS and Android builds, which need your Apple, Google and EAS accounts.
- Real devices.
- The production database.

## 10. Configuration needed

None for the new features: no new environment variables, providers or keys. Deploying runs the five migrations automatically (Railway pre-deploy).

## 11. Remaining risks and limitations

- **Local testing only.** Nothing new is verified on production yet. Take a database backup before merging.
- **New user content.** The feed means text and photos from users, and there is no reporting or blocking yet. Organizers can remove posts and comments.
- **Notification wording.** Push text includes a short snippet of a post (up to 80 to 100 characters), which shows on lock screens. People can switch post notifications off.
- **Merging.** This branch carries the same CSP fix as `5db2edf`, so merging into the deployed branch should be conflict-free, but review the diff.
