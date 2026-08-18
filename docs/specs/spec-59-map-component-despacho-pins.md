# Spec-59: Map component + Despacho order pins

> **Related:** [spec-58](spec-58-geocoding-foundation.md) (**hard prerequisite** — supplies the coordinates), [spec-60](spec-60-control-tower-fleet-map.md) (reuses the map component built here), [spec-38](spec-38-route-activity-view.md) (created the map placeholder this spec fills), [spec-54](spec-54-ui-rebrand.md) (created the `map-surface` / `map-line` tokens)

**Status:** backlog

_Date: 2026-08-17_

---

## Goal

Introduce the project's one and only map component, and use it to pin orders in Despacho — on the pre-route planning canvas as ops builds a route, and in the per-route pane of the En Ruta tab.

## Background

Two map-shaped holes were deliberately left in the UI, both with a note saying the provider lands in a later spec:

- `RoutePlanCanvas.tsx` — the centre column of the pre-route board. Its header comment reads: _"When the optimiser and a provider land, this component is where they go — the layout does not move."_
- `RouteActivityRow.tsx:173-176` — a 280px right-hand pane, `data-testid="map-placeholder"`, reading "Mapa Leaflet — próximo sprint". `RouteActivityRow.test.tsx:140` asserts it exists.

The design tokens are already in place, already used, and test-enforced: `--color-map-surface` and `--color-map-line` in `globals.css:35-36, 91-92, 146-147`, consumed today by `RoutePlanCanvas.tsx:33,35`, asserted by `src/app/__tests__/design-tokens.test.ts:110, 214-215`.

No map library is installed anywhere in the monorepo. There is also **no `next/dynamic` at all, and no `ssr: false` anywhere** in `apps/frontend/src` — there is no near-miss precedent to copy; this spec establishes the pattern from zero.

## Decisions

1. **Leaflet + react-leaflet, not MapLibre GL.** Leaflet is ~40 KB against MapLibre's ~200 KB+, needs no WebGL (the ops floor and warehouse machines are not a controlled hardware fleet), and raster tiles are ample for the tens-to-hundreds of pins these screens show. The existing placeholders already say "Leaflet". If a later spec needs comuna polygons or thousands of pins, MapLibre becomes the right call — which is exactly why the wrapper below is thin.
2. **`react-leaflet` v5**, the line whose peer dependency is React ^19 (`apps/frontend` runs React 19.2.4) and Leaflet ^1.9. Pin the major. **Risk to check first:** react-leaflet v5 ships ESM-only. Before writing any test that mocks it, verify it transforms cleanly under both Next 15 and Vitest 4 — it may need a `transpilePackages` entry in `next.config.ts` (which already lists `@aureon/database`) and/or `server.deps.inline` in `vitest.config.ts`. Resolve this in the first task of implementation, not after the component is written.
3. **MapTiler raster tiles**, the same vendor as spec-58's geocoder. Not the public `tile.openstreetmap.org` server: its tile usage policy forbids commercial production traffic, and it rate-limits or blocks offenders. This is a correctness issue, not a cost one.
4. **One map component for the whole app.** Both consumers here, and spec-60's fleet map, go through it. Screen-specific behaviour arrives as props, never as a second Leaflet integration.
5. **Custom `divIcon` markers, no default Leaflet icons.** Leaflet's default marker resolves its PNGs by relative URL and 404s under every modern bundler; the usual fix is a fragile `L.Icon.Default.mergeOptions` patch. Rendering markers as styled `divIcon`s sidesteps the problem entirely and lets markers use our design tokens.
6. **Theme-matched tiles.** The dark theme sets a genuinely dark `--color-map-surface: #12100c` (`globals.css:91`); a light raster style inside that panel reads as broken. The app has **three** modes, not two — `useTheme.ts:5` is `'light' | 'dark' | 'custom'`, with the custom/brand block at `globals.css:136-150` carrying *light* map tokens. So: `dark` → dark tile style; `light` and `custom` → light tile style. `AureonMap` consumes `useTheme()` rather than sniffing the class, and the `TileLayer` takes the style as its `key` so Leaflet actually re-tiles on a runtime theme switch instead of keeping the old layer mounted.

## Non-Goals

- Route polylines and driven paths. We have no directions provider, and drawing straight lines between stops would misrepresent a real route. Points only.
- The DISTANCIA / DURACIÓN / OCUPACIÓN / CPO metric strip that `RoutePlanCanvas` mocks up. Those come from the OR-Tools optimiser, which still has no frontend wiring. The existing honest metrics (Órdenes / Paquetes / Comunas / Grupos) stay exactly as they are.
- Marker clustering. Not needed at current volumes; see Performance.
- Drawing or editing zones or geofences.
- Truck positions — spec-60.
- Any change to how a route is created. The map is a view over the existing selection, not a new way to build one.

