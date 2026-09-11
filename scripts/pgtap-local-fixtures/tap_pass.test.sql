-- Self-test fixture for scripts/pgtap-local.sh — a pgTAP file that passes.
-- Used only by scripts/pgtap-local.test.sh; not part of the product test suite.
BEGIN;
SELECT plan(1);
SELECT ok(true, 'trivially true');
SELECT * FROM finish();
ROLLBACK;
