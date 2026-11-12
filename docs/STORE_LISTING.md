# Tripley: App Store and Google Play listing

A starting point for the store listings (from docs/COMPLETE_ANALYSIS.md, Growth: "App Store / Play Store listing optimization"). Character limits are the stores' current ones; check them in App Store Connect and the Play Console when you submit. Everything described here is in the app today; don't add claims the app can't back up.

## Name and subtitle

| Field | Text | Limit |
|---|---|---|
| App name | Tripley: Group Trip Planner | 30 |
| Subtitle (App Store) | Plan, map and split together | 30 |
| Short description (Play) | Plan group trips together: polls, dates, a live map, bookings and fair bill splits. | 80 |

## Keywords (App Store, 100 characters, comma-separated, no spaces)

`group trip,travel planner,split bills,itinerary,friends map,expense,polls,packing list,bookings,share`

Avoid competitor names in keywords (Apple rejects them).

## Description

> Group trips without the "where are you?" texts and the spreadsheet at the end.
>
> **Decide together.** Suggest places, vote, run polls (one choice, several or ranked) and put the winner into the plan in two taps. Find the days everyone can go on a shared calendar.
>
> **One plan for everyone.** A day-by-day itinerary with times, places and directions; see who's coming, spot clashes and get the best walking order. Keep flights, stays and tickets in one place, with booking codes and files you can open offline.
>
> **Find each other.** While the trip is on, see your friends on a live map, get a finder arrow in crowds and an alert when someone arrives at the hotel. Sharing stops by itself when the trip ends, and you can pause any time.
>
> **Split every bill fairly.** Tap who had what; Tripley handles shared dishes, tax, tip, discounts and other currencies, then shows who owes whom. Pay with UPI, Venmo, Zelle, PayPal, Revolut, Monzo, Wise, Pix, PromptPay or a SEPA QR code.
>
> **Rooms, packing and more.** Pick beds and split the stay by room, get packing suggestions for the weather, share group tasks, and keep a recap of the trip.
>
> Free for the whole group. Tripley Pro adds AI helpers: reading receipts and booking confirmations, and drafting a plan from your bucket list.

## Screenshots (in this order)

1. The trip overview (cover, countdown, what's next).
2. The live map with friends and a pinned hotel.
3. Find dates: the heat-map calendar with the best dates.
4. A decided poll with "Add to the plan".
5. The bill editor ("who had what").
6. Settle up with a pay link or QR code.
7. Bookings and documents (with "Keep offline").
8. Rooms and beds.

Use real-looking demo trips (no real people's names or locations). Sizes: iPhone 6.9" and 6.5", iPad if supported; Play: phone and 7"/10" tablet if supported.

## Privacy answers (App Privacy / Data safety)

Match these to the Privacy Policy (`src/lib/legal.ts`); update both together.

| Data | Collected | Linked to the person | Purpose | Notes |
|---|---|---|---|---|
| Name, email, phone (sign-in) | Yes | Yes | App functionality, account | Phone only with phone sign-in |
| Precise location | Yes (only while sharing is on and a trip is on) | Yes | App functionality | Latest position only; deleted when the trip ends or you leave |
| Photos and files | Yes (what you choose to upload) | Yes | App functionality | Receipts, trip photos, booking documents |
| Financial info | Yes (bills, payment handles you add) | Yes | App functionality | No card or bank logins |
| Purchase history | Yes (Pro status) | Yes | App functionality | Via the store and RevenueCat |
| User content | Yes (plans, posts, polls, bookings) | Yes | App functionality | |
| Contacts | No | | | Only the one number you pick is used, not uploaded |
| Identifiers | Yes (push token) | Yes | App functionality | |
| Diagnostics / analytics / ads | No | | | No analytics or ad SDKs |

Tracking: **No** (no data used to track across other companies' apps). Data deletion: in the app (Profile → Delete account).

## Review notes

- Give reviewers a demo account with a trip already set up (two members, a few bills and a plan), and say that location sharing needs a second device or the demo account's trip to show others on the map.
- Background location: explain it's only while a trip is on and sharing is on, shows on the map for the trip's members, and stops when the trip ends (Apple asks for this in the review notes and the purpose string).
- Pro: list the products and say the AI helpers send only what the person asks them to read or draft.
