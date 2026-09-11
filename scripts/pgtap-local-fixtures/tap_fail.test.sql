-- Self-test fixture for scripts/pgtap-local.sh — a pgTAP file with a failing
-- assertion ("not ok"), the shape a real ERROR: grep never catches.
-- Used only by scripts/pgtap-local.test.sh; not part of the product test suite.
BEGIN;
SELECT plan(1);
SELECT ok(false, 'trivially false');
SELECT * FROM finish();
ROLLBACK;
