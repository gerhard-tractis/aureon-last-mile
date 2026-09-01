# Spec-72: Blocks and delivery sequence

> **Related:** [spec-70](spec-70-dispatch-state-machine.md) (route lifecycle and `stage` this
> builds on), [spec-71](spec-71-load-positions-staging-pass.md) (load positions — sibling spec,
> not a dependency; LIFO loading is what makes staging pay off), [spec-37](spec-37-pre-route.md)
> (Pre-ruta's andén-grouped planning), `20260306000001_add_routes_dispatches_fleet_tables.sql`
> (`dispatches.planned_sequence`, the webhook-sync column this spec reuses)

**Status:** in progress

_Date: 2026-08-25_

---

## Goal

Give a manager one ordered structure per route — the **sequence of blocks**, a block being a
comuna within a route — that they review rather than author, and give the driver's *actual*
delivery order a separate place to land so the gap between plan and reality becomes visible and,
eventually, trainable.

This is deliberately a manager operation, not the driver's, because the client's stated direction
is that routing automation is coming and driver-held knowledge does not scale as a design
foundation — but the driver's current experience *is* the best routing signal available today, so
this spec protects it (territory stability) rather than discarding it.

## Non-Goals

- Any map, pin, geocode, or drag-and-drop UI, and any automatic route optimisation. `sidecar/or-tools/`
  stays unwired; `sequence_source: 'optimizer'` is a value this spec reserves in the data model, not
  a producer it builds. See [spec-58](spec-58-geocoding-foundation.md), still `backlog`, not a
  dependency here.
- Stop-level (order-level) manual sequencing. The unit is the block (comuna within a route), not the
  individual delivery — see Decision 1.
- Load positions / the physical staging pass — spec-71. This spec and spec-71 are siblings: LIFO
  block order (Decision 5 here) is what makes spec-71's staging useful, but neither spec's data
  model depends on the other shipping first.
- Vehicle capacity, fill rate, or top-up — spec-73.
- Changing what DispatchTrack receives or how routes are dispatched to it. This spec is about local
  planning and local capture of what already comes back over the webhook.

---

## The problem, with evidence

- **There is no first-class delivery-order structure today.** `dispatches.planned_sequence` exists
  (`20260306000001_add_routes_dispatches_fleet_tables.sql:117`, `INTEGER`, comment "position from
  webhook") and is written by the DispatchTrack webhook sync (`apps/worker/n8n/workflows/paris-dispatchtrack-webhook.json`,
  the `dispatch` case: `planned_sequence: body.position || null`). It is a **provider-sourced**
  field — DispatchTrack's own idea of stop order, arriving after the route is already dispatched.
  Nothing local writes it, nothing local reviews or edits it before dispatch, and it exists at
  stop (order) granularity, not block granularity. There is no column, table, or screen today where
  a manager plans delivery order before the route goes out.

- **"1 andén = 1 truck" (spec-37) is the wrong sequencing unit.** Pre-ruta groups by andén because
  that is the sortation geography, but the client's stated reality is that an andén splits across
  trucks and a truck draws from several andenes — so andén membership does not map to "what a
  driver delivers together." The unit that does map is the **comuna within a route**: a driver
  reasons about "which comuna am I in right now," not "which andén did this box come off." This
  spec's block is a comuna-within-a-route, sized (per the operational brief) at roughly 3–6 per
  route — an order of magnitude fewer than the ~40 individual stops on a typical route, and the
  right granularity for a manager to review in seconds rather than author stop-by-stop.

- **The route builder has no notion of "who drove this territory last" before dispatch, and only
  a partial, after-the-fact record once a route is dispatched.** `RouteBuilder.tsx`
  (`apps/frontend/src/components/dispatch/RouteBuilder.tsx`) and the dispatch handler
  (`apps/frontend/src/app/api/dispatch/routes/[id]/dispatch/route.ts`) take `driver_name` as free
  text in the dispatch request body and send it straight to DispatchTrack
  (`truck_identifier`/`driver_identifier` in the POST body, line 61 of `RouteBuilder.tsx`) — the
  dispatch handler itself never writes it to `routes.driver_name` locally; this is exactly breakage
  #10 from spec-70, still open on `main` as of this writing (spec-70 phase 3, which would fix it, is
  not yet merged). `routes.driver_name` and `routes.vehicle_id` do exist as columns
  (`20260306000001_add_routes_dispatches_fleet_tables.sql:84-85`), and the DispatchTrack route
  webhook (`apps/worker/n8n/workflows/paris-dispatchtrack-webhook.json`, the `route` case) does
  `PATCH` `routes.driver_name` from `body.truck_driver` — so a route that has already been dispatched
  and picked up by DispatchTrack does get a driver name written back, eventually. That record is
  provider-sourced and arrives after the fact, which is too late for a manager planning *this*
  route's assignment; it is not a record a manager can look up while planning, only a receipt after
  the truck already left. Territory stability (Decision 6) needs the earlier, locally-written record
  spec-70 phase 3 provides, so the dependency stands even though the DT webhook means the data isn't
  entirely absent from the system today.

