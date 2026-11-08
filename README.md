# Tripley

Group trips without the "where are you?" texts and the spreadsheet at the end.

- **Live map.** Everyone on the trip sees each other, even with the app closed (iPhone & Android). Pause anytime; sharing stops by itself when the trip ends.
- **Invite by link or in the app.** The organizer shares a link or QR code (WhatsApp, SMS…), or invites people already on Tripley by phone number or email. They tap Accept.
- **Bills split for you.** Whoever paid adds the bill, taps who had which item, and Tripley works out every share: shared items, tax, service, tip, discounts, other currencies. No maths.
- **Settle up.** "You owe Maya ₹1,240" → **Pay** opens UPI / Venmo / PayPal / Revolut / Cash App / Wise with the amount filled in → **Mark as paid** → Maya taps **Got it**.
- **Free + Pro.** Everything is free except **AI receipt reading** (Tripley Pro): snap the receipt and the items, prices, tax and tip are filled in.

One codebase (Expo / React Native) runs on iPhone, Android and the web. Backend is Supabase (Postgres, Auth, Realtime, Storage, Edge Functions).

| Sign in | Invite | Live map | Who had what |
|---|---|---|---|
| ![Sign in](docs/screenshots/sign-in.png) | ![Invite](docs/screenshots/invite.png) | ![Map](docs/screenshots/map.png) | ![Bill editor](docs/screenshots/bill-editor.png) |
| **Join by link** | **Balances** | **Settle up** | **Notifications** |
| ![Join](docs/screenshots/join.png) | ![Balances](docs/screenshots/balances.png) | ![Settle up](docs/screenshots/settle-up.png) | ![Notifications](docs/screenshots/notifications.png) |

<sub>Screenshots from the web build during the end-to-end test. The map background is blank because map tiles were blocked in the test environment.</sub>

---

## How it fits together

```
 iPhone / Android app ─┐                         ┌─ Postgres (tables + Row Level Security)
 (background location) │   Supabase              ├─ Auth (phone SMS via Twilio Verify, email code, Google, Apple)
                       ├──────────────────────── ├─ Realtime (map dots, bills, payments update live)
 Web app (browser) ────┘                         ├─ Storage (receipt photos, private per trip)
                                                 └─ Edge Functions
                                                     ├─ scan-receipt ──> Claude (AI receipt reading, Pro only)
                                                     ├─ send-push ────> Expo push (APNs / FCM)
                                                     └─ revenuecat-webhook <── RevenueCat (App Store, Google Play, Stripe)
```

- **Who can see what** is enforced in the database (`supabase/migrations`): only trip members see a trip's people, locations, bills and payments; you can only write your own location while you're sharing and the trip is on; bills are written through `save_bill()`, which checks that all the shares add up and the exchange rate matches.
- **Splitting** happens in `src/lib/split.ts` using whole cents and the largest-remainder method, so shares always add up exactly (100 split three ways is 34/33/33). Balances are netted per pair of people in `src/lib/balances.ts`.
- **Location** (`src/location`): on phones a background task (`expo-location` + `expo-task-manager`) uploads your latest position (only the latest is kept, no history). In browsers, location only updates while the page is open; the app says so and suggests installing.

### Limits worth knowing

- **Browser-only users** share only while the page is open. Browsers don't allow background location.
- **iPhone:** if someone force-quits the app (swipes it away), iOS can stop updates until it's opened again. Friends see "last seen 25 min ago" and the person gets a "tap to resume" reminder (`nudge_stale_sharers()`, every 15 min).
- **Android:** some brands' battery savers (Xiaomi, Samsung, OnePlus…) kill background apps. Ask people to turn off battery optimization for Tripley.

---

## Repository layout

```
src/app/                 Screens (Expo Router). trip/[id]/(tabs) = Map, Bills, Balances, People
src/components/          UI kit, map (native + web), pickers
src/lib/                 split engine, balances, currency, pay links, API, queries
src/location/            background task (native), foreground sharing (web)
src/providers/           auth + location-sharing state
src/purchases/           RevenueCat (Pro)
src/notifications/       push registration (native)
supabase/migrations/     schema, access rules, server functions, scheduled jobs
supabase/functions/      scan-receipt, send-push, revenuecat-webhook (Deno)
supabase/config.toml     auth providers, redirect URLs, function settings
tests/unit/              split / balances / currency / pay links (Vitest)
tests/db/                database + access rules, on a local Postgres
public/.well-known/      iOS universal links + Android app links (fill in your IDs)
```

---

## What you need (accounts and keys)

