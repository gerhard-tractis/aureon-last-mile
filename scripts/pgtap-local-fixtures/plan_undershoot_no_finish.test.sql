-- Self-test fixture: plan(5) but the file only runs one assertion and never
-- calls finish() at all — no "# Looks like you..." diagnostic is printed
-- (that text only comes from finish()). A check that only looks for that
-- diagnostic string sees nothing and reports a pass (round 2 review, A-3).
-- Used only by scripts/pgtap-local.test.sh; not part of the product test suite.
BEGIN;
SELECT plan(5);
SELECT ok(true, 'only one runs');
ROLLBACK;