---

## Decisions

1. **Sequence is ordered at block granularity — a block is one comuna within one route.** Not the
   ~40 individual stops. A manager reviews 3–6 blocks per route in the order they'll be worked; the
   stops inside a block stay in whatever order the driver or a future optimiser produces at that
   finer grain. This keeps the review a few-seconds glance, matches how the client says drivers
   already reason about their route, and gives the eventual optimiser a natural place to write
   finer-grained output later without changing what the manager looks at.

2. **`sequence_source` records provenance, not correctness.** Every block-sequence write carries
   `sequence_source: 'default' | 'manual' | 'optimizer'`. Day one, every route's blocks default to
   comuna order as they came off Pre-ruta/the route builder — `'default'`. A manager who reorders
   blocks produces `'manual'`. A future optimiser writes `'optimizer'` into the same field on the
   same structure — the manager's job on that day does not change: review the proposed order, catch
   what's wrong, confirm. The column exists now specifically so that day never requires a schema
   change or a UI rewrite, only a new writer.

3. **`dispatches.planned_sequence` is reused for the plan's stop order, not replaced — but it is
   read-only from DispatchTrack today, and this spec does not make it writable.** The column already
   exists and already means "planned position," but the direction is inbound only: the webhook sync
   writes `planned_sequence: body.position || null` (DT → us, per the problem section above), and
   `DTRoutePayload` in `apps/frontend/src/lib/dispatchtrack-api.ts` — the shape the dispatch handler
   actually POSTs to DispatchTrack — carries `truck_identifier`, `route_date`, `driver_identifier`,
   and `dispatches[]`, with no sequence field anywhere in it or in `DTDispatch`/`DTItem`. So there is
   today no outbound path for a locally-planned stop order to reach DispatchTrack at all; a manager
   sequencing blocks before dispatch has nothing that pushes that order back to the provider. This
   spec adds sequence **at block level**, alongside the existing column: a new ordering fact on the
   route's block list, not a duplicate of the existing per-stop column, and not a promise that
   `planned_sequence` becomes writable by implication. `planned_sequence` continues to hold whatever
   DispatchTrack reports back after dispatch, as it does today; the block sequence is the coarser,
   locally-authored structure a manager actually edits before that point. Reusing the same column for
   two granularities — block index and stop index — would make it ambiguous which one a given row
   means without joining back through the block table, which is exactly the "two vocabularies, one
   column" trap spec-70's Decision 1 already named and rejected once in this codebase. **Building an
   outbound stop-sequence push to DispatchTrack (extending `DTRoutePayload`/`DTDispatch` and the
   dispatch handler) is explicit, unlisted work this spec does not do** — without it, a manager's
   block-level plan stays a local artifact and never reaches the driver's DispatchTrack app as a
   stop order, which limits what territory stability and LIFO loading (Decisions 5-6) can achieve
   until that push exists.