| Resource | What for | Cost (approx., check current pricing) |
|---|---|---|
| Supabase project | Database, login, realtime, storage, functions | Free tier to build; Pro ~$25/month at launch |
| Twilio account + **Verify** service | SMS login codes | Pay per verification (~$0.05, varies by country) |
| Apple Developer Program | iPhone app, TestFlight, Sign in with Apple, push | $99/year |
| Google Play Console | Android app | $25 one-time |
| Expo account (EAS) | Cloud builds for iOS/Android, push service | Free tier |
| Anthropic API key | AI receipt reading (Pro) | ~$0.03 per receipt with `claude-opus-5-5` |
| RevenueCat (+ Stripe for web) | Pro subscriptions on App Store, Play, web | Free up to a revenue threshold; store fees 15–30% |
| Google Cloud OAuth client | "Continue with Google" | Free |
| A domain (e.g. tripley.app) | Invite links that open the app | ~$10–20/year |
| Vercel (or any static host) | The web app | Free to start |
| Map tiles | Map | OpenFreeMap is used by default (free, no key); MapTiler optional |

---

## Setup

### 1. Install

```bash
npm install
cp .env.example .env.local   # then fill it in (step 3)
```

### 2. Supabase

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push                     # creates tables, access rules, functions, jobs
npx supabase functions deploy scan-receipt send-push revenuecat-webhook
npx supabase secrets set ANTHROPIC_API_KEY=... REVENUECAT_WEBHOOK_SECRET=... PUSH_WEBHOOK_SECRET=...
```

Optional function settings: `ANTHROPIC_MODEL` (default `claude-opus-5-5`), `ANTHROPIC_EFFORT` (default `low`), `AI_SCAN_MONTHLY_LIMIT` (default `60`), `EXPO_ACCESS_TOKEN` (if you turn on Expo push security), `REVENUECAT_ENTITLEMENT_ID` (default `pro`).

In the Supabase dashboard:

1. **Authentication → Providers**
   - **Phone:** enable, SMS provider **Twilio Verify** (Account SID, Auth Token, Verify Service SID).
   - **Email:** enable. In **Email Templates → Magic Link**, include `{{ .Token }}` so people get a 6-digit code.
   - **Google:** client ID + secret from Google Cloud.
   - **Apple:** Services ID (web) and your bundle ID `app.tripley` (native) as client IDs, plus the secret key.
   - Turn on **manual identity linking** if you want people to add email/Google to a phone account.
2. **Authentication → URL configuration:** Site URL `https://YOUR_DOMAIN`, redirect URLs `tripley://**` and `https://YOUR_DOMAIN/**`.
3. **Database → Webhooks → Create:** table `notifications`, event `INSERT`, type *Supabase Edge Functions*, function `send-push`, header `x-webhook-secret: <PUSH_WEBHOOK_SECRET>`. This turns every notification into a push.
4. **Database → Extensions:** make sure `pg_cron` is enabled (the migration schedules the stale-location reminder and the location clean-up when it is).

`supabase/config.toml` has the same auth settings for `supabase config push` / local development.

### 3. App configuration (`.env.local`)

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API (publishable key) |
| `EXPO_PUBLIC_APP_DOMAIN` | Your domain, e.g. `tripley.app` (invite links: `https://<domain>/join/<code>`) |
| `EXPO_PUBLIC_MAP_STYLE_URL` | Optional; defaults to OpenFreeMap |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `_ANDROID_KEY` / `_WEB_KEY` | RevenueCat public SDK keys |
| `TRIPLEY_BUNDLE_ID` | Defaults to `app.tripley` |
| `EAS_PROJECT_ID` | From `npx eas-cli init` (needed for push notifications) |

### 4. Run it

```bash
npx expo start --web          # web app at http://localhost:8081
```

