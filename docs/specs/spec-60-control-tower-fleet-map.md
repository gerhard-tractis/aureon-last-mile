# Spec-60: Control Tower fleet map — trucks at their latest known position

> **Related:** [spec-59](spec-59-map-component-despacho-pins.md) (**prerequisite** — supplies the map component), [spec-58](spec-58-geocoding-foundation.md) (geocoding foundation), [spec-29](spec-29-ops-control-mission-deck.md) / [spec-54](spec-54-ui-rebrand.md) (the Torre de Control layout this lands in)

**Status:** backlog

_Date: 2026-08-17_

> ⚠️ **This spec is blocked on a data-availability question that must be answered before implementation starts.** See "Gate zero". If the answer is negative, this spec does not become a smaller spec — it becomes a different one.

---

## Goal

Show active routes as truck markers on a map in the Torre de Control, each at its latest known position with an explicit freshness label.

## Background — where a truck's position can actually come from

This was investigated before the spec was written, because the obvious answers do not work.

**DispatchTrack has no readable vehicle position.** Its API (`scripts/dt-api-docs.md`) exposes a GPS endpoint at `POST /api/external/v1/gps` — "Create waypoint for route or vehicle". It is **write-only**: you push waypoints *into* DispatchTrack, and there is no GET counterpart anywhere in the documentation. The Show Route response carries `id`, `driver_name`, `driver_identifier`, `start_time`, `started_at`, `end_time`, `truck.identifier`, `truck.vehicle_type`, `truck.groups`, and a dispatch array. There is **no vehicle coordinate** in it. The only coordinates it returns are per-dispatch `latitude` / `longitude`, documented in the *response* tables (`:889`, `:1208`) as "Latitude where the dispatch **was deliverred**" — a delivery position, not a truck position and not a destination.

**We cannot collect GPS ourselves today.** Delivery drivers run DispatchTrack's app in the street, not ours. A browser only reports position while its tab is open and the screen is awake; on iOS a backgrounded PWA stops entirely. Adding `navigator.geolocation` pings to our PWA would produce a near-empty map in production. `apps/mobile` has no `expo-location`, and `drivers.last_location JSONB` has never been written by anything.

**What is left:** when a courier closes a stop, DispatchTrack's dispatch webhook carries `management_latitude` / `management_longitude` — the coordinates where the courier stood — and `beetrack-webhook/index.ts:264-265` stores them in `dispatches.latitude` / `longitude`. A truck's latest known position is then the coordinates of its most recently managed stop: a genuine GPS fix, discrete rather than continuous, arriving by webhook in near-real-time.

That is what this spec renders — labelled honestly, so nobody mistakes it for live tracking. **Provided the field is actually populated for this account**, which is Gate zero.

## Gate zero — does the data exist?

The only concrete sample of a MUSAN dispatch payload in this repo, `docs/dispatchtrack-webhook-payloads.md:143`, reads:

```json
"time_of_management": "2026-03-06T16:09:46-03:00",
"management_latitude": null,
"management_longitude": null,
```

A managed stop with a null coordinate. That sample was scraped from DispatchTrack's webhook documentation site for account 797, so it may be an illustrative example rather than a captured production event — but it is the only evidence available, and it points the wrong way.

**Before any implementation, run against production:**

```sql
SELECT date_trunc('week', completed_at)                    AS week,
       count(*)                                            AS managed_stops,
       count(*) FILTER (
         WHERE raw_data->>'management_latitude' IS NOT NULL
           AND latitude IS NOT NULL
       )                                                   AS webhook_coords,
       count(*) FILTER (WHERE latitude IS NOT NULL)        AS any_coords
FROM public.dispatches
WHERE completed_at IS NOT NULL
  AND deleted_at IS NULL
  AND operator_id = '92dc5797-047d-458d-bbdb-63f18c0dd1e7'   -- MUSAN
  AND completed_at >= now() - interval '90 days'
  AND completed_at <  date_trunc('week', now())              -- whole weeks only
GROUP BY 1 ORDER BY 1;
```

Five things make this query the shape it is, and it should not be simplified back:

