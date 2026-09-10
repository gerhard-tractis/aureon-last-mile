# Runbook: mutation-testing a migration with `pgtap-local.sh`

Referenced from `scripts/pgtap-local.sh`'s header comment. Read this before
trusting any red/green produced while mutating a migration to validate a
pgTAP test.

## Why this exists

Two agents independently produced a **perfect false-green** on 2026-09-10
while mutation-testing SQL against the local docker harness:

1. `apply` used to skip a migration purely by looking up its **version** in
   the ledger, never its content. A mutant applied to an already-applied
   version was silently skipped — the mutant never reached the database, and
   any pgTAP test run afterward "passed" against the unmutated original.
2. Separately, a hand-rolled `docker exec -i <c> psql -f /path/to/migration.sql`
   run from Git-Bash on Windows without `MSYS_NO_PATHCONV=1` silently
   resolves to a bogus `C:/Program Files/Git/...` path and fails with stderr
   most one-liners throw away — the mutant never lands, for a different
   reason, with the same wrong "pass".

`apply` now tracks a content hash per migration and refuses to silently
re-skip a changed file (see `scripts/pgtap-local-apply-inner.sh`), but that
alone does not prove a mutant reached the database. Follow all four steps
below every time.

## The four steps

### 0. Start from `up` — not optional

```
./scripts/pgtap-local.sh up
```

Any **pre-existing** container may hold migrations applied before the
content-hash guard existed, or before you started mutating today. `apply`
backfills a hash for those the first time it sees them — a loud
`unverified=` warning, counted apart from a real verified match — instead of
silently assuming today's disk content is "the original" (that assumption
*is* the original false-green, just moved one step earlier: it would
canonize a mutant forever, the very first time `apply` runs against a
container that already has it). A backfilled hash only proves today's file
matches **itself**, never that it matches what was actually applied in the
past.

`up` is the only baseline where "hash recorded" and "verified correct" are
the same thing.

### 1. Mutate the migration, then apply it with `--force`

```
./scripts/pgtap-local.sh apply --force <version>
```

Never a hand-rolled `docker exec -i <c> psql -f /path/...` — see "Why this
exists" above. `apply --force` fails loudly up front if the version doesn't
resolve to a real file in the container, instead of silently doing nothing.

### 2. Capture the live object's state — before AND after

A "confirm it changed" step with nothing captured beforehand to compare
against isn't a check. Capture the pre-mutation value first (ideally right
after `up`, before mutating anything), then compare post-mutation:

| Object kind | Query |
|---|---|
| function | `select md5(prosrc) from pg_proc where proname = '...'` |
| CHECK constraint | `select pg_get_constraintdef(oid) from pg_constraint where conname = '...'` |
| index | `select pg_get_indexdef(oid) from pg_index where indexrelid = '...'::regclass` |
| RLS policy | `select qual, with_check from pg_policies where policyname = '...'` |
| trigger | `select pg_get_triggerdef(oid) from pg_trigger where tgname = '...'` |

Run any of these through:

```
./scripts/pgtap-local.sh psql -tAc "<query>"
```

### 3. Only then trust `run`'s red/green

Never the `apply` command's exit code alone — though as of this fix, `apply`
is at least honest about it: it exits non-zero when `failed=N` or
`changed=N` is nonzero, and surfaces (without failing the run) two more
signals worth reading before trusting a result:

- `unverified=N` — N migrations had no recorded hash and got backfilled this
  run; their match against "what was actually applied" was never verified.
- `orphaned=N` — the ledger has N versions with no matching file in
  `/supabase/migrations` anymore (renamed or deleted migrations). The ledger
  still asserts those were applied; nothing here re-verifies that.
