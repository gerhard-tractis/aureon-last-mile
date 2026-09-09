-- Self-test fixture: the repo's non-pgTAP house style — a plain
-- RAISE EXCEPTION inside a DO block, no plan()/ok()/finish() at all. Guards
-- against a rewrite of the TAP-parsing logic accidentally deleting the
-- pre-existing ERROR:/psql: error: detection this PR promises not to touch
-- (round 2 review, A-5).
-- Used only by scripts/pgtap-local.test.sh; not part of the product test suite.
DO $$
BEGIN
  RAISE EXCEPTION 'fixture: this assertion always fails';
END $$;