- **`webhook_coords`, not just `any_coords`.** `scripts/backfill-dispatches.mjs:188-189` also wrote this column, from DT's top-level `d.latitude`, and sets `completed_at` from `arrived_at` (`:185`) — so backfilled rows satisfy every other predicate while carrying data the live map will never receive. The Filter Dispatches payload the backfill stores in `raw_data` has no `management_latitude` key at all, which is what makes that key a reliable discriminator. The filter also requires `latitude IS NOT NULL`, so the number is exactly what `getRoutePosition` would see rather than what the webhook merely sent.
- **Do not re-run the backfill over the measured window.** It upserts with `resolution=merge-duplicates` and `raw_data: d`, replacing the column wholesale — which would erase `management_latitude` from webhook rows *and* overwrite `latitude`. Its hardcoded window (`:110`, `s=2026-02-14&e=2026-03-09`) makes that safe today, but it is one edited constant away from destroying the discriminator.
- **Whole weeks only.** `GROUP BY` would otherwise return the partial current week as the last row, and whoever runs this reads the bottom line.
- **Filter on `completed_at`, not `created_at`.** A dispatch row is created on the first webhook (status pending) and may complete days later; `created_at` measures the wrong event.
- **Weekly, not a single average.** A 90-day average would hide DispatchTrack having stopped sending the field three weeks ago — which is exactly the failure this gate exists to catch.

Write the result into this section. **`**Status:**` must not move off `backlog` until those numbers are recorded here.** Then:

| `webhook_coords / managed_stops`, most recent full week | Consequence |
|---|---|
| ≥ 70 % | Proceed with this spec as written |
| 30–70 % | Proceed only if the freshness / "sin posición" treatment stays prominent — a map missing a third of the fleet has to say so loudly |
| < 30 % | **Stop.** Below this the map shows a minority of trucks, which reads as "these are the trucks" and actively misleads — worse than the current text-only card. DispatchTrack is effectively not sending management coordinates for this account: raise it with DT support, and if they cannot enable it, the only remaining path is collecting GPS in our own driver flow, which is a delivery-flow spec, not a map spec. Do not build this screen against an empty column. |

A second verification, because it affects the same data: `dispatchtrack-route-poll/index.ts:116` asserts in a comment that "REST API returns dispatches in same shape as webhook payload". The documented Show Route response uses `identifier` and a **string** `status`, while the poll reads `d.dispatch_id` and a **numeric** `d.status`, `continue`-ing when either is missing (`:121`, `:125`). If the documented shape is right, the poll's dispatch loop never reaches its coordinate write at `:140` and that code is dead. Confirm which, because if the shape ever *does* line up, the poll issues an unconditional `.update({ latitude: ... ?? null })` once per cycle for every in-progress route — which would erase the webhook-supplied fixes this map depends on, for exactly the routes it cares about. Either way the coordinate write must become conditional (never null over a value) before this map ships.

## Decisions

1. **Position = most recently managed stop.** Newest `completed_at` among that route's dispatches that carries coordinates.
2. **Always show freshness.** Every marker carries an age label, and markers age visually. A position with no time next to it is a lie by omission on a screen called Torre de Control.
3. **One seam for the position source.** A single pure function, `getRoutePosition(route)`. When Aureon's own delivery flow or a DT GPS feed eventually exists, that function changes and nothing else does.
4. **No schema change and no new RPC.** The latest definition of `get_active_routes_with_dispatches` (`20260729000001_fix_cross_tenant_definer_rpcs.sql:99-100`) already emits `latitude`, `longitude` and `completed_at` per dispatch and enforces `assert_operator_access(p_operator_id)`; `useActiveRoutes.ts:14-15` already types them. The UI simply throws them away today.
5. **Read `dispatches.latitude`, never `orders.latitude`.** These mean different things: `orders.latitude` — which will exist once spec-58 ships, and may not exist yet when this is implemented — is the delivery *destination*; `dispatches.latitude` is where the courier *stood*. Confusing them turns every truck marker into a customer's front door with no visible symptom. Note that `scripts/backfill-dispatches.mjs:188-189` wrote DT's top-level `d.latitude` ("where the dispatch was delivered") into this column for historical rows — a near-equivalent meaning, but worth knowing when auditing old data. spec-58 deliberately adds **no** coordinate columns to `dispatches`, so there is no third pair to confuse.
6. **Extend spec-59's `MapPoint`, do not fork the marker.** See below.

## Non-Goals

