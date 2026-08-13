-- The storage service creates its own buckets at startup, so on a clean
-- rebuild this INSERT races it: bring the Docker stack up first and the row
-- already exists, making the migration fail with
--   duplicate key value violates unique constraint "buckets_pkey"
-- and leaving the ledger short. Observed replaying all 120 migrations onto an
-- empty QA database (spec-51).
--
-- ON CONFLICT DO NOTHING makes the outcome independent of that ordering.
-- Editing an applied migration is safe here: it is recorded by version, not
-- checksum, so it never re-runs anywhere it has already been applied.
insert into storage.buckets
  (id, name, public)
values
  ('files', 'files', false)
on conflict (id) do nothing;