## Prerequisite

spec-58 must be merged **and its accuracy gate passed**. If a large share of orders resolve only to a comuna centroid, the pre-route map degrades to a stack of identical pins at comuna centres, which is worse than the current honest placeholder. Do not start this spec on a failed gate.

## Dependencies

Added to `apps/frontend/package.json`: `leaflet` ^1.9, `react-leaflet` ^5, `@types/leaflet` (dev).

Env: `NEXT_PUBLIC_MAPTILER_KEY`, added to `apps/frontend/.env.example` alongside the other `NEXT_PUBLIC_*` vars, and set in Vercel.

This key is shipped to the browser — unavoidable for client-side tile requests, and true of every tile provider. It is therefore **restricted by HTTP referrer** in the MapTiler console to the production and QA origins, and it is a *separate key* from the server-side `MAPTILER_API_KEY` spec-58 uses for geocoding, so a scraped tile key cannot burn geocoding quota. Both keys get a spend cap.

## Component architecture

Following the repo's `app→components→hooks→lib→Supabase` layering, config and shared types live under `src/lib/map/` (as `src/lib/dispatch/types.ts`, `src/lib/ops-control/` etc. already do), and only components live under `src/components/map/`. Every file stays well under the 300-line limit.

| File | Responsibility |
|---|---|
| `src/lib/map/types.ts` | `MapPoint` and the props contracts below. Imported by spec-60. |
| `src/lib/map/config.ts` | Tile URL + style per theme, attribution string, `NEXT_PUBLIC_MAPTILER_KEY` read, Chile default centre/zoom, bounds helpers, `CHILE_BOUNDS` validity check. |
| `src/lib/map/points.ts` | Two entry points → one core: domain flattening, `CHILE_BOUNDS` exclusion, co-location grouping, the 500 cap, and the `notes` strings. Pure, no React. |
| `src/components/map/MapPanel.tsx` | Public entry point — the only file other screens import. `'use client'`, wraps `AureonMap` in `next/dynamic(..., { ssr: false })`, owns skeleton / empty / error states and the footnote line. |
| `src/components/map/AureonMap.tsx` | The Leaflet-touching client component: `MapContainer`, `TileLayer`, fit-bounds behaviour. Knows nothing about orders. |
| `src/components/map/MapMarker.tsx` | A `divIcon` marker with its popup. |

Leaflet's stylesheet (`leaflet/dist/leaflet.css`) is imported inside `AureonMap.tsx` so it loads with the dynamic chunk rather than on every page.

**On `'use client'` and `ssr: false`:** these are not "server-safe" — in the Next 15 App Router `next/dynamic` with `ssr: false` is only legal inside a Client Component. `MapPanel` therefore carries `'use client'`. What the dynamic import buys is that Leaflet never enters the server bundle and never touches `window` during SSR; the skeleton is what renders through SSR and hydration.

### Contracts

```ts
export interface MapPoint {
  /** Opaque to the map. Order id on Screen 1; dispatch id on Screen 2. */
  id: string;
  latitude: number;
  longitude: number;
  label: string;              // Screen 1+2: the order number. spec-60 uses driver initials + route code.
  popupTitle: string;
  popupLines?: string[];
  precision: 'exact' | 'approximate';
  /** Emphasis axis. This spec emits 'prominent' | 'muted'; spec-60 widens it. */
  tone?: 'prominent' | 'muted';
}
```

`MapPoint` is expected to grow one optional axis per consumer — spec-60 adds `freshness?: 'current' | 'ageing' | 'stale'`. Keep the axes orthogonal and optional rather than widening a single `variant` union, so a new consumer never forces a change on an existing one.

```ts
export interface MapPanelProps {
  points: MapPoint[];
  /** Single-highlight axis (Screen 2). Set-wide emphasis rides on MapPoint.tone. */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Rendered under the map. Produced by points.ts, never composed by callers. */
  notes?: string[];
  emptyMessage: string;       // differs per screen — no default
  className?: string;         // caller owns height; Leaflet needs a sized box
  ariaLabel: string;
}
```

`precision`, `tone` and selection are **three separate axes** — an order can be approximate *and* muted *and* selected, and a single `variant` field cannot express that. `MapMarker` composes its appearance from `precision`, `tone`, and whether the id matches `selectedId`.

