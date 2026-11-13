# Trip Fun

Trip Fun is one tile on the trip overview ("Trip Fun"). It opens a hub with the seven features that were chosen, each on its own screen, so the overview doesn't get more crowded. The hub uses Tripley's own components, so it follows dark mode and keeps the same readable width on a desktop.

| Feature | What it does | Where the data lives |
|---|---|---|
| **Digital Travel Scrapbook** | The trip's photos and memories, a day at a time. Anyone on the trip adds a memory (caption, story, the day it happened, up to 6 photos); photo posts and food photos join in by themselves. Reachable from Trip Fun, from the trip recap ("Open the scrapbook") and from each passport stamp. | `trip_memories` (photos in the private `trip-photos` folder) |
| **My Travel Passport** | Your countries, cities and destinations (stamps), counts of countries, places, trips and days away, progress toward milestones, a map-free "how much of the world" bar, your badges, and the trips behind each stamp. Finished or ongoing trips can be stamped in one tap. Opened from Profile and from Trip Fun. **Only you see your stamps.** | `passport_stamps` |
| **Adventure Scavenger Hunt** | The trip's challenges (started from ideas or your own; a trip theme such as Beach or Ski suggests its own first), completed by posting proof (a photo, a find or a story) to the trip feed. Shows how many are done and who did each. This replaced the separate "Challenges" tile. | `trip_challenges`, `challenge_entries` (proof = feed posts) |
| **Trip Awards** | Eight awards, one vote each per award, never for yourself (the database checks too). Results show as votes come in; the leaders become winners when the trip ends. | `trip_fun_votes` |
| **Trip Soundtrack** | Song titles, a link (https only, opened outside Tripley) and the moment each song goes with. Tripley never hosts or plays music. | `trip_fun_entries` (`kind = 'soundtrack'`, `link_url`) |
| **Food Explorer** | Dishes, restaurants and food experiences, with where, notes and a photo; filter by kind. | `trip_fun_entries` (`kind = 'food'`, `food_kind`, `place_name`, `photo_path`) |
| **Living Trip Timeline** | Everything in date order, a day at a time: the trip's first and last days, plan stops, posts and photos, memories, food finds and songs. Filter by kind; tap to open. | Read from the tables above |

## The two extras that are switched off

ChatGPT's first version also added **Spin the Adventure Wheel** and **Secret Missions**, which weren't among the chosen features. Migration `20261202000000_trip_fun_complete.sql` switches both off in the feature catalogue (their tiles disappear and the database refuses new missions). Nothing is deleted. To bring either back:

```sql
update public.trip_feature_catalog set enabled = true where feature_key in ('adventure_wheel', 'secret_missions');
```

## Database and access control

Migrations (applied by `node scripts/migrate.cjs` before each Railway deploy):

- `20261129000000_trip_fun_hub.sql`: catalogue, entries, award votes, row-level security.
- `20261130000000_trip_fun_realtime.sql`: live updates.
- `20261201000000_trip_fun_fixes.sql`: the plan check can be called by signed-in people (it was failing in production), guard triggers.
- `20261202000000_trip_fun_complete.sql`: scrapbook, passport, food and song fields, the hunt in the catalogue, the extras switched off, account deletion.

What the database enforces (tested in `tests/db/trip-fun.test.ts`): only trip members read or add anything; photos must be your own upload in the trip's folder; song links are https; details can't be edited after they're added (memories can be edited by whoever added them, and removed by them or the organizer); no self-votes; votes only change their nominee; passport stamps are visible only to their owner and can only be linked to trips you're on; dates can't be in the future; deleting your account deletes your memories, stamps, food finds, songs and votes. Helper and trigger functions can't be called directly by anyone.

## Plans (free or Pro)

All Trip Fun features are free. The catalogue can move any of them to Pro later; the hub then shows a "Pro" label and opens the paywall, and the database refuses new entries from people without Pro:

```sql
update public.trip_feature_catalog set minimum_plan = 'pro' where feature_key in ('trip_soundtrack');
```

Feature keys: `travel_scrapbook`, `travel_passport`, `scavenger_hunt`, `trip_awards`, `trip_soundtrack`, `food_explorer`, `living_timeline` (and the extras `adventure_wheel`, `secret_missions`). No new payment product is involved.

## Tests

- `tests/unit/trip-fun.test.ts`: award results and winners, song links, timeline order and filters, scrapbook grouping, passport counts and milestones.
- `tests/db/trip-fun.test.ts`: the rules above.
- `tests/e2e/trip-fun.cjs` (in CI): all seven features in a browser with two people.
