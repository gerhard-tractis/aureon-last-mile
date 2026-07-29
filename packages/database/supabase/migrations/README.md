# Supabase Migrations

Schema history for the Aureon Last Mile database. **The Supabase CLI is the only
supported way to apply these.** Do not paste SQL into the dashboard SQL Editor —
that is how `operators` and `audit_logs` ended up existing in production with no
migration that creates them (fixed by `20260209000004_bootstrap_operators_audit_logs.sql`).

## Applying migrations

Production is deployed automatically. `.github/workflows/deploy.yml` runs

```bash
supabase db push --include-all
```

on every green push to `main` that touches `migrations/**`, `seed.sql`, or
`config.toml`. You should not need to run this by hand.

`--include-all` is required: the repo has migrations whose timestamps are older
than the last one applied remotely (PRs merge out of order), and without it the
CLI refuses to apply them.

## Local development

```bash
supabase start          # boot the local stack
supabase db reset       # drop, replay every migration, then run ../seed.sql
```

`db reset` is the check that matters — if it fails, the repo can no longer
rebuild its own schema, and staging/DR are blocked. Run it before opening a PR
that adds a migration.

## Writing a migration

Naming: `YYYYMMDDHHMMSS_snake_case_description.sql`. Two conventions are in use
(real clock timestamps and date + 6-digit sequence); prefer the sequence form
for new work and never reuse a timestamp.

House rules (`docs/architecture.md`):

- Every tenant table gets `operator_id UUID NOT NULL`, `created_at`,
  `updated_at`, and `deleted_at`. Soft deletes only — no `DELETE`.
- RLS enabled with a tenant-scoped policy on every table.
- `SECURITY DEFINER` functions must derive the tenant internally via
  `public.get_operator_id()` — never trust a caller-supplied `p_operator_id` —
  and must pin `SET search_path`.
- When rewriting a function with `CREATE OR REPLACE`, use the **latest**
  migration's definition as the template, never the original, and cite it:
  `-- Template: latest definition from <file>`.
- End destructive migrations with a `DO $$ ... RAISE EXCEPTION` block that
  asserts **row counts**, not just that objects exist. See
  `20260625000001_spec47_pickup_routes_consolidated_reception.sql` for the shape.

## Tests

`../tests/` holds pgTAP-style SQL tests covering RLS and migration invariants.
They are not yet wired into CI — see `REMEDIATION.md` (H2).

## Notes on history

- `20260209_multi_tenant_rls.sql.bak` is kept for provenance only. It is
  disabled on purpose; its still-needed DDL now lives in
  `20260209000004_bootstrap_operators_audit_logs.sql`.
- Several tenant-specific data migrations (Musan, Paris, Easy connector config)
  are baked into schema history. That was a mistake we are not unwinding —
  going forward, tenant configuration belongs behind an admin RPC, not in a
  migration.