**How Screen 1's set-wide emphasis reaches the map:** there is no plural selection prop, deliberately. `points.ts` takes the selected-order-id set and emits `tone: 'prominent' | 'muted'` per point; `selectedId` remains the single-highlight axis that only Screen 2 uses. One emphasis mechanism, decided in one pure function.

**`points.ts` owns every derived string.** It returns the `MapPoint[]` *and* the `notes` — "3 sin ubicación exacta", "mostrando 500 de N" — so the Honesty and Performance guarantees are enforced in one tested place. If each screen composed its own note text, the two would drift and neither guarantee would live anywhere.

**Two entry points, one core.** Both screens must go through `points.ts`, or the `CHILE_BOUNDS` exclusion, the 500 cap and the notes silently fail to apply to whichever screen skipped it:

```ts
fromPreRouteSnapshot(snapshot: PreRouteSnapshot, selectedOrderIds: Set<string>): MapPointsResult
fromRouteDispatches(dispatches: RouteDispatchSummary[]): MapPointsResult

interface MapPointsResult { points: MapPoint[]; notes: string[] }
```

They differ only in how they flatten their input and what they use as `id` (order id vs dispatch id); everything after that — bounds check, exclusion counting, co-location grouping, cap, notes — is one shared internal function.

### Co-located points

Orders that fall back to a comuna centroid land on **identical** coordinates, so a comuna with 30 approximate orders renders as one marker that looks like one order. That is the same silent truncation the Performance section refuses to accept for the 500 cap, and it is the single most likely real-world rendering of this map early on.

So grouping lives here, in the shared core, not in a consumer: points within ~15 m of each other collapse into one `MapPoint` carrying `stackedIds: string[]`; `MapMarker` renders a count badge when `stackedIds.length > 1`, and the popup lists one line per stacked member. Points that do not collide are untouched. spec-60 reuses this for trucks that closed stops at the same building.

```ts
stackedIds?: string[];   // on MapPoint; length > 1 means this marker represents several
```

**Selection on a stacked marker.** The collapsed point's `id` is its first `stackedIds` member, and `stackedIds` order is deterministic (sorted by id) so a re-render cannot change which one that is. Clicking a *stacked* marker opens its popup rather than firing `onSelect` — selecting one of several by clicking the pile would silently pick an arbitrary member. Each popup line is itself clickable and fires `onSelect` with that member's id. A non-stacked marker fires `onSelect` directly, as before.

The caller owns height because the two call sites are structurally different: `RouteActivityRow`'s pane is a fixed-width column inside a flex row, while `RoutePlanCanvas` is a `min-h-[280px]` flex column with the metrics strip beneath it.

### Behaviour

- `fitBounds` to the supplied points on mount and whenever the set of point ids actually changes, with padding. A single point centres at a fixed zoom rather than zooming to maximum.
- Ops-initiated pan/zoom is not stomped by a re-render: refitting is keyed on the point-id set, not on every render or every prop identity change.
- Zero points renders `emptyMessage`, not an empty grey map.
- `bg-map-surface` sits behind the tiles so the panel reads correctly before tiles load, in all three theme modes.
- **Attribution is mandatory**, not decorative: OpenStreetMap's ODbL and MapTiler's terms both require visible credit. It stays in the `TileLayer` attribution control and must not be styled out.

## Screen 1 — pre-route planning canvas

`RoutePlanCanvas.tsx` keeps its shape: map area on top, honest metrics strip below. The placeholder block becomes a `<MapPanel>`; the metrics strip is untouched.

**Data path.** `RoutePlanCanvas` today receives exactly one prop, `summary: SelectionSummary`, which is counts plus `orderIds` (`useUnroutedGroups.ts:74-80`) — it has no addresses and no coordinates. The orders live in the snapshot held by `PreRouteBoard.tsx`, which renders `<RoutePlanCanvas summary={summary} />` at line 116. So:

- `PreRouteBoard` derives `MapPoint[]` from `snapshot.andenes[].comunas[].orders[]` via `lib/map/points.ts` and passes it down.
- `RoutePlanCanvas` gains `points: MapPoint[]` and `selectedOrderIds: Set<string>` alongside the existing `summary`.

**There is no separate "draft" to render.** On this board the selection *is* the draft — `RouteDraftPanel` derives what it shows from `groups` + `selectedIds` (`PreRouteBoard.tsx:118-125`). So the map has two states, not three: orders belonging to selected groups render prominent, everything else unrouted renders muted. Ops watches the route take shape as they tick groups.

### RPC change

`get_pre_route_snapshot` already returns per-order rows — `PreRouteOrder` (`src/lib/types.ts:2274-2283`) carries `delivery_address` inside each comuna — so this is additive, not a new query path:

- Add `latitude`, `longitude`, `geocode_precision` to the per-order JSON object, inside the existing `operator_id`-scoped CTEs. No new rows become visible; three columns are added to rows the caller already receives.
- Add the same three fields to `PreRouteOrder` in `src/lib/types.ts`.

New migration `packages/database/supabase/migrations/<timestamp>_spec59_pre_route_snapshot_coords.sql`, rewritten with `CREATE OR REPLACE` using the **latest** definition as template — `20260817000003_fix_pre_route_sectorizado_cohort.sql`, not the original `20260423000002_pre_route_snapshot.sql`.

## Screen 2 — En Ruta route pane

`RouteActivityRow.tsx:173-176`: the 280px pane becomes a `<MapPanel>` showing that route's stops. The pane keeps its fixed 280px width and its border — spec-38's design note is explicit that the layout does not move.

Selecting an order in the left list highlights its marker; clicking a marker selects that order in the list. That two-way link is the whole point of putting a map beside a list, and it reuses the selection state already in the component — `selectedId` / `effectiveSelectedId` (`RouteActivityRow.tsx:33,41`); `selectedOrder` at `:42` is derived from it. `MapPoint.id` on this screen is the **dispatch id**, matching what `setSelectedId` already stores.

Its `emptyMessage` is "Sin paradas geolocalizadas" — distinct from Screen 1's copy, because on this screen the scope is one route's stops.

`useRouteDispatches` (`src/hooks/dispatch/useRouteDispatches.ts:20`) already selects from `dispatches` joined to `orders`; add `latitude, longitude, geocode_precision` to that `orders(...)` projection and to `RouteDispatchSummary` in `src/lib/dispatch/types.ts:52`. No new hook.

**Take the coordinates from `orders`, not from `dispatches`.** The adjacent `dispatches.latitude` / `dispatches.longitude` columns mean "where the courier stood when they closed the stop" — spec-58 documents this trap and spec-60 depends on that meaning. The delivery destination lives only on `orders`, geocoded by spec-58. DispatchTrack never returns a destination coordinate to us (its response-side `dispatches.latitude` is documented as "where the dispatch was deliverred"), so there is no second source to reconcile.

`RouteActivityRow.test.tsx:140` asserts the placeholder testid — that assertion is **replaced**, not deleted: the new test asserts a map panel renders with the expected marker count.

## Honesty about approximate pins

Orders resolved only to a comuna centroid (`geocode_precision = 'approximate'`) are visually distinct — hollow/dashed marker, a distinct popup line — and the panel shows a count: _"3 sin ubicación exacta"_.

This is not a nicety. Ops needs to see at a glance that a pin in the middle of a comuna is a data-quality artefact, not a delivery address, otherwise they will plan routes around fiction. The count is also the field feedback loop on spec-58's provider.

## Performance

