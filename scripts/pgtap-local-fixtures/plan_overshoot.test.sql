-- Self-test fixture: more assertions run than plan() declared. pgTAP prints
-- "# Looks like you planned 1 test but ran 2" — a real TAP failure that a
-- shortfall-only check (missing = planned - ran, clamped at 0) discards as
-- a pass (round 2 review, A-2).
-- Used only by scripts/pgtap-local.test.sh; not part of the product test suite.
BEGIN;
SELECT plan(1);
SELECT ok(true, 'first');
SELECT ok(true, 'second');
SELECT * FROM finish();
ROLLBACK;
