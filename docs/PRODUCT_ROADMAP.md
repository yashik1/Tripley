# Tripley Product Roadmap & Competitive Plan

**Date:** November 2026  
**Purpose:** Single source of truth for product improvements, competitive positioning, and growth. Share this file with Claude (or any implementer) to drive changes.

---

## 1. Current Product Snapshot

**Tagline:** Group trips without the "where are you?" texts and the spreadsheet at the end.

**Core strengths (moats):**
- Live background location sharing (iOS/Android) + "find a lost friend" compass + arrival alerts
- Sophisticated bill splitting (item-level, tax/tip/discount, locked FX rates, proximity auto-suggest)
- Cash kitty with row locking and balance integration
- Shared day-by-day itinerary with RSVPs, clash detection, walking-route optimization (no paid routing API)
- Offline support, activity feed, bucket list + polls, packing/tasks, travel passport
- Strong RLS + atomic money operations + recent security hardening
- One codebase: Expo/React Native → iOS, Android, web. Backend: Supabase

**Live:** https://web-production-f080e3.up.railway.app  
**Repo branch in use:** `claude/tender-johnson-cscqn1`

**Key code areas:**
- Split engine: `src/lib/split.ts`, `src/lib/balances.ts`
- Location: `src/location/`
- Itinerary: recent migrations + `src/lib/itinerary.ts` / plan screens
- Edge functions: `supabase/functions/scan-receipt`, `revenuecat-webhook`, `send-push`
- Security review: `docs/SECURITY_REVIEW.md`

---

## 2. Competitive Landscape (2026)

Most groups still use WhatsApp + Google Docs/Sheets + Splitwise. Dedicated apps specialize:

| Category | Examples | Strengths | Gaps vs Tripley |
|----------|----------|-----------|-----------------|
| Decision / voting | TripRelay, SwipeSights, TRIPTI.ai, AvoSquado | Low-friction join, structured voting → itinerary | Weak live location & real-time money |
| Map / itinerary | Wanderlog, Stippl, Huvver, Lambus, Roadtrippers | Maps, route optimization, booking import | Limited voting; almost no live location |
| Booking consolidator | TripIt | Email → clean itinerary | Almost no group collab or money |
| Expense only | Splitwise, Tricount, Splid | Network effects, multi-currency | No planning, no location |
| Emerging all-in-ones | TripProf, Triplly, FlowTrip, Trips Together | Broader features + some AI | Rarely match Tripley’s location depth |

**Market notes:**
- Group travel planning apps ≈ $520M (2025), ~7.5% CAGR
- Bill-splitting / group-expense market larger and growing faster; group travel is a major use case
- Common pain: decision paralysis, money fights, "where is everyone?", tool fragmentation
- Free tier is table stakes; monetization via Pro (AI, offline, advanced features)

**Tripley’s unique positioning opportunity:**  
"The only app that keeps the group together *during* the trip (live map + find friend + arrival alerts) *and* settles money fairly, while still covering planning."

---

## 3. Prioritized Product Roadmap

### Phase 1 — Highest ROI (do first)

These close the biggest competitive gaps and improve acquisition/activation.

#### 1.1 Structured voting & decision layer (P0)
**Why:** Many trips die in group chat. Competitors (TripRelay, SwipeSights) win on this.

**What to build:**
- Improve existing polls + bucket list into a first-class decision flow
- Support: single choice, multi-choice, ranked/swipe-style voting where useful
- Turn winning votes / bucket-list favourites into plan stops with one action (already partially possible — make it seamless and visible)
- Live results, ability for organizer or poll creator to close/edit while open
- Optional: auto-suggest day placement after voting

**Acceptance criteria:**
- Group can create a poll from bucket list or free-form options
- Results update live
- "Add winners to plan" works in ≤ 2 taps and respects existing plan ordering rules
- Works offline for reading; writes sync when online

**Relevant existing code:** polls migrations, bucket list, plan screens, activity feed.

#### 1.2 Date coordination (P0)
**Why:** Second biggest trip-killer after "what should we do".

**What to build:**
- Simple availability / "when can you go" grid or calendar multi-select per member
- Surface overlap windows
- Allow locking dates even without 100% consensus (organizer or majority rule)
- Push/reminder to fill availability

**Acceptance criteria:**
- Members submit free/busy or preferred ranges
- Clear visualization of best windows
- One-tap "set trip dates from this window"
- Non-blocking for people who can’t make it

#### 1.3 Onboarding & guest → account conversion (P0)
**Why:** Viral loop depends on low-friction join.

**What to build / fix:**
- Guest mode already exists — ensure invite link → guest join → first value (see map or add bill) in < 60 seconds
- Seamless upgrade to full account without losing trips, bills, or location history
- Clear empty states and progressive disclosure
- Better first-run explanation of live location (privacy + how to pause)

**Acceptance criteria:**
- New user via invite reaches map or bill screen extremely quickly
- Account conversion preserves all data
- No dead-ends for guests

