-- spec-61 Task 1.1 — user_role carries pickup_leader.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'user_role' AND e.enumlabel = 'pickup_leader'
  ) THEN
    RAISE EXCEPTION 'user_role has no pickup_leader value';
  END IF;
END $$;

-- The value must be usable as a value, not merely present in the catalog.
DO $$
DECLARE v public.user_role;
BEGIN
  v := 'pickup_leader'::public.user_role;
  IF v::text <> 'pickup_leader' THEN
    RAISE EXCEPTION 'cast round-trip failed: %', v;
  END IF;
END $$;

ROLLBACK;