- Live or continuous vehicle tracking. Explicitly out of reach; see Background.
- Breadcrumb trails of the day's driven path. The data exists, but a polyline through stop coordinates is not the driven route and would misrepresent it.
- ETAs, distance remaining, or route replay.
- Adding `dispatches` to the realtime publication — see Refresh strategy.
- PWA or native GPS collection. If that is wanted, it is a delivery-flow spec.

## Prerequisites

- Gate zero answered positively.
- spec-59 merged (`MapPanel`, `lib/map/`, tile config, marker component, `NEXT_PUBLIC_MAPTILER_KEY`).
- **spec-58 is not a prerequisite.** Truck positions come from `dispatches`; spec-58 touches only `orders`. Its accuracy gate governs geocoding precision, which this spec does not consume at all.

## Position derivation

New file `apps/frontend/src/lib/ops-control/route-position.ts`.

**All three lib modules this spec touches live under `src/lib/ops-control/`** — `route-position.ts`, `fleet-display.ts` (the lifted `initials` / `routeTone`), and `time-ago.ts`. This is a Torre de Control feature; a separate `lib/fleet/` would split one screen's logic across two homes for no gain, and `timeAgo` is shared with `PackageStatusBreakdown` on that same screen anyway.

```ts
import type { ActiveRoute } from '@/hooks/useActiveRoutes';

export interface RoutePosition {
  latitude: number;
  longitude: number;
  /** completed_at of the stop this fix came from — see the caveat below. */
  observedAt: string;
  source: 'last_managed_stop';
}

export function getRoutePosition(route: ActiveRoute): RoutePosition | null;
```

Rules:

- Consider only dispatches with a non-null `completed_at` **and** both coordinates present.
- Pick the newest `completed_at`. Ties break on the higher `planned_sequence`.
- Return `null` when nothing qualifies — a route that has started but closed no stop yet has no known position, and saying so is correct.
- Reject coordinates outside the Chile validity check. That check lives in `lib/map/config.ts` (spec-59 already owns `CHILE_BOUNDS` and the bounds helpers) — **do not define a second copy here**. For a delivery fleet the mainland box is the right test; a fix from Isla de Pascua would be rejected, which is correct for this operation and wrong in general, so the constant is named for what it is.

Pure, synchronous, no I/O — trivially testable, and the single place a future GPS feed plugs in.

**Caveat on `observedAt`:** both writers compute `completed_at = time_of_management ?? arrived_at` (`beetrack-webhook:261`, `route-poll:127-130`). So the timestamp can be an *arrival* time paired with a *management* coordinate. Usually minutes apart and harmless, but it means `observedAt` is "when the stop closed", not strictly "when the fix was taken", and the tie-break and freshness tiers inherit that.

### Freshness

| Age | Treatment |
|---|---|
| < 30 min | Current — full-strength marker |
| 30–90 min | Ageing — muted marker, age shown |
| > 90 min | Stale — outline marker, age shown |

On a normal urban route stops close every few minutes, so a stale marker is itself operational signal: the driver is stuck, on a break, or off-plan.

**Reuse the existing formatter.** `PackageStatusBreakdown.tsx:21-29` already renders `hace ${m}m` / `hace ${h}h` / `hace ${d}d` on this same screen. Lift `timeAgo` into `src/lib/ops-control/time-ago.ts`, import it in both places, and keep that exact spelling — two formats for one idea on one screen is worse than either format.

## Shared contract extension

spec-59's `MapPoint` carries `precision`, `tone?` and a separate `selectedId` on the panel. This spec uses:

- `precision: 'exact'` always — a GPS fix has no approximate tier in the geocoding sense.
- `tone` — the key returned by the existing `routeTone()` (`FleetCard.tsx:38`, exported), so a route reading "2 FALLIDAS" in the list is the same colour on the map. One vocabulary across the card.
- A new optional `freshness?: 'current' | 'ageing' | 'stale'` on `MapPoint`, rendered by `MapMarker` as opacity/outline.
- **Co-location grouping — reused, not added here.** spec-59 owns it (see its "Co-located points" section): points within ~15 m collapse into one `MapPoint` carrying `stackedIds`, `MapMarker` renders a count badge above one member, and the popup lists a line per member. spec-59 needs it for its own reason (orders sharing a comuna centroid land on identical coordinates), so this spec inherits the behaviour and its tests rather than modifying a shared module. This spec adds no grouping code.

