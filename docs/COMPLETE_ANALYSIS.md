# Tripley — Complete Analysis, Security Review, Competitive Research & Product Roadmap

**Prepared:** November 2026  
**Repository:** https://github.com/yashik1/Tripley  
**Branch:** `claude/tender-johnson-cscqn1`  
**Live demo:** https://web-production-f080e3.up.railway.app

This document consolidates everything: security findings, competitive landscape, product improvement plan, technical recommendations, and growth strategy. Share this single file with Claude (or any implementer) to drive changes.

> **Status, 12 November 2026 (implemented on `claude/tender-johnson-cscqn1`).**
> - Done: **1.1** polls from bucket-list ideas and "add the winner to the plan" in two taps, on top of the existing single/multiple-choice polls with live results and editing; **1.2** date coordination (`/trip/[id]/dates`); **1.3** a quick start for people who just joined (map or bill in one tap, plus what's shared and how to pause); **1.4** the phone session in `expo-secure-store` (needs a new native build).
> - Security checklist: secrets scanning is in CI (gitleaks); every production deploy now re-checks function privileges and that private buckets stay private (`scripts/migrate.cjs`). The npm advisories listed below are fixed (`npm audit`: 0).
> - Still open: email confirmation and password-reset email need SMTP (see README); ranked/swipe voting; Phase 2 and 3.

---

# Part 1 — Product Overview

## What Tripley is

Group trips without the "where are you?" texts and the spreadsheet at the end.

One codebase (Expo / React Native) runs on iPhone, Android and the web. Backend is Supabase (Postgres, Auth, Realtime, Storage, Edge Functions).

### Core features

- **Live map** — Everyone on the trip sees each other, even with the app closed (iPhone & Android). Pause anytime; sharing stops automatically when the trip ends.
- **Places, pins and arrival alerts** — Pin hotel, airport, meeting point, finds or photo memories. Arrival alerts notify the group (rate-limited, per-person opt-out).
- **Find a lost friend** — Big arrow + distance/direction using the phone compass.
- **Invite by link or in-app** — Link, QR, phone number or email. Accept flow.
- **Bills split for you** — Item-level assignment, shared items, tax, service, tip, discounts, multi-currency. Proximity auto-suggest ("Split between the 2 of you here"). Locked exchange rates (ECB or manual).
- **Settle up** — Regional payment deep links (UPI / PhonePe / Paytm, Venmo / Zelle / Cash App, Revolut / Monzo / Wise / PayPal, SEPA QR).
- **Cash kitty** — Pool cash, spend, hand over; flows into balances.
- **Shared plan** — Day-by-day itinerary, Going / Maybe / Not going, comments, clash detection, walking-route optimization (no paid routing API).
- **Activity feed, bucket list, polls, packing/tasks, travel passport & memories**.
- **Offline** — Service worker + local cache; bills queue and send exactly once when back online.
- **Accounts** — Email/password, guest mode (upgrade later without losing data), optional phone/Google/Apple.
- **Free + Pro** — Everything free except AI receipt reading (Tripley Pro).

### Key technical areas

| Area | Location |
|------|----------|
| Split engine | `src/lib/split.ts`, `src/lib/balances.ts` |
| Location | `src/location/` |
| Itinerary | plan screens + related migrations |
| Edge functions | `supabase/functions/scan-receipt`, `revenuecat-webhook`, `send-push` |
| Security hardening | `docs/SECURITY_REVIEW.md`, migration `20261110000000_security_hardening.sql` |
| Auth / providers | `src/providers/`, Supabase Auth |
| Offline / cache | `src/lib/cache-policy.ts`, `src/lib/device-data.ts`, outbox |

---

# Part 2 — Security Assessment

## Overall posture

Solid for a consumer app of this complexity. Access control is primarily database-enforced via Row Level Security. Money-critical paths use atomic DB functions with locking. Edge functions verify callers before using the service role. No secrets in tracked files or the public client bundle. CI runs typecheck, lint, unit/DB tests, builds, and browser suites.

A thorough security review was already performed (see `docs/SECURITY_REVIEW.md`, November 2026). Many high/medium issues were fixed via migrations and shared edge-function code.

## Strengths

- RLS + SECURITY DEFINER functions for membership, bills (`save_bill()` with share-sum and rate validation), location writes.
- Money integrity: integer minor units + largest-remainder allocation; kitty row locks; AI scan quota atomic reserve/finish/release; RevenueCat webhook idempotent via event-ID table.
- Storage: size/type limits (JPEG/PNG/WebP), path validation, rate limits, short-lived signed URLs.
- Location privacy: only latest position; visibility tied to active trip + sharing; purge on trip end.
- Client offline cache: sensitive data excluded; account-tagged; cleared on sign-out / account switch.
- Web security headers: CSP, frame denial, HSTS, Permissions-Policy.
- Edge functions: image magic-byte sniffing, body size limits, generic errors, no sensitive logging.
- Dependency overrides for known moderate issues; CI fails on high/critical advisories.

## Remaining residual risks

| Severity | Issue | Recommendation |
|----------|--------|----------------|
| Medium | Device storage not encrypted (session + offline cache in AsyncStorage/localStorage) | Move session to `expo-secure-store` (requires native rebuild) |
| Medium | Email enumeration on sign-up while auto-confirm is on | Enable SMTP + email confirmation (`GOTRUE_MAILER_AUTOCONFIRM=false`) |
| Low–Medium | Production privilege/Storage behaviour not re-verified on live DB after migrations | Re-run privilege snapshot + Storage API checks on production after deploy |
| Low | In-memory IP limiter for AI scans (per instance) | DB per-user limit is the real control; acceptable for now |
| Low | Webhook secret strength / docs drift | Keep ≥16 char secret; confirm Authorization scheme against current RevenueCat docs |
| Info | No dedicated secrets scanner in CI | Consider gitleaks or similar |
| Info | ~~Moderate npm advisories remain in Expo CLI tooling~~ Fixed 12 Nov 2026 with overrides (`npm audit`: 0) | Track Expo upgrades |

## Security implementation checklist (still open)

- [x] Move auth session to `expo-secure-store`
- [ ] Confirm `GOTRUE_PASSWORD_MIN_LENGTH=8` and (when ready) turn on email confirmation in production Auth
- [ ] Redeploy edge functions after shared-code changes and verify secrets
- [x] Run privilege + Storage checks on the live project post-migration (on every deploy)
- [x] Optional: add secrets scanning step to CI

Reference patterns: `docs/SECURITY_REVIEW.md` and migration `supabase/migrations/20261110000000_security_hardening.sql`.

---

# Part 3 — Competitive Landscape (2026)

## Market context

- Group travel planning apps market ≈ $520M (2025), ~7.5% CAGR.
- Bill-splitting / group-expense market larger and faster-growing; group travel is a major use case (~30% of splits in some reports).
- Groups still default to WhatsApp + Google Docs/Sheets + Splitwise.
- Free tiers are table stakes; monetization usually via Pro (AI, offline, advanced routing, unlimited scans).

## Competitor categories

| Category | Leading apps | Strengths | Weaknesses vs Tripley |
|----------|--------------|-----------|------------------------|
| Decision / voting first | TripRelay, SwipeSights, TRIPTI.ai, AvoSquado | Low-friction join, structured voting that generates itineraries | Weak or no live location; weaker real-time money & offline |
| Map / itinerary builders | Wanderlog (most mentioned), Stippl, Huvver, Lambus, Roadtrippers | Excellent maps, route optimization, booking import | Limited structured voting; location sharing rare or absent; expense tools often basic |
| Booking consolidators | TripIt | Email → clean itinerary | Almost no group collaboration or money tools |
| Expense specialists | Splitwise (category leader), Tricount, Splid, Settle Up | Network effects, multi-currency, settle-up | No planning, no location, no itinerary |
| All-in-one / emerging | TripProf, Triplly, FlowTrip, Trips Together, Claira, WePlanify | Broader feature sets, some AI | Most lack Tripley’s real-time location depth and proximity-aware splitting |

## Tripley’s positioning opportunity

**Unique angle:**  
The only app that keeps the group together *during* the trip (live map + find friend + arrival alerts) *and* settles the money fairly without spreadsheets, while still covering planning.

Most competitors are strong either pre-trip (voting/itinerary) or post-trip (expenses). Few own the *during* experience as well as Tripley does.

---

# Part 4 — Product Improvement Roadmap

## Phase 1 — Highest ROI (do first)

### 1.1 Structured voting & decision layer (P0)

**Why:** Many trips die in group chat. Competitors win on structured decision-making.

**What to build:**
- Elevate existing polls + bucket list into a first-class decision flow
- Support single-choice, multi-choice, and ranked/swipe-style voting where useful
- One-action "add winners / favourites to plan" that respects existing plan ordering rules
- Live results; organizer or poll creator can close/edit while open
- Optional: auto-suggest day placement after voting

**Acceptance criteria:**
- Group can create a poll from bucket list or free-form options
- Results update live
- "Add winners to plan" works in ≤ 2 taps
- Works offline for reading; writes sync when online

**Relevant existing code:** polls migrations, bucket list, plan screens, activity feed.

### 1.2 Date coordination (P0)

**Why:** Second biggest trip-killer after "what should we do".

**What to build:**
- Availability / "when can you go" grid or calendar multi-select per member
- Surface overlap windows
- Allow locking dates even without 100% consensus (organizer or majority rule)
- Push/reminder to fill availability

**Acceptance criteria:**
- Members submit free/busy or preferred ranges
- Clear visualization of best windows
- One-tap "set trip dates from this window"
- Non-blocking for people who can’t make it

### 1.3 Onboarding & guest → account conversion (P0)

**Why:** Viral loop depends on low-friction join.

**What to build / fix:**
- Ensure invite link → guest join → first value (see map or add bill) in < 60 seconds
- Seamless upgrade to full account without losing trips, bills, or location state
- Clear empty states and progressive disclosure
- Better first-run explanation of live location (privacy + how to pause)

**Acceptance criteria:**
- New user via invite reaches map or bill screen extremely quickly
- Account conversion preserves all data
- No dead-ends for guests

### 1.4 Secure session storage (P1 — security)

**Why:** Current AsyncStorage/localStorage is readable on compromised devices.

**What to build:**
- Move Supabase session to `expo-secure-store` on native
- Clear secure storage on sign-out
- Document that this requires a new native build

**Acceptance criteria:**
- Session no longer in plain AsyncStorage on iOS/Android
- Sign-out and account-switch still clear everything correctly
- Existing offline cache policy remains intact

---

## Phase 2 — Medium-term differentiation

### 2.1 Booking & document hub
- Email forwarding address or screenshot import for flights/hotels/tickets
- Trip vault (documents + offline access)
- Link bookings to plan stops where possible

### 2.2 Deeper AI (beyond receipt scan)
- AI first-draft itinerary from votes + preferences + destination
- Clash resolution suggestions
- Packing suggestions (destination + weather + trip length)
- Smart settle-up reminders
- Keep Pro gating consistent with current AI scan model

### 2.3 Accommodation helpers
- Bedroom / bed assignment for shared rentals (strong for bachelor/bachelorette & family trips)
- Optional cost split by room type

### 2.4 Stronger offline & performance
- Expand offline-first patterns for itinerary and bills
- Battery / background-location messaging improvements for Android OEMs
- Low-end Android performance pass

---

## Phase 3 — Growth & scale features

- Light social / templates ("public trip ideas" or reusable templates) with strict privacy defaults
- Organizer analytics (who’s sharing location, payment status, engagement)
- More regional payment methods + i18n expansion
- Referral rewards (extra AI scans / free Pro month)
- Possible one-time "Trip Pass" in addition to subscription

---

# Part 5 — Technical Guardrails (must follow when implementing)

1. **Money integrity** — All balance, kitty, bill, and scan-quota changes must stay atomic (DB functions + locks). Never trust client-side totals.
2. **RLS first** — New tables get RLS from day one. Prefer `SECURITY DEFINER` functions with explicit grants over broad client writes.
3. **No secrets in client** — Only `EXPO_PUBLIC_*` values in the app bundle.
4. **Idempotency** — Use `client_id` / `request_id` patterns already established for bills, kitty, and AI scans.
5. **Location privacy** — Only latest position; visibility tied to active trip + sharing state; purge on trip end.
6. **Tests** — Add unit tests for pure logic and DB tests for RLS / races (see `tests/db/` and `tests/unit/`).
7. **Migrations** — Forward-only. Follow existing timestamp naming in `supabase/migrations/`.
8. **Edge functions** — Keep shared logic in `supabase/functions/_shared/`. Verify JWT or shared secret before using service role.

Always read existing related migrations and `src/lib/` helpers first. Prefer extending current tables/flows over inventing parallel systems. Do not break existing bill, kitty, location, or auth behaviour.

---

# Part 6 — Suggested Implementation Order for Claude

1. **Date coordination** (new tables + simple UI + notifications) — relatively self-contained.
2. **Voting / decision improvements** (extend existing polls + "add to plan" flow).
3. **Onboarding / guest conversion polish** (mostly frontend + AuthProvider / cache policy).
4. **Secure store migration** (native-only change + tests).
5. Then Phase 2 items as capacity allows.

For each feature:
- Write migration(s) with RLS and helper functions.
- Add/adjust TypeScript types and API helpers in `src/lib/`.
- Build screens under `src/app/trip/[id]/...` or appropriate routes.
- Add unit + DB tests.
- Update README feature list and any relevant docs.

### Example prompts to give Claude

> Implement Phase 1.1 (structured voting & decision layer) following the acceptance criteria and technical guardrails in `docs/COMPLETE_ANALYSIS.md`. Start with the migration and API, then the UI. Keep changes minimal and consistent with existing patterns in the polls and plan code.

> Implement date coordination (Phase 1.2) as specified in COMPLETE_ANALYSIS.md.

> Implement secure session storage using expo-secure-store (Phase 1.4), following the security notes and acceptance criteria in COMPLETE_ANALYSIS.md.

---

# Part 7 — Growth & Go-to-Market Strategy

## Positioning

Own the "during the trip" experience (live map + find friend + fair settle-up) while closing the pre-trip decision gap.

## Acquisition levers

- Extremely low-friction invite (link / QR / guest mode)
- SEO & comparison content ("best group trip apps 2027", vs Wanderlog / Splitwise / TripIt)
- Creator partnerships (travel TikTok / Instagram / YouTube group-trip content)
- University / young-professional & backpacker channels
- Regional focus: English-speaking markets + India (UPI already supported) + Europe (multi-currency + SEPA)

## Retention loops

- Post-trip memories / passport badges → share → next trip
- Settle-up → rate the app / invite for next one
- Referral rewards (extra AI scans or free Pro month)

## Key metrics to watch

- Invite → join conversion
- % of trips that use both location *and* expenses
- Group (not just individual) 7/30-day retention
- Time-to-first-value for new invitees
- Pro conversion rate and AI scan usage
- Organic vs paid acquisition cost

## Monetization notes

- Keep core free (location + basic split + plan).
- Pro: AI scans + advanced AI planning, offline maps / premium tiles, unlimited history, priority support, team/family plans.
- Consider a one-time "Trip Pass" model (seen in competitors) for groups that don’t want subscriptions.

---

# Part 8 — Explicit Non-Goals (for now)

- Full marketplace or public trip discovery (privacy risk, different product)
- Replacing WhatsApp chat entirely (nice-to-have later; not core)
- Complex enterprise / corporate features until consumer base is solid
- Paid map routing APIs unless free alternatives become insufficient

---

# Part 9 — Quick Reference Checklist

### Security still open
- [x] expo-secure-store for session
- [ ] Email confirmation once SMTP is ready
- [x] Production privilege + Storage re-check after migrations
- [x] Optional secrets scanning in CI

### Product Phase 1
- [x] Structured voting / decision layer + add-to-plan (ranked voting not built)
- [x] Date coordination
- [x] Onboarding & guest conversion polish
- [x] Secure session storage

### Product Phase 2
- [ ] Booking / document hub
- [ ] Deeper AI (itinerary draft, packing, etc.)
- [ ] Accommodation (bedroom assignment)
- [ ] Stronger offline & performance

### Growth
- [ ] App Store / Play Store listing optimization
- [ ] Comparison / SEO content
- [ ] Creator & campus channels
- [ ] Referral loop

---

# Part 10 — Document History

- 2026-11-11: Initial complete analysis created from security review, competitive research, product audit, and growth recommendations. Combines content previously in SECURITY_REVIEW.md and PRODUCT_ROADMAP.md into one shareable file.

---

**End of document.**  
Share this file as-is with Claude or any implementer. Point them at the specific Phase or section you want executed first.
