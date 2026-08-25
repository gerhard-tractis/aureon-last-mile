# Spec-72: Blocks and delivery sequence

> **Related:** [spec-70](spec-70-dispatch-state-machine.md) (route lifecycle and `stage` this
> builds on), [spec-71](spec-71-load-positions-staging-pass.md) (load positions — sibling spec,
> not a dependency; LIFO loading is what makes staging pay off), [spec-37](spec-37-pre-route.md)
> (Pre-ruta's andén-grouped planning), `20260306000001_add_routes_dispatches_fleet_tables.sql`
> (`dispatches.planned_sequence`, the webhook-sync column this spec reuses)

**Status:** backlog

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
  block order (Decision 4 here) is what makes spec-71's staging useful, but neither spec's data
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

- **The route builder has no notion of "who drove this territory last."** `RouteBuilder.tsx`
  (`apps/frontend/src/components/dispatch/RouteBuilder.tsx`) and the dispatch handler
  (`apps/frontend/src/app/api/dispatch/routes/[id]/dispatch/route.ts`) take `driver_name` as free
  text in the dispatch request body and send it straight to DispatchTrack
  (`truck_identifier`/`driver_identifier` in the POST body, line 61 of `RouteBuilder.tsx`) — it is
  never read back from, or matched against, anything. `routes.driver_name` and `routes.vehicle_id`
  exist as columns (`20260306000001_add_routes_dispatches_fleet_tables.sql:84-85`) but the dispatch
  handler never writes either locally; this is exactly breakage #10 from spec-70, still open on
  `main` as of this writing (spec-70 phase 3, which would fix it, is not yet merged). So there is
  today no record for "which driver usually runs Comuna X" to be built from or checked against.

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

3. **`dispatches.planned_sequence` is reused for the plan's stop order, not replaced.** It already
   exists, is already the column the webhook expects to send DispatchTrack a sequence, and already
   means "planned position" per its own migration comment. This spec adds sequence **at block
   level**, alongside it: a new ordering fact on the route's block list, not a duplicate of the
   existing per-stop column. `planned_sequence` continues to hold (or receive, once this spec's
   local planning writes it before dispatch rather than only after) the stop-level order within a
   route; the block sequence is the coarser structure a manager actually edits. Reusing the same
   column for two granularities — block index and stop index — would make it ambiguous which one a
   given row means without joining back through the block table, which is exactly the
   "two vocabularies, one column" trap spec-70's Decision 1 already named and rejected once in this
   codebase.

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
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT unique_route_comuna_block UNIQUE (route_id, comuna_id)
);

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
(`operator_id = public.get_operator_id()`), soft-deleted like the rest, and `sequence_index` is
`INTEGER` rather than an enum for the same reason spec-70 chose `TEXT` + `CHECK` for `stage`: this
value set is expected to be re-derived by an optimiser later and re-ordering a plain integer column
is a normal `UPDATE`, not a migration.

**No table for "which orders are in this block."** A block's membership is exactly "the dispatches
on this route whose order's `comuna_id` matches this block's `comuna_id`" — fully derivable from
`dispatches → orders → comuna_id`, so it is a join, not a stored list. Storing it separately would
create the same class of drift spec-70 built `route_stop_counts` to avoid (Decision 5 there: "Counts
are derived, never incremented").

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
  (comuna name, order/package counts, drag-or-buttons reorder), writing `sequence_index` +
  `sequence_source = 'manual'` on any change. Read-only block list is available as soon as phase 2
  ships; the editing UI is this phase.
- **Phase 4 — Territory stability.** The last-driver lookup and the reassignment warning (Decision
  6). Depends on `routes.driver_name` actually being persisted locally, which is spec-70 phase 3 —
  call this phase blocked on that phase merging, not just on spec-70's docs status.
- **Phase 5 — Actual-sequence capture.** Extend the DispatchTrack webhook handling (or a scheduled
  pass over completed routes) to compute and write `dispatches.actual_sequence` from
  `arrived_at`/`completed_at` ordering once a route reaches `completed`. Read-only reporting of the
  planned-vs-actual gap (block order vs. actual arrival order) is presentation over this column; no
  further write path.

## Open questions for implementation

- Where exactly the block-review UI lives in the route builder flow relative to spec-70's `loading`
  state — before staging begins, or editable up until seal — needs a product decision, not an
  assumption here.
- Whether `route_blocks.sequence_index` should be unique per `route_id` (strict total order) is left
  to the SQL suite to decide and enforce; this doc treats it as an obvious yes but doesn't encode a
  `CHECK`/`UNIQUE` for it above since the right enforcement (constraint vs. application-level
  renumber-on-write) depends on how phase 3's reorder UI is built.
