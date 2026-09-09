-- Self-test fixture: two independent plan()/finish() blocks in one file,
-- separated by ROLLBACK (which resets pgTAP's session state — a second
-- plan() in the SAME transaction as the first raises "You tried to plan
-- twice!" instead). Both blocks genuinely pass. Kills the plan-summing
-- regression to `head -1` (round 3 review): taking only the first "1..1"
-- against the file's TOTAL ok count (2) is a false plan mismatch —
-- measured before this fixture existed: FAIL, pass=2 fail=1, on a file
-- with nothing wrong in it.
-- Used only by scripts/pgtap-local.test.sh; not part of the product test suite.
BEGIN;
SELECT plan(1);
SELECT ok(true, 'first block');
SELECT * FROM finish();
ROLLBACK;

BEGIN;
SELECT plan(1);
SELECT ok(true, 'second block');
SELECT * FROM finish();
ROLLBACK;
