-- Self-test fixture: pgTAP's todo() directive — a `not ok` carrying "# TODO"
-- is not a failure by TAP semantics (an expected, acknowledged failure), the
-- same way `ok N # SKIP` was already correctly excluded. Before round 3 this
-- file reported FAIL; it should report PASS.
-- Used only by scripts/pgtap-local.test.sh; not part of the product test suite.
BEGIN;
SELECT plan(2);
SELECT todo('not implemented yet');
SELECT ok(false, 'stub');
SELECT ok(true, 'second');
SELECT * FROM finish();
ROLLBACK;