Both screens are bounded in practice (a route has tens of stops; a pre-route selection is at most a day's orders). Guard anyway: render at most 500 markers, and above that show the first 500 plus an explicit _"mostrando 500 de N"_ note. A silent cap would read as "that is all the orders" — exactly the kind of quiet truncation that misleads an operator.

If real usage regularly exceeds the cap, that is the signal to move to MapLibre and clustering — a separate spec.

## Edge cases

| Case | Behaviour |
|---|---|
| No order in scope has coordinates | `emptyMessage` ("Sin órdenes geolocalizadas"), not a blank map |
| Every order is `approximate` | Map renders; the count line states it plainly |
| Some orders lack coordinates (geocoder has not caught up) | Excluded from the map, counted in the note — never silently dropped |
| `NEXT_PUBLIC_MAPTILER_KEY` missing | A **distinct config-error state** — "Mapa no disponible: falta configuración" — plus a console error; **never** a broken tile grid, and never `emptyMessage`. Telling ops "sin órdenes geolocalizadas" because a key is missing would be the map lying about data, which is the one thing this spec exists to prevent. |
| Tiles fail to load (offline, blocked) | Markers still render over `bg-map-surface`; the panel stays usable |
| Coordinates outside `CHILE_BOUNDS` | Excluded and counted as bad data — this is what a swapped lat/lng looks like |
| Single point | Centres at a fixed zoom, not maximum zoom |
| SSR / hydration | Skeleton renders; Leaflet never touches `window` on the server |

## Testing (TDD — tests first)

**pgTAP** (`packages/database/supabase/tests/`, extending the existing `get_pre_route_snapshot` suite): the per-order object carries `latitude`, `longitude` and `geocode_precision`; an order with NULL coordinates still appears with nulls rather than being dropped; the existing `operator_id` isolation assertions stay green.

**Vitest**, colocated. `react-leaflet` and `leaflet` are mocked with `vi.mock`, following the precedent for browser-only libraries in `RouteQRScannerEntry.test.tsx` (which mocks `html5-qrcode`).

- `lib/map/points.ts`, `fromPreRouteSnapshot`: traverses the snapshot; orders without coordinates are excluded and counted; `approximate` orders keep that precision; out-of-`CHILE_BOUNDS` coordinates are excluded and counted; the 500 cap truncates and reports the true total; the selected-id set produces `tone: 'prominent'` and everything else `'muted'`; the returned `notes` strings match the counts.
- `lib/map/points.ts`, `fromRouteDispatches`: the flat dispatch list maps with `id` = dispatch id, and inherits the same bounds exclusion, cap and notes — asserted separately, because these guarantees silently would not apply to En Ruta if it bypassed this function.
- Co-location grouping: 30 orders sharing one comuna centroid collapse to a single point with `stackedIds.length === 30`; 14 m apart merges and 16 m apart does not (the threshold boundary); a three-way stack collapses to one point; `stackedIds` order is deterministic across runs and the collapsed `id` is its first member; non-colliding points pass through untouched; `MapMarker` renders the count badge only above one member, its popup lists a line per member, and clicking a stacked marker opens the popup instead of firing `onSelect` while a popup line fires it with that member id.
- `PreRouteBoard`: derives `MapPoint[]` by traversing `snapshot.andenes[].comunas[].orders[]` and joining the selected group ids. This is the newest and least-obvious code path in the spec — a snapshot traversal plus a selection join — and there is no `PreRouteBoard.test.tsx` today to catch it incidentally, so it gets its own test file.
- `lib/map/config.ts`: `dark` selects the dark style while `light` and `custom` both select the light one; a missing key is detectable rather than producing a malformed URL.
- `MapPanel`: skeleton before the dynamic chunk resolves; `emptyMessage` for zero points; the **config-error state** for a missing key, asserted as distinct copy from `emptyMessage`; `notes` render; `onSelect` fires with the clicked point id.
- `AureonMap`: refits when the point-id set changes; **does not** refit on an unrelated re-render (the pan/zoom-preservation guarantee); a single point centres at the fixed zoom; markers still render when the tile layer errors; switching `useTheme()` mode remounts the `TileLayer` with the other style URL (the `key` behaviour from Decision 6).
- Attribution: `AureonMap` passes a non-empty attribution to `TileLayer`. Note the limit honestly — with `react-leaflet` mocked this asserts a prop reached a mock, and Playwright stubs tiles, so the *rendered* attribution control is never exercised in CI. Assert the rendered control in the e2e run so the licensing obligation has one real check.
- `RouteActivityRow`: one marker per geolocated dispatch; selecting an order marks the matching marker selected; clicking a marker selects the order. Replaces the placeholder assertion at line 140.
- `RoutePlanCanvas`: markers for selected groups render prominent and the rest muted; the metrics strip is unchanged (a guard against regressing the honest metrics).
- `src/app/__tests__/design-tokens.test.ts` stays green; the assertions at lines 110 and 214-215 are unchanged. The tokens are already in use today — this spec only moves where.

**Playwright** (`apps/frontend/e2e/`). This is **new e2e ground, not an extension**: `dispatch-route.spec.ts` currently holds a single smoke test ("dispatch page loads and shows Nueva Ruta button"), and the new tests need an authenticated session, an expanded En Ruta row, and geocoded seed data. The QA seed runs on every deploy and today seeds no coordinates — **extend the seed as part of this spec**, or the test pins nothing and passes vacuously. Stub tiles at the network layer so the test never depends on MapTiler.

Vitest cannot run locally on this machine; use `npx turbo run lint type-check build` locally and let CI run the suite.

## Rollout

1. Resolve the react-leaflet ESM question (Decision 2) before anything else.
2. `NEXT_PUBLIC_MAPTILER_KEY` in `.env.example` and set in Vercel for production and QA, referrer-restricted, spend-capped.
3. Confirm the deploy actually ran the DB job — this spec ships a migration, and the deploy path filter can skip that job while every PR check stays green.
4. Verify in QA at `qa.aureon.tractis.ai`. If pins do not appear, check in order: are the orders geocoded in the DB → does the RPC return coordinates under RLS → is the deployed bundle current (a stale PWA bundle is the usual culprit) — before debugging the map itself.
5. Confirm Leaflet lands in the dynamic chunk and not the main bundle.
