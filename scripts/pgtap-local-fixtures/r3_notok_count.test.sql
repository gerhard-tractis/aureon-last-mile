-- Self-test fixture: plan(3) with three real failing assertions and zero
-- passing ones. Kills the `ran_n=$((ok_n + notok_n))` -> `ran_n=$((ok_n))`
-- mutant (round 3 review): without not-ok counted into ran_n, this file's
-- plan (3) looks like it "ran" 0, producing a spurious plan-mismatch on top
-- of the three real failures — fail=6 instead of the correct fail=3.
-- Used only by scripts/pgtap-local.test.sh; not part of the product test suite.
BEGIN;
SELECT plan(3);
SELECT ok(false, 'first fails');
SELECT ok(false, 'second fails');
SELECT ok(false, 'third fails');
SELECT * FROM finish();
ROLLBACK;
