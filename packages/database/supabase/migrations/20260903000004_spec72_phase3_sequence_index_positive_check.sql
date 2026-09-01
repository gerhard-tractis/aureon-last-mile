-- spec-72 phase 3 — enforce sequence_index > 0 as a real constraint.
--
-- Review item 5: the whole "every real sequence_index is a positive 1-based
-- position" claim `move_route_block`'s offset swap (20260903000003) relies
-- on for collision-freedom lived only in a comment before this migration
-- (20260903000001_spec72_route_blocks.sql:31). Nothing enforced it, and
-- `authenticated` holds UPDATE on `route_blocks` directly (that same
-- migration's GRANT), so a direct PostgREST write could set a block to `0`
-- or a negative value without going through `move_route_block` at all —
-- reproduced by the reviewer: a block sitting at sequence_index 0 or a
-- negative value corrupts the strict total order the reorder/append writers
-- both depend on.
--
-- NOTE on ordering with 20260903000003: an earlier draft of
-- `move_route_block` parked its moved block at a NEGATIVE intermediate
-- sequence_index, which this CHECK would itself have rejected the moment
-- both migrations were live together — caught directly by this suite (see
-- spec72_phase3_reorder_route_block.test.sql) before it ever shipped.
-- `move_route_block`'s current definition parks at `MAX(live
-- sequence_index) + 1` instead (still strictly positive, still guaranteed
-- collision-free by construction), so the two migrations are consistent
-- regardless of application order — this CHECK does not depend on
-- `move_route_block` having landed first, and vice versa.
--
-- A plain CHECK, not a partial index — this is a per-row invariant
-- (`sequence_index > 0`), not a per-route uniqueness rule, so it belongs
-- next to `sequence_source`'s own CHECK on the same table
-- (20260903000001:32-33), added the same idempotent way every CHECK in this
-- migration's own style is added elsewhere in the repo.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.route_blocks'::regclass
       AND conname  = 'route_blocks_sequence_index_positive'
  ) THEN
    ALTER TABLE public.route_blocks
      ADD CONSTRAINT route_blocks_sequence_index_positive CHECK (sequence_index > 0);
  END IF;
END $$;

COMMENT ON CONSTRAINT route_blocks_sequence_index_positive ON public.route_blocks IS
  'spec-72 phase 3 review item 5. Every live sequence_index must be a '
  'positive 1-based position -- both move_route_block''s offset-swap park '
  '(MAX(live sequence_index)+1) and seed_default_route_blocks'' append '
  '(also MAX(...)+1) depend on this holding for every OTHER live row too. '
  'Previously only a comment; now enforced against direct writes '
  '(authenticated holds UPDATE on this table via PostgREST) as well as any '
  'RPC.';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.route_blocks'::regclass
       AND conname  = 'route_blocks_sequence_index_positive'
  ) THEN
    RAISE EXCEPTION 'route_blocks_sequence_index_positive CHECK missing';
  END IF;
  RAISE NOTICE '✓ spec-72 phase 3 (sequence_index > 0 CHECK) migration complete';
END $$;

COMMIT;