So the only new field this spec contributes to the shared contract is `freshness`. Add it to `src/lib/map/types.ts` and render it in `MapMarker` — spec-59's "Contracts" section explicitly anticipates `MapPoint` growing one optional axis per consumer, and doing it there is what keeps this from forking the marker component. `tone`, `freshness` and stacking are orthogonal and compose; none collides with `selectedId`.

**What grouping does not solve:** ~15 m is a same-building coincidence threshold. At the zoom the Torre map actually sits at — a whole city's fleet in one panel — trucks kilometres apart still overlap visually, and no geographic threshold helps with that. Low-zoom crowding is accepted and out of scope; the badge must not be read as clustering.

`MapPoint` field values for a truck marker: `label` is driver initials + route code; `popupTitle` is the driver name; `popupLines` are the route code, `N/M paradas`, the freshness age, and the failure count when non-zero. The "2 rutas sin posición" line is passed as `MapPanelProps.notes`.

## Screen

`/app/operations-control`, in the "Flota en calle" card (`FleetCard.tsx`), which renders one row per active route from `useActiveRoutes` (wired at `OpsControlDesktop.tsx:57`).

**New component `FleetMapPanel.tsx`** in the same directory, composed by `FleetCard` above its existing list. `FleetCard.tsx` is 133 lines, so the 300-line limit is not the reason to extract — the reasons are that Leaflet is client-and-dynamic-only and carries its own test-mocking needs, and that spec-59's panel wants a sized container of its own.

- Marker label: driver initials plus the route code. `initials()` is module-private at `FleetCard.tsx:15`; step 2 lifts it and `routeTone` into `src/lib/ops-control/fleet-display.ts`, and both components import from there. Do not write a second copy.
- Only routes with a derivable position get a marker. Routes without one stay in the list, flagged "sin posición", and are counted under the map: _"2 rutas sin posición"_. They are never silently absent.
- `completed` and `cancelled` routes get no marker. **The list is unchanged** — `FleetCard` renders every route the RPC returns regardless of status, and `FleetCard.test.tsx:97` asserts it reports non-active routes by their status. That behaviour stays exactly as it is.

### Selection plumbing

`FleetCard` is today a pure presentational component with props `{ routes, isLoading }` (`:60-63`) and rows that have no click handler (`:100-126`). Two-way row↔marker selection is therefore real new work, not a wiring detail:

- Add `selectedRouteId: string | null` and `onSelectRoute: (id: string | null) => void` to `FleetCardProps`.
- Own that state in `OpsControlDesktop` (which already holds the routes) so the list and the map cannot disagree.
- Rows become buttons with an accessible pressed state and a selected style; clicking the selected row clears the selection.
- `FleetMapPanel` passes `selectedId` and `onSelect` through to `MapPanel`. Note the asymmetry: spec-59's `onSelect?: (id: string) => void` cannot express deselection, so **clearing the selection is list-only** — clicking a marker selects, clicking the selected row clears. That is the intended interaction, not an oversight; widening spec-59's signature to please a case nobody asked for is not worth it.

## Refresh strategy

`useActiveRoutes` currently sets `staleTime: 60_000` and **no** `refetchInterval` — it does not poll. Add:

```ts
refetchInterval: 60_000,
refetchIntervalInBackground: true,
```

`refetchIntervalInBackground` is not optional here. The Torre runs on a wall screen where the browser is frequently unfocused, and TanStack Query pauses interval refetching on unfocused windows by default. Without it the map freezes at its last fetch while every freshness label keeps ageing — the labels would then be reporting our staleness as the driver's, which is precisely the failure Decision 2 exists to prevent.

Deliberately **not** adding `dispatches` to the realtime publication (which today carries only `orders` and `dock_verifications`). Positions change at the pace stops close — minutes, not seconds — and every managed stop for every truck would be a broadcast to every ops client for a one-marker move.

Worth knowing while reading `useOpsControlSnapshot`: it subscribes to `postgres_changes` on `public.routes` (`:217-221`), but `routes` is **not** in the realtime publication, so that channel never fires. Route status changes are therefore already poll-driven, not realtime. This spec does not fix that; it means the 60-second interval is the only freshness guarantee for both marker positions and route status — including the "route completes while the map is open" case below.

## Edge cases