4. **The driver's actual delivery order lands in a separate field and never overwrites the plan.**
   DispatchTrack's dispatch-event webhook already reports arrival timing per stop
   (`estimated_at`, `arrived_at`, `completed_at` on `dispatches`, same migration). What it does not
   currently have anywhere to land is a *sequence number derived from arrival order* — today
   `planned_sequence` is the provider's planned figure, and there is no `actual_sequence`. This spec
   adds one, populated by ordering a route's dispatches by `arrived_at` (or `completed_at` where
   `arrived_at` is absent) once the route completes. It is written by the same webhook path that
   already writes `arrived_at`/`completed_at`, as a derived pass rather than a new inbound field —
   DispatchTrack's payload does not carry "actual sequence" directly. This gives a planned-vs-actual
   gap per route: the diff between block sequence (rolled up from `planned_sequence`) and
   `actual_sequence` is exactly the training signal a future optimiser needs, and exactly what lets
   a manager see, after the fact, where the driver diverged from the plan and why that might have
   been the right call.

5. **Load order is reverse block order — last block in the sequence loads first onto the truck (LIFO).**
   If a route delivers Block A, then B, then C, the truck loads C first, then B, then A — so A comes
   off first at the first stop. This is a sequencing decision with no data-model cost (it is a
   function over the same block order, not a new column) and it is what makes spec-71's load
   positions pay off operationally: a driver who has to dig through the truck at every stop gets no
   benefit from a dedicated position, no matter how good the position itself is. The two specs don't
   share code or tables, but this decision only pays off once positions exist, which is why it's
   called out explicitly here rather than left implicit.

6. **Territory stability: default each andén to the driver who last ran it, and warn on a break.**
   The client's framing — "the driver's experience is currently the routing algorithm" — means a
   manager silently reassigning a comuna to an unfamiliar driver is a real cost (missed access
   codes, wrong buzzer, slower stops), not a neutral scheduling choice. When a route builder assigns
   a comuna/andén to a route, the UI looks up the most recent non-cancelled route that covered the
   same comuna and pre-fills that route's driver; if the manager picks someone else, a visible
   warning explains what's being broken (driver name, how many times they've run it recently) rather
   than silently letting the territory move. This is presentation and a lookup query over existing
   `routes`/`dispatches`/comuna data — no new table, since "who ran this territory" is fully
   derivable from `routes.driver_name` plus the comuna each route's blocks covered, once
   spec-70 phase 3 actually starts persisting `driver_name` locally (see the problem section above:
   this is currently blocked on that fix landing, not on anything in this spec).

---

## Data model

```sql
-- packages/database/supabase/migrations/<timestamp>_spec72_route_blocks.sql

CREATE TABLE public.route_blocks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  route_id         UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  comuna_id        UUID NOT NULL REFERENCES public.chile_comunas(id),
  sequence_index   INTEGER NOT NULL,        -- 1-based position within this route's block list
  sequence_source  TEXT NOT NULL DEFAULT 'default'
                     CHECK (sequence_source IN ('default','manual','optimizer')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);

-- Partial unique index, not a table-level UNIQUE constraint -- the repo
-- convention for soft-deleted tables (see idx_dock_zones_operator_code,
-- uniq_vehicles_operator_plate). A table-level UNIQUE would refuse to let a
-- soft-deleted block's comuna be reused by a new block on the same route.
CREATE UNIQUE INDEX unique_route_comuna_block
  ON public.route_blocks (route_id, comuna_id) WHERE deleted_at IS NULL;

-- dispatches: derived actual-arrival sequence, separate from the provider's
-- planned figure so neither writer ever overwrites the other's meaning.
ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS actual_sequence INTEGER;

COMMENT ON COLUMN public.dispatches.actual_sequence IS
  'Derived from arrived_at (fallback completed_at) ordering within the route, '
  'once the route completes. Never written by the planning flow — planned_sequence '
  'and route_blocks.sequence_index are the plan; this is what happened.';
```

`route_blocks` is operator-scoped RLS exactly like every other table in this schema
(`operator_id = public.get_operator_id()`), soft-deleted like the rest, and `sequence_index` is a
plain `INTEGER` -- reordering blocks is a normal `UPDATE` of that column, not a migration.

