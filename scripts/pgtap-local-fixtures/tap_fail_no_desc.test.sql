-- Self-test fixture: a pgTAP one-arg assertion (`ok(false)`, no description)
-- prints a bare "not ok N" with no trailing space or dash — the exact shape
-- a space-anchored regex ("not ok N ") misses (round 2 review, A-1).
-- Used only by scripts/pgtap-local.test.sh; not part of the product test suite.
BEGIN;
SELECT plan(1);
SELECT ok(false);
SELECT * FROM finish();
ROLLBACK;
