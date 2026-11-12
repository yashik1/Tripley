# Tripley security and product review (November 2026)

This review follows the implementation brief: security, privacy and money
integrity first (Phase 1), then the shared itinerary (Phase 2). Everything
below was checked against the code on branch
`claude/tripley-security-product-improvements`, not assumed from the brief.

Nothing here was applied to the live site or the production database. All
tests ran against a throwaway Postgres 16 and a local Supabase stack in Docker.

## A. Security findings

| # | Severity | Issue | Evidence | Fix | Test result |
|---|---|---|---|---|---|
| 1 | High | Subscription webhook was not idempotent and applied events in arrival order. A retried or delayed older event (e.g. an `EXPIRATION` arriving after a `RENEWAL`) could switch Pro off, or a replayed purchase could switch it back on. | `revenuecat-webhook/index.ts` upserted `accounts.plan` for every delivery; no event id or timestamp was stored. | `subscription_events` table keyed by RevenueCat's event id; `apply_subscription_event()` records and applies each event in one transaction and ignores events older than the last one applied. Refunds (`CANCELLATION` with `CUSTOMER_SUPPORT`) end Pro at once; `REFUND_REVERSED` restores it; sandbox purchases are ignored unless `REVENUECAT_ALLOW_SANDBOX=true`; transfers move Pro and its expiry. The handler refuses everything if the secret is missing or shorter than 16 characters, caps the body at 64 KB, and logs only event id, type and outcome. | Pass: 12 DB tests (duplicate, two concurrent copies, out-of-order, renewal, cancellation, billing issue, refund and reversal, expiry, unknown type, other entitlement, sandbox, malformed and missing ids, transfer) and 7 handler tests (bad or missing auth, weak secret, malformed body, DB failure becomes a 500 so RevenueCat retries, nothing sensitive logged). |
| 2 | Medium | AI receipt quota was check-then-increment with a stale count, so parallel requests could exceed it. A client retry after a timeout charged twice. The file type came from the name or header. | `scan-receipt/index.ts` read `ai_scans_used`, called the AI, then wrote `used + 1`. | `reserve_ai_scan()` locks the account row and reserves a scan before the AI call; `finish_ai_scan()` keeps it; `release_ai_scan()` refunds it on any failure. Reservations whose function died are refunded after 10 minutes. The same `request_id` returns the saved result without another charge. The image type is checked from its first bytes (JPEG, PNG or WebP only), with strict path and size checks, a per-user limit (DB) and a best-effort per-IP limit. The AI call has a 60 s timeout and 1 retry. Error replies are generic, and logs hold no image or receipt content. | Pass: 9 DB tests (Pro, expiry, membership, malformed paths, a retry charged once, refund on failure, two requests for the last scan, the limit, stale refunds, rate limit) and 12 handler tests (provider timeout, busy and failure, unreadable receipt, oversized file, SVG or HTML disguised as an image, malformed input, retry after a timeout). |
| 3 | Medium | Cash kitty double spending: `kitty_payout` checked the balance without a lock, so two payouts (or a payout and a handover) could both pass. Payouts from a closed kitty were allowed. | Confirmed by mutation: with the lock removed, the race test fails (both 600-cent payouts from a 1,000-cent kitty go through). | Every kitty path locks the kitty row: cash-in, payout, handover, close, kitty bills (trigger), and undo or dispute of kitty records (trigger). Closed kitties are frozen. Amounts must be positive and at most 10^12 minor units. `client_id` makes retried cash-ins and payouts record once. Undoing a cash-in that has already been spent is refused. Trip deletion still cascades. | Pass: 9 DB tests, including two two-connection race tests (two payouts exceeding the cash; handover and payout at once), exact-balance payout, closed kitty, non-holder, non-member, retry, and zero, negative, huge and missing amounts. |
| 4 | Medium | Function privileges. All 47 public functions were executable by `anon`. Those check `auth.uid()`, so this was not directly exploitable. `is_member_of(trip, user)` and `display_name_of(user)` were callable by any signed-in user (a membership and name lookup for anyone whose id is known). Trigger functions were also callable. | `pg_proc` / `has_function_privilege` inventory (see C). | Revoked from `public` and `anon` everywhere except `trip_preview`. Internal helpers and trigger functions are revoked from `authenticated`. Server-only functions are granted to `service_role` only. New functions in `public` are no longer executable by default. | Pass: snapshot tests pin the exact functions `anon` (1) and signed-in users (30) can call. Separate tests check that every `SECURITY DEFINER` function pins `search_path=''`, that RLS is on for every table, and that ids from another trip are rejected. Verified on the real Supabase image too. |
| 5 | Medium | Offline data. The whole query cache, including friends' live coordinates and notifications, was saved for 7 days in AsyncStorage/localStorage. It wasn't reliably removed on sign-out (writes are throttled) and wasn't tied to an account. Unsynced bills stayed after sign-out. | `_layout.tsx` persister; `AuthProvider.signOut` only cleared memory. | Positions, notifications, invitations, the friends list and sharing settings are never saved. The saved copy is tagged with its account and dropped when another account signs in. Sign-out (or a session ending elsewhere) removes the copy, the tag, that person's unsynced bills (after a warning), the pending invite and the background-sharing state. Unsynced bills expire after 30 days. Sign-out works offline (local sign-out). | Pass: 9 unit tests (what's saved, expiry, account switch, sign-out, a queued bill refused after removal stays visible with the reason) and an end-to-end step: one browser, Ana then Gus, where the device ends up holding only Gus's data. |
| 6 | Medium | Storage had no size or type limits, and any file name (including `.html` or `.svg`) could be uploaded into the receipts and photo buckets. Signed links lasted 1 hour. | Bucket rows had no `file_size_limit` / `allowed_mime_types`; insert policies only checked the folder. | Receipts and photos: 8 MB; avatars: 2 MB; JPEG, PNG and WebP only. File names must be `<trip id>/<safe name>.<jpg|jpeg|png|webp>`, one folder deep. 30 uploads per person per 10 minutes. Signed links last 10 minutes. | Pass: 6 DB tests and a live check against the real local Storage API (9 MB → 413, HTML and SVG → 415, another trip's folder → 403, no read without signing in). |
| 7 | Low | Positions from ended trips stayed readable until the hourly job removed them 24 h later, and never if pg_cron is missing. | Read policy only checked membership. | Positions are visible only while the trip is active, and ending a trip deletes them at once. The hourly job remains for trips that just run past their end date. | Pass: 5 DB tests (signed out, stranger, paused, past end date with no job run, ended), plus member removal. |
| 8 | Low | The website sent no Content-Security-Policy, framing protection or HSTS. | `serve-web.cjs` headers. | CSP limited to this site, the Supabase API, map tiles and the exchange-rate API (with Stripe/RevenueCat only when web purchases are configured); `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Permissions-Policy`, and HSTS behind HTTPS. | Pass: 5 unit tests. All four browser suites run with the CSP enforced and fail on any violation; none were reported. |
| 9 | Info | Sign-up reveals that an email is registered ("There's already an account…"). The password reset flow does not. | GoTrue returns `user_already_exists` while email confirmation is off. | Not changed (it is the only useful message while auto-confirm is on). Fix: set up SMTP and turn email confirmation on (see E). | n/a |
| 10 | Info | Password minimum: the app requires 8 characters; local auth config allowed 6. | `supabase/config.toml` | Local config set to 8. Production GoTrue needs `GOTRUE_PASSWORD_MIN_LENGTH=8` (see E). | n/a |
| 11 | Info | Dependency advisories: 13 moderate (6 in production dependencies), 0 high or critical, all `glob`/`minimatch` inside Expo's CLI tooling. | `npm audit` | Fixed 12 Nov 2026 without an Expo upgrade: `overrides` in package.json move only the affected versions to the patched `glob` 14.0.2+ and `minimatch` 11.0.1+. Lint, typecheck, tests, the web build, the iPhone/Android bundles and native project generation all still pass. CI fails on any new high or critical advisory. | `npm audit`: 0 |
| 12 | Info | No CI workflows in the repository, so tests only run when someone runs them. | No `.github/` directory. | Recommended, not added. | n/a |

Checked and fine: no secrets in tracked files, git history or the built web
bundle; `EXPO_PUBLIC_*` values are all public by design (Supabase publishable
key, RevenueCat public SDK keys, map style, app domain); no dynamic SQL in
database functions; payment links URL-encode each person's handle and use
fixed schemes; no open-redirect parameters; the service worker caches only the
app's own files and public map tiles, never API responses; edge functions
verify the caller (JWT or shared secret) before using the service role.

## B. Changes made

Database (forward-only migrations):

- `supabase/migrations/20261110000000_security_hardening.sql`: subscription events, AI scan reservations, kitty locks and guards, location visibility, bucket limits and upload rules, function privileges. It deletes no data when it runs.
- `supabase/migrations/20261111000000_itinerary.sql`: shared itinerary (stops, RSVPs, comments), row-level rules, server-side validation, ordering and notifications.

Server functions:

- `_shared/revenuecat.ts` (new): webhook handling, testable under Node.
- `_shared/scan.ts` (new): receipt-scan handling, image sniffing, path checks.
- `_shared/env.ts` (new): Deno-only config reading.
- `_shared/http.ts`: helpers with no Deno APIs, plus a body size limit and the IP limiter.
- `revenuecat-webhook/index.ts` and `scan-receipt/index.ts`: thin wrappers around the shared handlers.
- `send-push/index.ts`: import change only.

App:

- `src/lib/cache-policy.ts` and `src/lib/device-data.ts` (new): what is saved on the device, account binding, clearing on sign-out.
- `src/app/_layout.tsx`, `src/providers/AuthProvider.tsx`, `src/lib/outbox.ts` and `src/app/profile.tsx`: use those rules; sign-out warns about unsynced bills.
- `src/lib/api.ts`: scan `request_id` with one retry; kitty `client_id`; 10-minute signed links; itinerary API.
- `src/app/trip/[id]/kitty.tsx` and `bill/new.tsx`: keep one id per action until it succeeds.
- Itinerary:
  - `src/lib/itinerary.ts` (new)
  - `src/app/trip/[id]/(tabs)/plan.tsx`, `plan/new.tsx` and `plan/[itemId].tsx` (new)
  - map stops, the Plan tab, notification routing, live updates

Web: `scripts/serve-web.cjs` sends the security headers.

Tests:

- `tests/db/security.test.ts` (48)
- `tests/db/itinerary.test.ts` (16)
- `tests/db/helpers.ts`
- `tests/unit/revenuecat-webhook.test.ts`, `scan-receipt.test.ts`, `device-data.test.ts`, `web-headers.test.ts` and `itinerary.test.ts`
- `tests/e2e/plan.cjs`
- CSP checks in every browser suite
- an account-switch step in `accounts.cjs`

## C. Test results

Environment:

- Linux container with Node 22 and Postgres 16 for the database tests.
- A local Supabase stack in Docker (supabase/postgres image, GoTrue, PostgREST, Storage, Realtime, Mailpit) for the browser tests.
- Chromium (Playwright).

| Command | Result |
|---|---|
| `npx tsc --noEmit` | Pass |
| `npx eslint .` | Pass (0 problems) |
| `npx vitest run` (unit and DB, 18 files) | Pass: 250 tests |
| `npm run functions:check` (Deno type-check of the 3 functions) | Pass |
| `node scripts/migrate.cjs` on the local Supabase image | Pass: both migrations applied |
| `npm run test:e2e:roadmap` | Pass |
| `npm run test:e2e:accounts` | Pass (incl. account switch) |
| `npm run test:e2e:plan` | Pass |
| `npm run test:e2e` (trip-flow, phone sign-in build) | Pass. The first run failed because the previous run's test phone users still existed; it passed after deleting them, as the README describes. |
| Upload checks through the real local Storage API | Pass (413 / 415 / 403 as expected) |
| Race test with the kitty lock removed (mutation check) | Fails as expected, so the test detects double spending |
| `npm audit --omit=dev` / `npm audit` | 6 / 13 moderate, 0 high, 0 critical (0 since 12 Nov 2026, finding 11) |
| Secret scan (regex over tracked files, git history and `dist/`) | No findings. This was a pattern search, not a dedicated scanner such as gitleaks. |

Not run, or blocked:

- Native iOS and Android builds (EAS), which need the Apple, Google and EAS accounts.
- `expo-doctor`.
- Supabase advisors on the live project. Production was deliberately not touched.
- Real RevenueCat deliveries and real Anthropic calls. Both paths are tested with stand-ins.
- RevenueCat's documentation could not be fetched from this environment (network blocked). The webhook keeps the "Authorization header value" scheme already used; confirm it in the RevenueCat dashboard.

## D. Product improvements

Implemented: the **shared itinerary**.

- **Plan tab with Today / Day 1 / Day 2.** Trip days come from the trip's dates; undated trips show the coming week.
- **Stops.** Each has a title, time window, place and address, a map point (from a pinned place or "where I am now"), and notes. New stops slot in by start time, and can be moved earlier or later.
- **Going / Maybe / Not going** answers on every stop, and a clash warning when two stops overlap.
- **Comments.** Whoever added the stop is notified.
- **Map and directions.** The next day's stops show on the trip map, with a Directions button on each stop.
- **Offline reading.** The plan opens without a connection; changes need one.
- **Permissions.** Members add stops; the person who added a stop or the organizer edits, moves or removes it. Ended trips are read-only. Leaving a trip removes your answers.

Not started:

- **Group polls (Phase 3).** Next in line, built the same way (tables, row-level rules, tests).
- **Phases 4–5.** Documents, flight status, AI suggestions, budgets, exports.

## E. Deployment instructions

1. **Review and merge.** Railway deploys `claude/tender-johnson-cscqn1`. Merging this branch into it (or pointing the `web` service at this branch) runs `node scripts/migrate.cjs` before deploy, which applies the two migrations.
   - Both are forward-only and delete no data.
   - Take a database backup first anyway.
2. **Web service.** No new variables are required. The CSP reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_MAP_STYLE_URL` at runtime, and both are already set. If the site needs another API host, add it with `CSP_CONNECT_EXTRA`.
3. **Auth service.**
   - Set `GOTRUE_PASSWORD_MIN_LENGTH=8`.
   - When SMTP is set up (`GOTRUE_SMTP_*`), set `GOTRUE_MAILER_AUTOCONFIRM=false`. This stops sign-up revealing which emails are registered.
4. **Edge functions (only if deployed).** Redeploy `scan-receipt`, `revenuecat-webhook` and `send-push`, since their shared code changed.
   - Secrets:
     - `REVENUECAT_WEBHOOK_SECRET`: 16 or more random characters, also entered in RevenueCat as `Bearer <secret>`.
     - `ANTHROPIC_API_KEY`.
   - Optional:
     - `REVENUECAT_ALLOW_SANDBOX=true` lets TestFlight or sandbox purchases grant Pro.
     - `REVENUECAT_ENTITLEMENT_ID`
     - `AI_SCAN_MONTHLY_LIMIT` (60)
     - `AI_SCAN_PER_USER_PER_MINUTE` (6)
     - `AI_SCAN_PER_IP_PER_MINUTE` (20)
     - `ANTHROPIC_TIMEOUT_MS` (60000)
5. **After deploying, check:**
   - Sign up, create a trip and add a stop.
   - Check that the browser console shows no CSP errors.
   - Upload a receipt.

## F. Git status

- Branch `claude/tripley-security-product-improvements`, created from `14e67ad`.
- Commits:
  - `da95ee1`: security and money integrity.
  - The commit after it: itinerary, this review and the README.
- `main` was not modified, and neither was the deployed branch.

## G. Remaining risks

- **Production unchecked.** Nothing was verified on production. The privilege and storage behaviour was checked on the same Supabase image locally, but the live database should be re-checked after migrating.
- **Device storage isn't encrypted.**
  - The offline copy (trips, bills, members' shared payment handles) and the Supabase session are in AsyncStorage (phones) and localStorage (web). That is Supabase's default for Expo, and readable on a rooted or jailbroken device or through an XSS bug.
  - Next step: keep the session in `expo-secure-store` (needs a new native build).
- **Fixed default privileges.** Future migrations must grant `execute` explicitly to `authenticated` for new client-callable functions. The privilege snapshot test will flag any change.
- **In-memory IP limiter.** The per-IP scan limit only works within one function instance. The database per-user limit is the real control.
- **Webhook unverified against the docs.** Webhook handling follows RevenueCat's documented model as known at the time of writing; the docs couldn't be fetched to re-check.
- **Sandbox purchases** are now ignored by default, so testers need `REVENUECAT_ALLOW_SANDBOX=true`.
- **Sign-up email enumeration** remains until email confirmation is on.
- **Moderate npm advisories** in Expo's build tooling remain until an Expo upgrade.
- **No CI** runs these tests automatically yet.