**No table for "which orders are in this block."** A block's membership is exactly "the dispatches
on this route whose order's `comuna_id` matches this block's `comuna_id`" — fully derivable from
`dispatches → orders → comuna_id`, so it is a join, not a stored list. Storing it separately would
create the same class of drift spec-70 built `route_stop_counts` to avoid (Decision 5 there: "Counts
are derived, never incremented").

**`orders.comuna_id` is nullable** (`ADD COLUMN IF NOT EXISTS comuna_id UUID REFERENCES
public.chile_comunas(id)`, no `NOT NULL`, in `20260321000001_chile_comunas_normalization.sql:455`) —
`normalize_comuna_id` can fail to match a raw comuna string and leave it `NULL`. An order in that
state cannot join into any `route_blocks` row, which means it must not silently vanish from the
sequenced route the way orders have silently disappeared elsewhere in this project before. Any order
on the route whose `orders.comuna_id IS NULL` is surfaced as an explicit "sin comuna — no
secuenciado" row outside the block list, not folded into any block and not dropped from the route's
manifest or its counts.

---

## Implementation phases

Each phase is one PR with auto-merge, per `CLAUDE.md`.

- **Phase 1 — Database.** `route_blocks` table, RLS, soft delete, `dispatches.actual_sequence`. A
  SQL suite (fixtures + `DO $$ ... RAISE`, matching `pre_route_snapshot.test.sql`): operator
  isolation, unique comuna per route, `sequence_source` CHECK, and that block membership derived
  via the `dispatches → orders` join matches hand-built fixtures.
- **Phase 2 — Default sequencing.** When a route is created/seeded (Pre-ruta or the manual builder),
  populate `route_blocks` from the route's comuna composition in whatever order they were added,
  `sequence_source = 'default'`. This is the day-one behaviour the manager reviews against.
- **Phase 3 — Manager review UI.** A screen/section on the route builder listing blocks in order
  (comuna name, order/package counts, move-up/move-down buttons to reorder — no drag-and-drop,
  consistent with this spec's Non-Goals), writing `sequence_index` + `sequence_source = 'manual'` on
  any change. Read-only block list is available as soon as phase 2 ships; the editing UI is this
  phase.

  **Known gap carried in from phase 2, must be handled here:** `seed_default_route_blocks`
  (phase 2) runs exactly once, at route creation/seeding. It is not re-triggered by
  `app/api/dispatch/routes/[id]/scan/route.ts`'s scan-adopt branch, which inserts a dispatch
  directly onto an *already-seeded* route — deliberately not touched by phase 2's migration
  because that file is spec-74's contended territory. An order adopted that way can carry a
  non-NULL `comuna_id` and still end up with **no block**: it isn't in any block (seeding already
  happened) and it isn't in the "sin comuna" bucket either (`comuna_id` is not NULL) — it is
  simply invisible to a reader that trusts `route_blocks` as a complete manifest, which is exactly
  the silent-drop this spec's data-model section forbids. **Phase 3's reader MUST NOT assume the
  block list is a complete manifest of the route's orders** — it must independently compute and
  surface orphans as `comuna_id IS NOT NULL AND (no live route_blocks row for that comuna on this
  route)`, in addition to the already-planned "sin comuna" bucket for `comuna_id IS NULL` orders.

  **Consequence for empty-draft routes:** `createEmptyDraft`
  (`apps/frontend/src/app/api/dispatch/routes/route.ts:141-164`) creates a route with zero
  dispatches and never calls `create_seeded_route` (and therefore never calls
  `seed_default_route_blocks`). `INSERT INTO dispatches` exists in exactly two places repo-wide —
  `create_seeded_route` and the scan-adopt branch — so an empty-draft route can *only* ever gain
  dispatches via scan-adopt, and per the gap above, scan-adopt never triggers block seeding. An
  empty-draft route will therefore **never have any blocks at all**, for any of its orders, until
  a later phase closes this gap. Phase 3's orphan handling above covers this case too (every order
  on such a route is an orphan by that definition), but it is worth stating as its own consequence
  since it means the block list for these routes isn't just occasionally incomplete — it's
  permanently empty.

  **Proposed fix, for phase 3 to pick up (not built in phase 2):** make
  `seed_default_route_blocks` safely re-runnable to pick up new comunas without clobbering a
  manual reorder, by changing its no-op guard from "any live block exists" to "insert only the
  comunas that don't yet have a live block on this route" (an anti-join on `route_blocks` by
  `comuna_id`, still filtered to `sequence_source = 'default'` rows it's safe to append after —
  never renumbering or touching existing rows, `'manual'` or `'default'`), with new rows getting
  `sequence_index` values that continue after the current max. That would let phase 3 (or a
  scan-adopt hook, if that branch's ownership ever opens up) call it again after any dispatch-set
  change and have newly-adopted comunas gain a block without disturbing anything already there.
  This is a real behavior change from phase 2's current all-or-nothing no-op and needs its own
  design pass (in particular: what happens to sequencing when a *new* comuna arrives after a
  manager has already manually reordered everything else) — explicitly deferred to phase 3, not
  assumed here.
- **Phase 4 — Territory stability.** The last-driver lookup and the reassignment warning (Decision
  6). Depends on `routes.driver_name` actually being persisted locally, which is spec-70 phase 3 —
  call this phase blocked on that phase merging, not just on spec-70's docs status.
- **Phase 5 — Actual-sequence capture.** Extend the DispatchTrack webhook handling (or a scheduled
  pass over completed routes) to compute and write `dispatches.actual_sequence` from
  `arrived_at`/`completed_at` ordering once a route reaches `completed`. Read-only reporting of the
  planned-vs-actual gap (block order vs. actual arrival order) is presentation over this column; no
  further write path.

## Open questions for implementation

- ~~Where exactly the block-review UI lives relative to spec-70's `loading` state.~~
  **Resolved in phase 3, in the safe direction: blocks are reorderable only while the route is
  `draft`, `planned` or `loading`** — the same window `packages/[pkgId]` DELETE uses for removing a
  stop, and for the same reason: past `loaded` the manifest is sealed, and past `dispatched` the
  route is a one-way door with no outbound push to reconcile against (Decision 3). Enforced in
  `move_route_block` itself, not only the handler, so a direct RPC call is refused too —
  `ROUTE_SEALED` (P0001), mapped to 409. The permissive alternative would have poisoned phase 5:
  `actual_sequence` is only meaningful against a block order that was frozen at dispatch, and
  editing after the fact corrupts the planned-vs-actual signal this spec exists to produce.
- Whether `route_blocks.sequence_index` should be unique per `route_id` (strict total order) is left
  to the SQL suite to decide and enforce; this doc treats it as an obvious yes but doesn't encode a
  `CHECK`/`UNIQUE` for it above since the right enforcement (constraint vs. application-level
  renumber-on-write) depends on how phase 3's reorder UI is built.
  **Resolved:** phase 1 shipped the partial unique index, and phase 3 added
  `CHECK (sequence_index > 0)`. That CHECK earned its keep immediately — the reorder had been
  parking a block at a *negative* index mid-swap, which the constraint rejects. Parking moved to
  `MAX(live sequence_index) + 1`: strictly positive, still provably collision-free. The safety
  argument had been prose in a comment; it is now enforced.

## Notes for phases 4 and 5

- **`sequence_index` is not contiguous.** A soft-deleted block leaves live indices like `1, 2, 4`,
  and the reorder deliberately preserves that gap rather than renumbering. Anything downstream must
  order by rank and must never assume `1..N`.
- **`route_blocks` is still not a complete manifest**, even with phase 3's append writer. The writer
  is invoked by a manager action, not automatically on scan-adopt — so between an adoption and that
  click, an order with a real comuna has no block. Phase 4's territory lookup ("which comuna did
  this route cover") derives from blocks, so it will under-report until the append is run, and it
  will do so **silently**. Surface the orphan count wherever that lookup is consumed.
