-- spec-72 phase 3 — the manager reorder writer.
--
-- Scope, per docs/specs/spec-72-blocks-delivery-sequence.md's phase 3
-- bullet: "move-up/move-down buttons to reorder — no drag-and-drop ... —
-- writing sequence_index + sequence_source = 'manual' on any change." This
-- migration adds exactly the one write path phase 3's UI needs: moving one
-- block up or down by one position, renumbering safely under
-- unique_route_block_sequence (20260903000001), a partial unique index on
-- (route_id, sequence_index) WHERE deleted_at IS NULL.
--
-- A naive two-statement swap ("UPDATE block A SET sequence_index = seq_b;
-- UPDATE block B SET sequence_index = seq_a;") raises a real
-- unique_route_block_sequence violation, not just a transient one visible
-- to other transactions: `unique_route_block_sequence` is a plain
-- CREATE UNIQUE INDEX, not a DEFERRABLE constraint, so Postgres checks it
-- immediately after each row is written — even rows written by the SAME
-- UPDATE statement are checked as they are produced, not deferred to
-- end-of-statement. This was verified directly against this migration's own
-- pgTAP suite: a single `UPDATE ... FROM (VALUES ...)` statement swapping
-- both rows' sequence_index in one statement still raised
-- `duplicate key value violates unique constraint "unique_route_block_sequence"`
-- — there is no single-statement shortcut around this index the way there
-- would be for a `DEFERRABLE INITIALLY DEFERRED` constraint.
--
-- The fix is the offset the spec's Open Questions section anticipates
-- ("renumbering via a temporary offset if needed"): three UPDATEs inside
-- this one function call (one transaction, atomic regardless of statement
-- count — the whole function either commits or rolls back with its
-- caller). The moved block is parked at `MAX(live sequence_index on this
-- route) + 1` first — guaranteed not to collide with any live row,
-- including the neighbour's, since it is strictly greater than every one
-- of them by construction — freeing its old slot for the neighbour, then
-- the moved block is written into the neighbour's old slot. No other
-- session can observe an intermediate duplicate (each UPDATE commits its
-- row change within this function's transaction, invisible to concurrent
-- readers until commit) and no state is left inconsistent if the function
-- is interrupted, because the whole sequence runs under the same route
-- lock acquired below.
--
-- NOT a negative park: an earlier version of this function parked the
-- moved block at `-1 * v_block.sequence_index`, trading on "every real
-- sequence_index is a positive 1-based position, so nothing collides
-- below zero." Review item 5 turned that same claim into a real `CHECK
-- (sequence_index > 0)` (20260903000004) — enforced against direct writes
-- too, since `authenticated` holds UPDATE on this table — which a negative
-- intermediate value would itself violate. `MAX(...) + 1` gets the same
-- collision-freedom without ever leaving the positive range the CHECK now
-- requires.
--
-- Route ownership lock: SELECT ... FOR UPDATE on the route first, exactly
-- seed_default_route_blocks's own pattern (itself modeled on spec-71's
-- assign_load_position/release_load_position/check_load_position_conflict,
-- 20260827000003:159-171) — a foreign or nonexistent route raises
-- ROUTE_NOT_FOUND (P0002), never a silent no-op, and the lock serializes
-- concurrent reorders against the same route so two managers clicking
-- move-up/move-down at once cannot interleave and produce a duplicate
-- sequence_index.
--
-- Status window (review item 1, resolving spec-72's Open Questions entry on
-- this exact point in the SAFE direction): reordering is only permitted
-- while the route is still in `LOADABLE_ROUTE_STATUSES`
-- (apps/frontend/src/lib/dispatch/types.ts) — 'draft', 'planned', 'loading'
-- — the identical set `packages/[pkgId]/route.ts`'s DELETE (REMOVABLE_FROM)
-- already gates removal on, and for the same reason: past `loaded` the
-- manifest is sealed (/seal already confirmed every remaining stop is
-- staged or adopted), and past `dispatched` the route is a one-way door
-- (decision 6, DELETE /routes/[id]). Reordering a dispatched route would
-- write sequence_source='manual' onto a plan that already shipped — per
-- spec-72 Decision 3 there is no outbound push, so nothing reconciles what
-- DispatchTrack/the driver already has, and phase 5's planned-vs-actual
-- diff would then be comparing actual_sequence against a block order edited
-- after the fact. Enforced here (not only in the HTTP handler) so a direct
-- RPC call is blocked too, raising a distinct ROUTE_SEALED (P0001) the
-- handler maps to 409 — never the same P0002 ROUTE_NOT_FOUND/BLOCK_NOT_FOUND
-- use, so the client can tell "doesn't exist" from "exists but is closed
-- for editing" apart.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. move_route_block — swap one block with its immediate neighbour.
-- ---------------------------------------------------------------------------
--
-- p_direction: 'up' moves the block one position earlier (lower
-- sequence_index, delivered sooner); 'down' moves it one position later.
-- Moving the first block up, or the last block down, is a no-op (there is
-- no neighbour to swap with) — not an error, since a manager clicking the
-- now-pointless button at the edge of the list is a UI state the button
-- itself should disable, but this function does not trust the client to
-- have done that.
--
-- Both blocks touched must be LIVE (deleted_at IS NULL) and belong to this
-- route/operator — the neighbour lookup itself is scoped by route_id, same
-- as the target block, so a soft-deleted or foreign row can never become
-- the swap partner.
CREATE OR REPLACE FUNCTION public.move_route_block(
  p_route_id    uuid,
  p_operator_id uuid,
  p_block_id    uuid,
  p_direction   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_route     RECORD;
  v_block     RECORD;
  v_neighbor  RECORD;
  v_park      INTEGER;
BEGIN
  IF p_direction NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'INVALID_DIRECTION: % (expected up or down)', p_direction
      USING ERRCODE = '22023';
  END IF;

  -- Lock the route first — same contract as seed_default_route_blocks: a
  -- foreign or missing route is never a silent no-op, and the lock
  -- serializes concurrent reorders against this route so two overlapping
  -- move calls cannot both read the pre-swap state and race each other
  -- into a unique_route_block_sequence violation.
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

  -- Status window — see header comment. A route past 'loading' is sealed or
  -- a one-way door; reordering it is refused, not silently accepted.
  IF v_route.status NOT IN ('draft', 'planned', 'loading') THEN
    RAISE EXCEPTION 'ROUTE_SEALED: route % is % ; blocks can only be reordered before loading completes', p_route_id, v_route.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT id, sequence_index INTO v_block
    FROM public.route_blocks
   WHERE id = p_block_id
     AND route_id = p_route_id
     AND operator_id = p_operator_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK_NOT_FOUND: block % on route % for operator %', p_block_id, p_route_id, p_operator_id
      USING ERRCODE = 'P0002';
  END IF;

  -- The neighbour is the live block on this route with the next
  -- sequence_index in the requested direction — not necessarily
  -- "v_block.sequence_index +/- 1" as a literal value, in case the list
  -- ever carries gaps (e.g. a soft-deleted block leaves one behind); this
  -- still picks the correct adjacent block by rank, not by arithmetic on a
  -- value that isn't guaranteed contiguous.
  IF p_direction = 'up' THEN
    SELECT id, sequence_index INTO v_neighbor
      FROM public.route_blocks
     WHERE route_id = p_route_id
       AND operator_id = p_operator_id
       AND deleted_at IS NULL
       AND sequence_index < v_block.sequence_index
     ORDER BY sequence_index DESC
     LIMIT 1;
  ELSE
    SELECT id, sequence_index INTO v_neighbor
      FROM public.route_blocks
     WHERE route_id = p_route_id
       AND operator_id = p_operator_id
       AND deleted_at IS NULL
       AND sequence_index > v_block.sequence_index
     ORDER BY sequence_index ASC
     LIMIT 1;
  END IF;

  -- Already at the edge — no neighbour to swap with. Not an error: the
  -- caller (UI) is expected to disable the button here, but a stale click
  -- must not fail loudly for a state that isn't actually wrong.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Three-step offset swap (see header comment for why a single-statement
  -- swap still raises a real unique_route_block_sequence violation on this
  -- plain, non-deferrable unique index). sequence_source is set to
  -- 'manual' on the moved block only — per spec-72 Decision 2, "manual"
  -- records that A MANAGER reordered this structure; the neighbour didn't
  -- move because of a manager's choice about IT, only as an unavoidable
  -- side effect of the block that did, so only the block the manager
  -- actually acted on is stamped 'manual'.
  --
  -- Step 1: park the moved block at MAX(live sequence_index on this
  -- route) + 1 — never a collision, since it is strictly greater than
  -- every live row's sequence_index by construction, and still positive
  -- (route_blocks_sequence_index_positive, 20260903000004). This frees
  -- v_block.sequence_index for the neighbour.
  SELECT MAX(sequence_index) + 1 INTO v_park
    FROM public.route_blocks
   WHERE route_id = p_route_id AND operator_id = p_operator_id AND deleted_at IS NULL;

  UPDATE public.route_blocks
     SET sequence_index = v_park
   WHERE id = v_block.id
     AND route_id = p_route_id
     AND operator_id = p_operator_id
     AND deleted_at IS NULL;

  -- Step 2: the neighbour takes the moved block's old (now-free) slot.
  UPDATE public.route_blocks
     SET sequence_index = v_block.sequence_index
   WHERE id = v_neighbor.id
     AND route_id = p_route_id
     AND operator_id = p_operator_id
     AND deleted_at IS NULL;

  -- Step 3: the moved block lands in the neighbour's old slot (now free,
  -- since step 2 moved the neighbour off it) and is stamped 'manual'.
  UPDATE public.route_blocks
     SET sequence_index = v_neighbor.sequence_index,
         sequence_source = 'manual'
   WHERE id = v_block.id
     AND route_id = p_route_id
     AND operator_id = p_operator_id
     AND deleted_at IS NULL;
END;
$$;

COMMENT ON FUNCTION public.move_route_block(uuid, uuid, uuid, text) IS
  'spec-72 phase 3. Swaps one block''s sequence_index with its immediate '
  'live neighbour (p_direction: up = earlier, down = later) in a single '
  'UPDATE ... FROM statement, so unique_route_block_sequence (partial '
  'unique on (route_id, sequence_index) WHERE deleted_at IS NULL) never '
  'transiently sees a duplicate. Only the block the manager acted on is '
  'stamped sequence_source=''manual''; its neighbour keeps its own '
  'provenance. A no-op (not an error) when the block is already at that '
  'edge of the list. Raises ROUTE_NOT_FOUND / BLOCK_NOT_FOUND (P0002) for '
  'a route/block that does not exist or is not this operator''s -- never a '
  'silent no-op on a bad id -- matching seed_default_route_blocks and '
  'spec-71''s load-position RPCs. Raises ROUTE_SEALED (P0001) once the '
  'route has left draft/planned/loading -- the same status window '
  'packages/[pkgId] DELETE (REMOVABLE_FROM) gates removal on.';

GRANT EXECUTE ON FUNCTION public.move_route_block(uuid, uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Verification
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'move_route_block'
  ) THEN
    RAISE EXCEPTION 'move_route_block function missing';
  END IF;
  RAISE NOTICE '✓ spec-72 phase 3 (move_route_block) migration complete';
END $$;

COMMIT;