#### 1.4 Secure session storage (P1 — security)
**Why:** Current AsyncStorage/localStorage is readable on compromised devices.

**What to build:**
- Move Supabase session to `expo-secure-store` on native
- Clear secure storage on sign-out
- Document that this requires a new native build

**Acceptance criteria:**
- Session no longer in plain AsyncStorage on iOS/Android
- Sign-out and account-switch still clear everything correctly
- Existing offline cache policy (from security review) remains intact

---

### Phase 2 — Medium-term differentiation

#### 2.1 Booking & document hub
- Email forwarding address or screenshot import for flights/hotels/tickets
- Trip vault (documents + offline access)
- Link bookings to plan stops where possible

#### 2.2 Deeper AI (beyond receipt scan)
- AI first-draft itinerary from votes + preferences + destination
- Clash resolution suggestions
- Packing suggestions (destination + weather + trip length)
- Smart settle-up reminders
- Keep Pro gating consistent with current AI scan model

#### 2.3 Accommodation helpers
- Bedroom / bed assignment for shared rentals (strong for bachelor/bachelorette & family trips)
- Optional cost split by room type

#### 2.4 Stronger offline & performance
- Offline-first itinerary and bills (expand existing outbox patterns)
- Battery / background-location messaging improvements for Android OEMs
- Low-end Android performance pass

---

### Phase 3 — Growth & scale features

- Light social / templates ("public trip ideas" or reusable templates) with strict privacy defaults
- Organizer analytics (who’s sharing location, payment status, engagement)
- More regional payment methods + i18n expansion
- Referral rewards (extra AI scans / free Pro month)
- Possible one-time "Trip Pass" in addition to subscription

---

## 4. Technical Guardrails (must follow)

1. **Money integrity:** All balance, kitty, bill, and scan-quota changes must stay atomic (DB functions + locks). Never trust client-side totals.
2. **RLS first:** New tables get RLS from day one. Prefer `SECURITY DEFINER` functions with explicit grants over broad client writes.
3. **No secrets in client:** Only `EXPO_PUBLIC_*` values in the app bundle.
4. **Idempotency:** Use `client_id` / `request_id` patterns already established for bills, kitty, and AI scans.
5. **Location privacy:** Only latest position; visibility tied to active trip + sharing state; purge on trip end.
6. **Tests:** Add unit tests for pure logic and DB tests for RLS / races (see `tests/db/` and `tests/unit/`).
7. **Migrations:** Forward-only. Follow existing timestamp naming in `supabase/migrations/`.
8. **Edge functions:** Keep shared logic in `supabase/functions/_shared/`. Verify JWT or shared secret before using service role.

Reference: `docs/SECURITY_REVIEW.md` for recent hardening patterns.

---

## 5. Suggested Implementation Order for Claude

When implementing, prefer this sequence:

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

---

## 6. Growth & GTM Notes (non-code)

**Positioning:** Own the "during the trip" experience (live map + find friend + fair settle-up) while closing the pre-trip decision gap.

**Acquisition levers:**
- Extremely low-friction invite (link/QR/guest)
- SEO & comparison content ("best group trip apps", vs Wanderlog / Splitwise)
- Creator partnerships (travel TikTok/IG/YouTube group-trip content)
- University / young-professional & backpacker channels
- Regional push: English markets + India (UPI) + Europe (multi-currency/SEPA)

**Retention loops:**
- Post-trip memories / passport → share → next trip
- Settle-up → rate/review → invite for next trip
- Referral incentives

**Key metrics:**
- Invite → join conversion
- % of trips that use both location *and* expenses
- Group (not just user) 7/30-day retention
- Time-to-first-value for new invitees
- Pro conversion & AI scan usage

---

## 7. Out of Scope / Explicit Non-Goals (for now)

- Full marketplace or public trip discovery (privacy risk, different product)
- Replacing WhatsApp chat entirely (nice-to-have later; not core)
- Complex enterprise/corporate features until consumer base is solid
- Paid map routing APIs unless free alternatives become insufficient

---

## 8. How to Use This Document with Claude

Copy this entire file (or the relevant Phase section) into the conversation and say, for example:

> Implement Phase 1.1 (structured voting & decision layer) following the acceptance criteria and technical guardrails in `docs/PRODUCT_ROADMAP.md`. Start with the migration and API, then the UI. Keep changes minimal and consistent with existing patterns in the polls and plan code.

Or:

> Implement date coordination (Phase 1.2) as specified in PRODUCT_ROADMAP.md.

Always ask Claude to:
- Read existing related migrations and `src/lib/` helpers first
- Prefer extending current tables/flows over inventing parallel systems
- Add tests
- Not break existing bill, kitty, location, or auth behaviour

---

## 9. Changelog of This Plan

- 2026-11-11: Initial roadmap created from competitive research + security review + current codebase analysis.
