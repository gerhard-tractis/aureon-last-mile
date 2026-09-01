-- spec-72 phase 2 — the default sequencing writer.
--
-- Scope, per the spec's "Implementation phases": "When a route is
-- created/seeded (Pre-ruta or the manual builder), populate route_blocks
-- from the route's comuna composition in whatever order they were added,
-- sequence_source = 'default'." No map, no drag-and-drop, no optimiser —
-- Non-Goals untouched. This is the *only* writer route_blocks has had since
-- phase 1 shipped the empty table.
--
-- Where routes get seeded: apps/frontend/src/app/api/dispatch/routes/route.ts
-- POST calls RPC create_seeded_route(p_operator_id, p_order_ids, p_route_date)
-- for both Pre-ruta (useCreateRouteFromSelection) and the dispatch page's
-- order-selection flow ("the manual builder" per spec-72's own phrasing —
-- there is no other order-attaching entry point; the empty-draft branch of
-- that same file (createEmptyDraft) inserts a route with zero dispatches and
-- never calls create_seeded_route, so there is no comuna composition to seed
-- there). create_seeded_route is therefore the single hook point; template
-- for CREATE OR REPLACE is its LATEST definition,
-- 20260825000003_spec70_seeded_route_planned.sql, per CLAUDE.md.
--
-- KNOWN GAP, recorded per review (not fixed here — see the phase 3 bullet of
-- docs/specs/spec-72-blocks-delivery-sequence.md for the full writeup): this
-- writer runs exactly once, at route creation/seeding. It is deliberately
-- NOT hooked into apps/frontend/src/app/api/dispatch/routes/[id]/scan/route.ts's
-- 'adopt' branch — that file is spec-74's contended territory this branch
-- must not touch — even though scan-adopt inserts a dispatch directly onto
-- an EXISTING route after seeding already ran. An order adopted that way can
-- carry a non-NULL comuna_id yet end up with NO block: it isn't in any block
-- (seeding already happened) and it isn't in the "sin comuna" bucket either
-- (its comuna_id is not NULL) — it is simply invisible to a consumer that
-- trusts route_blocks as a complete manifest, which is exactly the silent
-- drop spec-72's data-model section forbids. Phase 3 MUST independently
-- surface this case (comuna_id IS NOT NULL AND no live block covers it) and
-- must not assume the block list is complete. This also means
-- createEmptyDraft (apps/frontend/src/app/api/dispatch/routes/route.ts),
-- which creates a route with zero dispatches and never calls
-- create_seeded_route, produces routes that can ONLY ever gain dispatches
-- via scan-adopt (INSERT INTO dispatches exists in exactly two places
-- repo-wide: create_seeded_route and scan-adopt) — so an empty-draft route
-- will NEVER have any blocks at all until a later phase closes this gap.
--
-- Split into its own function, seed_default_route_blocks(route, operator,
-- order_ids), rather than inlined only in create_seeded_route, for two
-- reasons:
--   1. Idempotency is a first-class property the spec's phase 2 write-up asks
--      about directly, and testing "re-run on a route that already has
--      blocks" is cleaner against a named, independently callable function.
--   2. create_seeded_route always mints a brand-new route_id, so it can never
--      itself exercise the "already has blocks" branch — a dedicated
--      function is what makes that branch reachable and testable at all
--      (e.g. a future phase re-seeding, or a retry after a partial failure).
--
-- It is GRANTed to authenticated (like every sibling RPC in this schema),
-- so it is directly callable today, standalone, ahead of any phase-3 caller
-- existing — which is exactly why it gets the same route-ownership lock and
-- ROUTE_NOT_FOUND contract as spec-71's assign_load_position /
-- release_load_position / check_load_position_conflict
-- (20260827000003:159-171), not just the brand-new, already-trusted
-- route_id create_seeded_route always hands it.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. seed_default_route_blocks — the default sequencing writer.
-- ---------------------------------------------------------------------------
--
-- Default order = the order dispatches were added to the route (spec-72
-- Decision 2: "comuna order as it came off Pre-ruta/the route builder"),
-- taking each comuna's FIRST appearance.
--
-- Ordering is driven by p_order_ids — the caller's own authoritative array
-- (the same one create_seeded_route already holds and uses for its
-- INSERT INTO dispatches), not by any property of the dispatches heap.
-- dispatches is one of the most heavily UPDATEd tables in this schema —
-- every stage transition, every webhook sync, every arrived_at/completed_at
-- write moves the touched row. A single ordinary UPDATE relocates it to
-- wherever the free-space map next places it, which INVERTS whatever
-- "physical row order" happened to hold right after INSERT. This was
-- reproduced directly: seeding a route with orders in comuna order
-- [C-Uno, C-Dos] produced blocks in that order; one UPDATE on the earlier
-- dispatch row, followed by a fresh re-seed, flipped the derived order to
-- [C-Dos, C-Uno]. Heap placement is FSM-chosen, not append-ordered — an
-- implementation detail, never a guarantee — so the previous MIN(ctid)
-- tiebreak was reading noise as if it were signal. unnest(p_order_ids) WITH
-- ORDINALITY instead gives each order_id its 1-based position in the
-- caller's own array directly: no heap-order inference, and it stays
-- correct no matter how many UPDATEs land on those dispatch rows afterward,
-- because it never looks at where the rows physically live.
--
-- MIN(d.created_at) remains as the fallback tiebreak for a standalone
-- re-run with p_order_ids NULL (or for any order id absent from the
-- supplied array, defensively) — the same statement-level-timestamp caveat
-- as before still applies there (every row from one INSERT...SELECT shares
-- one now()), but a caller that omits the authoritative array has already
-- opted out of an exact order, and this remains a strictly better default
-- than an arbitrary one.
--
-- Orders whose comuna_id IS NULL are excluded from the SELECT entirely —
-- per spec-72's data-model section, that order must never join into a block;
-- it is surfaced as "sin comuna" at the app layer (phase 3), not silently
-- folded in or dropped from the route's manifest (it is still visible via
-- the dispatches->orders join itself, same as any live dispatch). See the
-- KNOWN GAP note in the header comment for the scan-adopt case where an
-- order CAN carry a comuna_id and still end up with no block.
--
-- Idempotent by construction: if the route already has ANY live
-- (deleted_at IS NULL) row in route_blocks, this is a no-op. That is what
-- keeps a re-run safe two different ways — it does not duplicate/renumber a
-- route already seeded 'default', and critically it never clobbers a
-- manager's 'manual' reorder (phase 3) by re-deriving 'default' order over
-- it. A route's block list is seeded exactly once under normal operation;
-- every change after that first write is a deliberate write by something
-- else (phase 3's reorder, eventually phase 2's 'optimizer' counterpart),
-- not a re-derivation.
--
-- DECISION (soft-deleted-blocks case, per review): the no-op guard checks
-- deleted_at IS NULL, so a route whose blocks were ALL soft-deleted (e.g. a
-- future phase-3 "clear the block list" action) has zero LIVE blocks, and
-- this function re-seeds it as 'default' on the very next call — exactly
-- as if it had never been seeded at all. This is deliberate, not an
-- oversight: this function has no way to distinguish "never seeded" from
-- "explicitly cleared down to nothing" — both look identical from here as
-- "zero live rows" — and there is nothing left to protect in the
-- zero-live-blocks state, unlike the one-or-more-live-blocks case where a
-- real 'manual' order exists and must never be silently overwritten.
-- Re-deriving a default order over an empty block list therefore does not
-- discard anything a manager typed, because nothing manual is live to
-- discard. A future feature that wants a stronger "removed means removed,
-- never re-seed" contract is a deliberately different guarantee than this
-- function provides and must be built as that feature's own explicit
-- choice (e.g. a tombstone/sentinel row, or simply never calling this
-- function again for that route) — it does not fall out of this one for
-- free. TEST 6 in the pgTAP suite proves this exact case.
CREATE OR REPLACE FUNCTION public.seed_default_route_blocks(
  p_route_id    uuid,
  p_operator_id uuid,
  p_order_ids   uuid[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_route RECORD;
BEGIN
  -- Lock and validate the route first, matching spec-71's precedent
  -- (assign_load_position / release_load_position / check_load_position_conflict,
  -- 20260827000003:159-171): a foreign or nonexistent route must never be a
  -- silent no-op returning success. FOR UPDATE here is also what actually
  -- serializes two concurrent standalone calls against the same route — the
  -- second caller blocks on this lock until the first commits, so its own
  -- EXISTS check below correctly observes the first call's rows and
  -- no-ops, instead of both calls racing past a lock-free EXISTS and one of
  -- them hitting a raw 23505 unique_route_block_sequence violation.
  SELECT id INTO v_route
    FROM public.routes
   WHERE id = p_route_id
     AND operator_id = p_operator_id
     AND deleted_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUTE_NOT_FOUND: route % for operator %', p_route_id, p_operator_id
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM route_blocks
     WHERE route_id = p_route_id AND deleted_at IS NULL
  ) THEN
    RETURN;
  END IF;

  INSERT INTO route_blocks (operator_id, route_id, comuna_id, sequence_index, sequence_source)
  SELECT
    p_operator_id,
    p_route_id,
    comunas.comuna_id,
    row_number() OVER (ORDER BY comunas.first_pos, comunas.first_seen),
    'default'
  FROM (
    SELECT
      o.comuna_id,
      MIN(COALESCE(ord.n, 2147483647)) AS first_pos,  -- caller's array
                                                        -- position; see
                                                        -- header comment
      MIN(d.created_at)                AS first_seen  -- fallback tiebreak
                                                        -- only
    FROM dispatches d
    JOIN orders o
      ON o.id = d.order_id
     AND o.operator_id = d.operator_id
    LEFT JOIN unnest(COALESCE(p_order_ids, '{}'::uuid[])) WITH ORDINALITY AS ord(oid, n)
           ON ord.oid = d.order_id
    WHERE d.route_id     = p_route_id
      AND d.operator_id  = p_operator_id
      AND d.deleted_at   IS NULL
      AND o.deleted_at   IS NULL
      AND o.comuna_id    IS NOT NULL
    GROUP BY o.comuna_id
  ) comunas;
END;
$$;

COMMENT ON FUNCTION public.seed_default_route_blocks(uuid, uuid, uuid[]) IS
  'spec-72 phase 2. Populates route_blocks with sequence_source=''default'' '
  'from a route''s current comuna composition (dispatches -> orders join, '
  'ordered by each comuna''s first position in p_order_ids -- NOT heap/ctid '
  'order, which inverts under ordinary dispatches UPDATEs -- falling back '
  'to first-seen created_at when p_order_ids is omitted). Raises '
  'ROUTE_NOT_FOUND (P0002) for a route that does not exist / is not this '
  'operator''s, matching spec-71''s load-position RPCs. No-op if the route '
  'already has any live route_blocks row -- never re-derives over a manual '
  '(phase 3) or optimizer reorder; a route with zero LIVE blocks (never '
  'seeded, or all soft-deleted) is re-seeded on the next call by design, '
  'since nothing manual is live to clobber in that state. Orders with '
  'comuna_id IS NULL are excluded (spec-72: surfaced as ''sin comuna'', '
  'never folded into a block). KNOWN GAP: an order added to an existing '
  'route via scan-adopt after this has already run once gets no block at '
  'all -- see the migration header comment and spec-72 phase 3.';

GRANT EXECUTE ON FUNCTION public.seed_default_route_blocks(uuid, uuid, uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. create_seeded_route — call the writer after the dispatches insert.
-- ---------------------------------------------------------------------------
--
-- Same three-argument signature as the latest definition
-- (20260825000003_spec70_seeded_route_planned.sql), reproduced in full per
-- CLAUDE.md's CREATE OR REPLACE rule (build from the newest version). Only
-- change: one PERFORM after the dispatches INSERT, still inside the same
-- implicit transaction as the function body, so the route, its dispatches,
-- and its default blocks are created atomically or not at all. p_order_ids
-- (already text[] here) is cast to uuid[] and passed straight through as
-- the authoritative array order — see seed_default_route_blocks's header
-- comment for why that replaced ctid-based ordering.

CREATE OR REPLACE FUNCTION public.create_seeded_route(
  p_operator_id uuid,
  p_order_ids   text[],
  p_route_date  date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_route_id    uuid;
  v_external_id text;
  v_route_date  date;
  v_route       jsonb;
BEGIN
  v_external_id := 'draft_' || gen_random_uuid()::text;
  v_route_date  := COALESCE(p_route_date, CURRENT_DATE);

  INSERT INTO routes (
    operator_id,
    provider,
    external_route_id,
    route_date,
    status,
    planned_stops,
    completed_stops
  )
  VALUES (
    p_operator_id,
    'dispatchtrack',
    v_external_id,
    v_route_date,
    'planned',
    array_length(p_order_ids, 1),
    0
  )
  RETURNING id INTO v_route_id;

  -- stage defaults to 'planned' (20260825000002), which is exactly right here:
  -- these stops are on the plan and nothing has been physically confirmed.
  INSERT INTO dispatches (route_id, order_id, operator_id, status, provider)
  SELECT
    v_route_id,
    order_id::uuid,
    p_operator_id,
    'pending',
    'dispatchtrack'
  FROM unnest(p_order_ids) AS order_id;

  -- spec-72 phase 2: seed this route's default block sequence from the
  -- comuna composition just inserted above, in p_order_ids's own order. A
  -- brand-new route_id from this function has no existing route_blocks
  -- rows, so this always populates (the no-op branch exists for
  -- seed_default_route_blocks's other callers, not for this one).
  PERFORM public.seed_default_route_blocks(v_route_id, p_operator_id, p_order_ids::uuid[]);

  SELECT to_jsonb(r)
  INTO v_route
  FROM (
    SELECT id, status, route_date, created_at
    FROM routes
    WHERE id = v_route_id
  ) r;

  RETURN v_route;
END;
$$;

COMMENT ON FUNCTION public.create_seeded_route(uuid, text[], date) IS
  'spec-70 phase 2, extended spec-72 phase 2. Creates a route at `planned` '
  'with one dispatch per order at stage `planned`, then seeds route_blocks '
  'with the route''s default (comuna-order-of-arrival, per p_order_ids) '
  'sequence via seed_default_route_blocks. Ownership and already-routed '
  'validation stay in the API layer; this function only writes.';

GRANT EXECUTE ON FUNCTION public.create_seeded_route(uuid, text[], date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Verification
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'seed_default_route_blocks'
  ) THEN
    RAISE EXCEPTION 'seed_default_route_blocks function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'create_seeded_route'
  ) THEN
    RAISE EXCEPTION 'create_seeded_route function missing';
  END IF;
  RAISE NOTICE '✓ spec-72 phase 2 (seed_default_route_blocks, create_seeded_route) migration complete';
END $$;

COMMIT;