Phones need a **development build** (background location, maps and in-app purchases don't run in Expo Go):

```bash
npx eas-cli@latest init
npx eas-cli@latest build --profile development --platform ios
npx eas-cli@latest build --profile development --platform android
npx expo start --dev-client
```

### 5. Pro (RevenueCat)

1. Create products in App Store Connect and Google Play (e.g. monthly `tripley_pro_monthly`), and a Stripe product for web (RevenueCat Web Billing).
2. In RevenueCat: entitlement **`pro`**, an offering containing those packages, and the public SDK keys above.
3. **Integrations → Webhooks:** URL `https://YOUR_PROJECT.supabase.co/functions/v1/revenuecat-webhook`, Authorization header `Bearer <REVENUECAT_WEBHOOK_SECRET>`.

The app logs in to RevenueCat with the Supabase user id; the webhook keeps `accounts.plan` in sync and `scan-receipt` checks it.

### 6. Links that open the app

Fill in `public/.well-known/apple-app-site-association` (your Apple Team ID) and `public/.well-known/assetlinks.json` (your Android signing certificate SHA-256, from `npx eas-cli credentials`), deploy the web app to your domain, and set `EXPO_PUBLIC_APP_DOMAIN`. Invite links then open the app when it's installed, and the website otherwise.

### 7. Deploy the web app

`vercel.json` is included: import the repo in Vercel, add the `EXPO_PUBLIC_*` variables, deploy, and point your domain at it. Or host everything on Railway (next section).

---

## Hosting on Railway (current live setup)

Tripley runs in the Railway project **tripley**: the open-source Supabase stack plus the website, all in one project.

| Service | What it is |
|---|---|
| `db` | Postgres (Supabase image) with a volume |
| `auth`, `rest`, `realtime`, `storage`, `meta`, `functions` | Supabase's sign-in, REST API, live updates, file storage (volume), dashboard backend, edge runtime |
| `studio` | The Supabase dashboard |
| `supabase` | Gateway: the public API URL (`https://supabase-production-….up.railway.app`), and Studio behind a login |
| `web` | This repo: built with `npx expo export --platform web`, served by `scripts/serve-web.cjs` |

**How a deploy works.** Pushing to the deployed branch rebuilds `web`. Before the new version goes live, Railway runs the pre-deploy command `node scripts/migrate.cjs`. It applies any new file in `supabase/migrations/` once, recorded in `supabase_migrations.schema_migrations` (the Supabase CLI's table). If a migration fails, the deploy stops and the old version keeps running.

**`web` variables:**

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:${{db.POSTGRES_PASSWORD}}@${{db.RAILWAY_PRIVATE_DOMAIN}}:5432/postgres` (server-side, migrations only) |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://${{supabase.RAILWAY_PUBLIC_DOMAIN}}` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Public anon key, printed in the `supabase` gateway's deploy logs |
| `EXPO_PUBLIC_AUTH_METHODS` | `guest` |
| `EXPO_PUBLIC_APP_DOMAIN` | `${{RAILWAY_PUBLIC_DOMAIN}}` |

**`auth` variables:**

| Variable | Value |
|---|---|
| `GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED` | `true` |
| `GOTRUE_EXTERNAL_EMAIL_ENABLED` | `false` |
| `GOTRUE_SITE_URL` | The `web` URL |
| `GOTRUE_URI_ALLOW_LIST` | `https://<web>/**,tripley://**,http://localhost:8081/**` |

To add phone sign-in later, set the `GOTRUE_EXTERNAL_PHONE_ENABLED` and `GOTRUE_SMS_*` (Twilio Verify) variables there, then add `phone` to `EXPO_PUBLIC_AUTH_METHODS`.

**Studio (database dashboard).** Open the `supabase` gateway URL and log in as `supabase` with `DASHBOARD_PASSWORD`, which is in that service's variables in Railway.

**Cost.** Usage-based on Railway's Hobby plan. With all nine Supabase services the template's author estimates $20–40/month; light use is usually lower. Check *Usage* in the Railway dashboard.

**Backups.** Self-hosted means backups are on you. Railway volume backups can be enabled on the `db` volume.

---

## Testing

```bash
npm test                 # split engine, balances, currency, pay links (Vitest)
npm run test:db          # schema + access rules + server functions on a local Postgres 16
npm run functions:check  # type-check the edge functions with Deno
npm run typecheck        # type-check the app
npm run export:web       # production web build into dist/
```

`npm run test:db` needs the Postgres 16 server binaries (`/usr/lib/postgresql/16/bin`, or set `PGBIN`). It starts a throwaway database, loads a small stand-in for Supabase's `auth`/`storage` schemas (`tests/db/supabase-stub.sql`) and the real migrations, then acts as different users.

### End-to-end test (three people, three browsers)

`tests/e2e/trip-flow.cjs` drives the whole story against the web app and a local Supabase:

1. Maya signs up with her phone number and creates a trip in INR.
2. Sam opens the invite link signed out, signs up, and lands back on the invite to join.
3. Maya invites Lee by phone number, and Lee accepts in the app.
4. All three share location, and Maya's map shows all three.
5. Maya adds a dinner bill (pizza for everyone, beer for Sam, tax). The preview shows Sam owes ₹1,854.54.
6. Sam taps Pay → Mark as paid.
7. Maya taps Got it. Maya is still owed ₹872.73 by Lee.
8. Sam is notified that Maya confirmed.

To run it locally:

1. In `supabase/config.toml`, add test phone numbers so no SMS is sent:
   ```toml
   [auth.sms.test_otp]
   15550000001 = "123456"
   15550000002 = "123456"
   15550000003 = "123456"
   ```
   Then set dummy Twilio values (`TWILIO_ACCOUNT_SID`, `TWILIO_VERIFY_SERVICE_SID`, `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN`) in your shell.
2. Run `npx supabase start`.
3. Run `npx expo start --web` with `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and the local publishable key.
4. Run `npm run test:e2e`.

---

## App store notes

Both stores review background location. Suggested wording for the review notes / Play declaration:

> Tripley shows the live location of friends who are on a trip together. Location is shared only with members of trips the user has joined, only while the trip is active, and can be paused at any time from the map. The app needs background location so friends can still see each other when the phone is locked or the app is closed. Only the latest position is stored, and it is deleted 24 hours after the trip ends.

Google Play also asks for a short video showing the in-app explanation and permission prompt (Map tab → "Turn on location").

You'll also need a privacy policy covering location, phone numbers, receipt photos and payments.
