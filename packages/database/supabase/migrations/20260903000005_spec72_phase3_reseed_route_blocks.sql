-- spec-72 phase 3 — make seed_default_route_blocks re-runnable (item 2).
--
-- Phase 2's own migration header names this as the follow-up work explicitly
-- deferred to phase 3 (20260903000002:262-274, and
-- docs/specs/spec-72-blocks-delivery-sequence.md:262-274): "Proposed fix,
-- for phase 3 to pick up (not built in phase 2)." Without it, an
-- empty-draft route (`createEmptyDraft`, which never calls
-- `create_seeded_route`) or any route that gained orders via scan-adopt
-- after its first seeding, renders zero blocks and N orphan rows in the
-- phase 3 review UI with no button and no path to ever get those orders
-- into the sequence — the reorder UI is permanently inert on exactly the
-- routes that need it.
--
-- CREATE OR REPLACE template is the latest prior definition of this
-- function, 20260903000002_spec72_phase2_default_route_blocks.sql, per
-- CLAUDE.md's rule (build from the newest version, never the original).
--
-- The change, exactly as the deferred write-up specced it: the no-op guard
-- moves from "does ANY live block exist on this route" (all-or-nothing) to
-- an anti-join per comuna -- insert a block only for a comuna that has a
-- live dispatch on this route and does NOT already have a live
-- `route_blocks` row, at `MAX(sequence_index) + 1, + 2, ...` (deterministic
-- among the newly-inserted rows only, same p_order_ids-ordinality-then-
-- first-seen tiebreak as before). Existing rows -- 'manual' or 'default' --
-- are never touched: no UPDATE statement in this function body at all,
-- only an INSERT ... SELECT restricted to comunas the anti-join proves are
-- not yet covered. This is what keeps a manager's reorder (phase 3's own
-- writer, move_route_block) safe to call this again after: it can only
-- ever APPEND, never renumber or reassign anything already live.
--
-- Idempotency is preserved exactly as before, just scoped per-comuna
-- instead of per-route: calling this twice in a row with no new comunas
-- between calls inserts zero rows the second time (the anti-join finds
-- nothing left to add), which is what spec72_phase2_default_route_blocks.
-- test.sql's TEST 4/5/7 already assert and continue to pass unmodified
-- against this new definition -- none of those three scenarios introduces
-- a comuna the route didn't already have a live block for.
--
-- Status window, same reasoning and same set as move_route_block
-- (20260903000003, review item 1): appending a block to a manifest that
-- has already left draft/planned/loading is refused with ROUTE_SEALED
-- (P0001), not silently accepted. A route past `loaded` is sealed; a route
-- past `dispatched` is a one-way door (decision 6). The phase 3 UI's own
-- "Agregar a la secuencia" button is gated the same way client-side, but
-- the RPC enforces it independently for a direct PostgREST/RPC caller.
BEGIN;

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
  v_route   RECORD;
  v_max_seq INTEGER;
BEGIN
  -- Lock and validate the route first -- same contract as move_route_block
  -- and spec-71's load-position RPCs: a foreign or nonexistent route must
  -- never be a silent no-op returning success. FOR UPDATE also serializes
  -- two concurrent callers against the same route (e.g. a manager
  -- double-clicking "Agregar a la secuencia"), so the anti-join below
  -- always observes a consistent, already-committed prior state.
  SELECT id, status INTO v_route
    FROM public.routes
   WHERE id = p_route_id
     AND operator_id = p_operator_id
     AND deleted_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUTE_NOT_FOUND: route % for operator %', p_route_id, p_operator_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Status window -- see header comment. Matches move_route_block exactly.
  IF v_route.status NOT IN ('draft', 'planned', 'loading') THEN
    RAISE EXCEPTION 'ROUTE_SEALED: route % is % ; blocks can only be added before loading completes', p_route_id, v_route.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Current high-water mark among this route's live blocks. 0 on a
  -- brand-new route (create_seeded_route's call site), so new rows start
  -- at sequence_index 1 exactly as phase 2 always produced. On a re-run,
  -- new rows continue strictly after every existing live index -- never
  -- interleaving with, or renumbering, what's already there.
  SELECT COALESCE(MAX(sequence_index), 0) INTO v_max_seq
    FROM public.route_blocks
   WHERE route_id = p_route_id AND deleted_at IS NULL;

  INSERT INTO route_blocks (operator_id, route_id, comuna_id, sequence_index, sequence_source)
  SELECT
    p_operator_id,
    p_route_id,
    comunas.comuna_id,
    v_max_seq + row_number() OVER (ORDER BY comunas.first_pos, comunas.first_seen),
    'default'
  FROM (
    SELECT
      o.comuna_id,
      MIN(COALESCE(ord.n, 2147483647)) AS first_pos,  -- caller's array
                                                        -- position; see
                                                        -- original header
                                                        -- comment for why
                                                        -- ctid order is
                                                        -- untrustworthy
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
      -- The anti-join that turns this into an append: skip any comuna that
      -- already has a LIVE block on this route. This is the only
      -- behavioural change from phase 2's definition -- everything else
      -- (operator scoping, soft-delete filtering, NULL-comuna exclusion,
      -- the ordinality tiebreak) is unchanged.
      AND NOT EXISTS (
        SELECT 1 FROM public.route_blocks rb
         WHERE rb.route_id  = p_route_id
           AND rb.comuna_id = o.comuna_id
           AND rb.deleted_at IS NULL
      )
    GROUP BY o.comuna_id
  ) comunas;
END;
$$;

COMMENT ON FUNCTION public.seed_default_route_blocks(uuid, uuid, uuid[]) IS
  'spec-72 phase 2, made re-runnable in phase 3 (review item 2). Populates '
  'route_blocks with sequence_source=''default'' for every comuna that has '
  'a live dispatch on this route but no live block yet -- an anti-join on '
  '(route_id, comuna_id), so re-running this after new orders arrive '
  '(scan-adopt, or an empty-draft route''s first orders) APPENDS blocks at '
  'MAX(sequence_index)+1.. without ever touching an existing row, manual or '
  'default. Ordered by each comuna''s first position in p_order_ids -- NOT '
  'heap/ctid order -- falling back to first-seen created_at when '
  'p_order_ids is omitted or the order id is absent from it. Raises '
  'ROUTE_NOT_FOUND (P0002) for a route that does not exist / is not this '
  'operator''s, and ROUTE_SEALED (P0001) once the route has left '
  'draft/planned/loading -- same set and same reasoning as '
  'move_route_block (20260903000003). Orders with comuna_id IS NULL are '
  'excluded (surfaced as ''sin comuna'' at the app layer, never folded into '
  'a block).';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'seed_default_route_blocks'
  ) THEN
    RAISE EXCEPTION 'seed_default_route_blocks function missing';
  END IF;
  RAISE NOTICE '✓ spec-72 phase 3 (seed_default_route_blocks re-runnable) migration complete';
END $$;

COMMIT;