| Case | Behaviour |
|---|---|
| Route in progress, no stop closed yet | No marker; listed under "sin posición" |
| No active route has a position | Map shows the empty state, not a blank grey square |
| Position older than the whole shift | Stale treatment, age shown — the point is that ops sees it |
| Coordinates present but `completed_at` null | Ignored; a fix without a time cannot be aged |
| `completed_at` derived from `arrived_at` | Accepted; see the `observedAt` caveat |
| Route completes while the map is open | Marker disappears on the next 60 s refresh |
| Out-of-bounds coordinates | Rejected by `getRoutePosition`; the route counts as "sin posición" rather than vanishing from the tally |
| Two routes closed stops at the same building | Markers overlap. **No coordinate offset** — nudging a marker would misplace a fix this spec has just promised is real. Instead they are collapsed into one stacked marker per the grouping contract above. |
| Tiles fail to load | Markers still render over `bg-map-surface` |

## Testing (TDD — tests first)

**Vitest — `getRoutePosition`** (`src/lib/ops-control/route-position.test.ts`), the highest-value tests here since it is pure:

- Picks the newest `completed_at` among several managed stops.
- Ignores dispatches with null coordinates even when they are the newest.
- Ignores dispatches with null `completed_at`.
- Returns `null` for a route with no managed stop, and for an empty dispatch array.
- Ties on `completed_at` resolve by higher `planned_sequence`.
- Rejects out-of-bounds coordinates, including a swapped lat/lng pair, and the route is then counted under "sin posición" rather than dropped from the totals.
- A stop whose `completed_at` came from `arrived_at` is treated normally.

**Vitest — freshness:** each boundary (29/31 min, 89/91 min) maps to the right tier; the lifted `timeAgo` renders minutes, hours and days in the existing format.

**Vitest — `FleetMapPanel`** (`react-leaflet` mocked as in spec-59): one marker per positioned route; `completed` and `cancelled` routes produce no marker; unpositioned routes are excluded from the map and the count text matches their number; empty state when no route has a position; overlapping positions render a stacked badge rather than two offset markers.

**Vitest — `MapMarker`** (in spec-59's component, extended here): the three `freshness` values render three distinct treatments. That is the only marker assertion this spec owns — the stacked badge and popup-per-member are spec-59's, asserted there, so check that file before writing a duplicate.

**Vitest — `FleetCard`:** existing tests stay green, including `:97` (non-active routes reported by status); the "sin posición" indicator appears only for routes without a position; clicking a row calls `onSelectRoute`; clicking the selected row clears it.

**Vitest — `OpsControlDesktop`:** selecting a route marks it selected in **both** the list and the map, and clearing clears both. The whole reason the state was lifted is that the two halves must not disagree, so that is the assertion that has to exist.

**Vitest — `useActiveRoutes.test.ts`:** asserts `refetchInterval` and `refetchIntervalInBackground` — there is house precedent for asserting query options at `useUsers.test.ts:52`.

**Playwright:** on `/app/operations-control` with seeded in-progress routes whose dispatches carry management coordinates, truck markers render in the fleet card and the freshness label is present. The QA seed has no `management_*` coordinates today — extend it as part of this spec, or the test passes vacuously. Stub tiles at the network layer.

Vitest cannot run locally on this machine; use `npx turbo run lint type-check build` locally and let CI run the suite.

## Implementation order

1. Gate zero — the production query, and the route-poll shape verification. **Stop here on a negative result.**
2. Lift `timeAgo` and `initials`/`routeTone` into `src/lib/ops-control/`; tests first, existing tests stay green.
3. `getRoutePosition` + freshness tiers, fully tested, no UI.
4. `freshness` added to `src/lib/map/types.ts` and rendered by `MapMarker`. Co-location grouping is **not** built here — spec-59 already ships it; verify a stacked marker renders correctly with fleet data.
5. Selection state lifted into `OpsControlDesktop`; `FleetCard` props extended.
6. `FleetMapPanel` composed into `FleetCard`.
7. `refetchInterval` on `useActiveRoutes`.
8. QA seed extension and Playwright coverage.

## Rollout

1. Ships behind no flag — it is additive to an existing card.
2. Verify in QA at `qa.aureon.tractis.ai` with seeded routes that have managed stops carrying coordinates.
3. On the first production day, sanity-check a handful of markers against where those routes actually operate. A cluster of trucks in one implausible spot is the signature of a coordinate-mapping bug.
4. Track the share of routes reporting "sin posición" as an ongoing health metric — it is the early warning that DispatchTrack has stopped sending management coordinates.
