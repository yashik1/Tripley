# Trip Fun rollout and monetization

The Trip Fun hub adds seven optional group activities without adding more bottom-navigation tabs:

- **Spin the Adventure Wheel** — chooses a group activity at random, including food and hunt ideas already saved in Trip Fun.
- **Secret Missions** — private missions visible only to the sender and assigned traveller.
- **Adventure Scavenger Hunt** — a shared checklist of location and photo-friendly challenges.
- **Trip Awards** — eight light-hearted award categories, one vote per person per category, and no self-voting.
- **Trip Soundtrack** — shared song titles, artist names, links and the memory attached to each song. Tripley does not host or stream copyrighted music.
- **Food Explorer** — a shared list of dishes, restaurants and notes.
- **Living Trip Timeline** — a chronological view of Trip Fun entries.

## Database and access control

Apply migrations with the normal deployment process (`node scripts/migrate.cjs` on Railway, or `npx supabase db push` for a linked Supabase project). The migration creates the feature catalogue, entries and award votes.

Secret mission rows are filtered by Postgres RLS: only the creator and assigned traveller can read them. The database validates trip membership, assignment, award voting and feature entitlements; the UI is not the security boundary. Activity details are immutable after creation; completion is the only editable state.

## Monetization plan

All seven features start enabled on the free plan. This lets the group experience the new social loop before introducing a paywall. Keep the wheel, food discoveries and timeline free as repeat-use hooks. When retention and usage data support it, consider making Secret Missions, Scavenger Hunt, Trip Awards and Soundtrack Pro extras.

The existing account entitlement is reused. No new payment product, price, checkout, RevenueCat offering or subscription is created by this feature release.

To move selected features to Pro later, update the catalogue in Supabase:

```sql
update public.trip_feature_catalog
set minimum_plan = 'pro'
where feature_key in (
  'secret_missions',
  'scavenger_hunt',
  'trip_awards',
  'trip_soundtrack'
);
```

To return any feature to free:

```sql
update public.trip_feature_catalog
set minimum_plan = 'free'
where feature_key = 'secret_missions';
```

To temporarily disable a feature for everyone, set `enabled = false`. The database checks the current plan on writes, so hiding or bypassing the UI cannot grant access. Review the catalogue and conversion data before changing any tier.

## Operational notes

- The migration must be deployed before the app build using the new screen is released.
- Test with two real trip members: confirm that a secret mission is invisible to a third member, visible to its sender and assignee, and completable by either.
- Verify that award votes cannot be cast for oneself or for a non-member.
- Verify realtime updates on two devices and the web build.
- Run `npm run typecheck`, `npm run lint`, `npm test` and the app's database/e2e suites before production rollout.
- The initial wheel uses a curated activity pool plus saved Trip Fun food and scavenger entries; it is not a paid spin or a prize/contest mechanic.
