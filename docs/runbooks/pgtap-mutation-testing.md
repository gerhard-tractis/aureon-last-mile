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
alone does not prove a mutant reached the database. Follow all five steps
below every time — including the last one, restoring the original. Skipping
it leaves the database mutated for every test run afterward.

## The five steps

### 0. Start from `up` — not optional

```
./scripts/pgtap-local.sh up
```

Any **pre-existing** container may hold migrations applied before the
content-hash guard existed, or before you started mutating today. `apply`
marks those rows `unverified` — loudly, and **persistently**: it does not go
quiet after the first backfill. Round 2 of this fix backfilled a plain hash
on first sight, which silently looked like a verified match on the very
next run — reachable in exactly two `apply` invocations, with the mutant
canonized in the ledger forever. A row marked `unverified` now stays noisy
on every run until `up` gives it a real baseline; there is no "resolve it
locally" path, by design. A backfilled hash only ever proves today's file
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

### 3. Trust `run`'s red/green

Never the `apply` command's exit code alone, but `apply`'s exit code is at
least honest now, and it means three different things — do not treat them
as interchangeable:

- **`changed > 0` → exit non-zero.** The SAFE outcome: drift was detected,
  the file on disk did NOT reach the database, and the warning names the
  fix (`apply --force <version>`).
- **`unverified > 0` → exit non-zero.** The DANGEROUS one: nothing here
  could be verified against anything. The only fix is `up` (step 0).
- **`failed > 0` → exit non-zero UNLESS every failure is on the literal
  allowlist** in `pgtap-local-apply-inner.sh` (`KNOWN_BASE_IMAGE_FAILURES`
  — three base-image fidelity gaps, not introduced by any migration, not
  fixable by `apply`). A real new failure is never on that list and always
  fails loud.
- `orphaned=N` (informational, does not fail the run) — the ledger has N
  versions with no matching file in `/supabase/migrations` anymore (renamed
  or deleted migrations). Nothing here re-verifies those.

### 4. Restore the original, then land it for real — do not skip this

Mutation-testing leaves the database MUTATED. Restoring the file on disk is
not enough:

```
git checkout -- path/to/the/migration.sql   # or however you revert it
./scripts/pgtap-local.sh apply --force <version>
```

Skipping the `apply --force` after restoring is the exact bug this step
exists to name: the file goes back to original, but a plain `apply` now
reports `changed` (the *original* content no longer matches the *mutant's*
hash the ledger has recorded) and refuses to touch the database — the
mutant stays live in the database for every test you run after that,
including someone else's, until this step runs. Re-run the step 2 query one
more time afterward to confirm the live object is back to its pre-mutation
value.

## A known, accepted limitation: shared containers and `changed`

`spec52-pg` (the default local-dev container) is shared across every
worktree on a machine. Two branches mutating the SAME migration version at
the same time will make each other's `apply` report `changed` (correctly —
the content genuinely doesn't match what the other branch just put there),
which can look like a ping-pong of hard failures between unrelated
worktrees. The detection itself is correct; the fix is process, not code:
use your own throwaway container for anything beyond routine, non-mutating
`sync && apply && run` (see `.github/workflows/ci.yml` for the pattern), and
never `--force` a version on the shared container unless you're certain
nobody else is touching it.
