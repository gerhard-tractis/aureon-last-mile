#!/usr/bin/env bash
#
# Tests for check-phase-overlap.sh (spec-89 fase 1) — end to end against a
# real temp git repo (branches, commits, git show/git diff), not a fixture
# that fabricates a report shape. See check-migration-safety-basediff.test.sh
# for the same pattern in this repo.
#
# Run: bash scripts/check-phase-overlap.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/check-phase-overlap.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

assert_exit() {
  local expected="$1" name="$2"; shift 2
  local actual
  "$@" >"$TMP/out.$$" 2>&1
  actual=$?
  if [ "$actual" -eq "$expected" ]; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1))
    echo "  FAIL $name — expected exit $expected, got $actual"
    sed 's/^/       /' "$TMP/out.$$"
  fi
  rm -f "$TMP/out.$$"
}

assert_contains() {
  local needle="$1" name="$2"; shift 2
  local output
  output=$("$@" 2>&1 || true)
  if printf '%s' "$output" | grep -qF "$needle"; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1))
    echo "  FAIL $name — output did not contain: $needle"
    printf '%s\n' "$output" | sed 's/^/       /'
  fi
}

echo "check-phase-overlap.sh"

REPO="$TMP/repo"
mkdir -p "$REPO/apps/frontend/src/hooks" "$REPO/apps/frontend/src/lib/offline" \
         "$REPO/apps/frontend/src/components/pickup" "$REPO/apps/frontend/src/app/app/pickup/route/active" \
         "$REPO/packages/database/supabase/migrations" "$REPO/docs/specs"
(
  cd "$REPO"
  git init -q
  git config user.email test@example.com
  git config user.name test

  cat > apps/frontend/src/lib/offline/queue.ts <<'TS'
import { db } from './db';
export function enqueue() {}
TS
  cat > apps/frontend/src/lib/offline/db.ts <<'TS'
import { deepest } from './deepest';
export const db = {};
TS
  cat > apps/frontend/src/lib/offline/deepest.ts <<'TS'
export const deepest = true;
TS
  cat > apps/frontend/src/hooks/useOfflineQueue.ts <<'TS'
import { enqueue } from '@/lib/offline/queue';
TS
  cat > apps/frontend/src/components/pickup/DigitalizeManifestTrigger.tsx <<'TSX'
export function DigitalizeManifestTrigger() { return null; }
TSX
  cat > apps/frontend/src/app/app/pickup/route/active/page.tsx <<'TSX'
import { DigitalizeManifestTrigger } from '@/components/pickup/DigitalizeManifestTrigger';
TSX
  cat > packages/database/supabase/migrations/0001_x.sql <<'SQL'
select 1;
SQL

  cat > docs/specs/spec-81-x.md <<'MD'
### Fase 2 — Drenado `[pending]`

**Archivos:** `apps/frontend/src/hooks/useOfflineQueue.ts`, `+ test`
MD

  cat > docs/specs/spec-82-x.md <<'MD'
### Fase 1 — Diff visual `[pending]`

**Archivos:** `app/app/pickup/route/active/page.tsx`, `components/pickup/DigitalizeManifestTrigger.tsx`
MD

  cat > docs/specs/spec-88-x.md <<'MD'
### Fase 2 — assert_operator_access `[pending]`

**Archivos:** `packages/database/supabase/migrations/0001_x.sql`
MD

  cat > docs/specs/spec-90-x.md <<'MD'
### Fase 1 — cambia el contrato de la cola `[pending]`

**Archivos:** `apps/frontend/src/lib/offline/queue.ts`
MD

  cat > docs/specs/spec-91-x.md <<'MD'
### Fase 1 — toca el leaf más profundo `[pending]`

**Archivos:** `apps/frontend/src/lib/offline/deepest.ts`
MD

  git add -A
  git commit -q -m base
  echo "$(git symbolic-ref --short HEAD)" > "$TMP/base_ref"

  git checkout -qb feat/spec-81-fase-2
  git checkout -q "$(cat "$TMP/base_ref")"
  git checkout -qb feat/spec-82-fase-1
  git checkout -q "$(cat "$TMP/base_ref")"
  git checkout -qb feat/spec-88-fase-2
  git checkout -q "$(cat "$TMP/base_ref")"
  git checkout -qb feat/spec-91-fase-1
  echo "export const deepest = 'changed';" > apps/frontend/src/lib/offline/deepest.ts
  git add -A
  git commit -q -m "spec-91 fase-1: touches the deepest leaf"
  git checkout -q "$(cat "$TMP/base_ref")"
)

BASE_REF="$(cat "$TMP/base_ref")"

# ── Baseline: two disjoint targets, no overlap of any kind ─────────────────
# spec-82 fase-1 writes page.tsx which imports DigitalizeManifestTrigger.tsx —
# not what spec-81 touches — so this pair is clean.
assert_exit 0 "spec-81 fase-2 + spec-82 fase-1: disjoint, clean (exit 0)" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2" \
  "docs/specs/spec-82-x.md#Fase 1@feat/spec-82-fase-1"

# ── A hard conflict: two targets that BOTH write useOfflineQueue.ts ─────────
(
  cd "$REPO"
  git checkout -qb feat/other-fase-touches-queue "$BASE_REF"
  cat > apps/frontend/src/hooks/useOfflineQueue.ts <<'TS'
import { enqueue } from '@/lib/offline/queue';
// a second phase editing the same file
TS
  git add -A
  git commit -q -m "second phase also edits the queue hook"
  git checkout -q "$BASE_REF"
)

assert_exit 1 "same file written by two branches: hard conflict (exit 1)" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2" \
  "docs/specs/spec-81-x.md#Fase 2@feat/other-fase-touches-queue"

assert_contains "apps/frontend/src/hooks/useOfflineQueue.ts" "hard conflict names the shared file" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2" \
  "docs/specs/spec-81-x.md#Fase 2@feat/other-fase-touches-queue"

# ── The acceptance case from the spec: three Recogida targets overlap ──────
# through the shared queue infra (spec-81 declares useOfflineQueue.ts, which
# imports queue.ts one hop; spec-82 doesn't reach it in this fixture, so the
# pair below stays clean), and the SQL target is disjoint from both.
assert_exit 0 "spec-81 fase-2 + spec-82 fase-1 + spec-88 fase-2: no HARD conflict" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2" \
  "docs/specs/spec-82-x.md#Fase 1@feat/spec-82-fase-1" \
  "docs/specs/spec-88-x.md#Fase 2@feat/spec-88-fase-2"

assert_contains "spec-88-x.md#Fase 2" "SQL target is reported disjoint, not silently dropped" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2" \
  "docs/specs/spec-88-x.md#Fase 2@feat/spec-88-fase-2"

# ── Soft coupling: spec-90 WRITES queue.ts; spec-81 only IMPORTS it (one hop,
# via useOfflineQueue.ts) but never writes it itself. Must not block.
(
  cd "$REPO"
  git checkout -qb feat/spec-90-fase-1 "$BASE_REF"
  echo "export function enqueue() { /* contract change */ }" > apps/frontend/src/lib/offline/queue.ts
  git add -A
  git commit -q -m "changes queue.ts contract"
  git checkout -q "$BASE_REF"
)
assert_exit 0 "soft coupling (spec-90 writes queue.ts, spec-81 only imports it) does not block" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2" \
  "docs/specs/spec-90-x.md#Fase 1@feat/spec-90-fase-1"

assert_contains "ACOPLAMIENTO BLANDO" "soft coupling is reported (not silent)" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2" \
  "docs/specs/spec-90-x.md#Fase 1@feat/spec-90-fase-1"

assert_contains "apps/frontend/src/lib/offline/queue.ts" "soft coupling names the shared, transitively-reached file" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2" \
  "docs/specs/spec-90-x.md#Fase 1@feat/spec-90-fase-1"

# ── Medium 6 (review round 1): the CLI's own DEFAULT --max-depth (2, applied
# when the flag is omitted) needs an end-to-end test, not just the unit test
# on buildClosure's parameter default. Chain: useOfflineQueue.ts (seed, depth
# 0) -> queue.ts (1) -> db.ts (2) -> deepest.ts (3, excluded by DEFAULT).
assert_exit 0 "DEFAULT depth (flag omitted): the 3rd-hop leaf stays unreached — no coupling" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2" \
  "docs/specs/spec-91-x.md#Fase 1@feat/spec-91-fase-1"

assert_contains "ACOPLAMIENTO BLANDO: ninguno" "DEFAULT depth: verdict is clean, not just exit 0" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2" \
  "docs/specs/spec-91-x.md#Fase 1@feat/spec-91-fase-1"

assert_contains "apps/frontend/src/lib/offline/deepest.ts" "--max-depth 3 DOES reach the same 3rd-hop leaf (proves it's the cap, not a broken chain)" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" --max-depth 3 \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2" \
  "docs/specs/spec-91-x.md#Fase 1@feat/spec-91-fase-1"

# ── Usage error: fewer than two targets ─────────────────────────────────────
assert_exit 2 "fewer than two targets is a usage error" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2"

# ── Blocker 3 (review round 1): an empty write set — no **Archivos:**
# declared AND no branch (or a branch with zero commits) — must refuse to
# judge, loudly, not report "disjoint". Verified against real specs/branches:
# spec-80 fase 1b has no **Archivos:** and was given with no branch; the
# guard silently said "despachable en paralelo" while the real branches
# collided on two files. Silence there is a false "safe to dispatch".
cat > "$REPO/docs/specs/spec-92-sin-archivos.md" <<'MD'
### Fase 1 — sin declarar todavía `[pending]`

Prosa nada más — nadie escribió **Archivos:** para esta fase.
MD
(cd "$REPO" && git add -A && git commit -q -m "add spec-92 with an undeclared phase")

assert_exit 3 "empty write set (no Archivos, no branch): refuses to judge (exit 3, not 0)" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2" \
  "docs/specs/spec-92-sin-archivos.md#Fase 1"

assert_contains "no puedo juzgar" "empty write set: message says it explicitly, not just an exit code" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2" \
  "docs/specs/spec-92-sin-archivos.md#Fase 1"

assert_contains "spec-92-sin-archivos.md#Fase 1" "empty write set: message names WHICH target is unjudgeable" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2" \
  "docs/specs/spec-92-sin-archivos.md#Fase 1"

# A target with NO **Archivos:** but a branch that DOES have real commits is
# still judgeable — the real diff is a legitimate write set on its own
# (spec-88 fase 2 in the real acceptance run: undeclared, but its branch has
# 4 real files). Must NOT be refused.
(
  cd "$REPO"
  git checkout -qb feat/spec-92-fase-1 "$BASE_REF"
  echo "select 2;" > packages/database/supabase/migrations/0002_y.sql
  git add -A
  git commit -q -m "spec-92 fase-1: undeclared in the spec, but this branch has a real diff"
  git checkout -q "$BASE_REF"
)
assert_exit 0 "undeclared Archivos but a real branch diff IS judgeable (not refused)" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2" \
  "docs/specs/spec-92-sin-archivos.md#Fase 1@feat/spec-92-fase-1"

# ── Regression (found running against the real repo, not a fixture): a
# resolveSpecifier candidate with no extension can match a REAL DIRECTORY on
# disk when it isn't in either ref's git tree (`readWorkingTree` fallback).
# `existsSync` is true for directories too, and `readFileSync` on one throws
# EISDIR — crashing the whole run instead of correctly treating it as "not a
# file, try the next candidate". apps/frontend/src/lib/offline/ is exactly
# such a directory here.
mkdir -p "$REPO/apps/frontend/src/lib/offline/decoy-dir"
cat > "$REPO/apps/frontend/src/lib/offline/decoy-dir/leaf.ts" <<'TS'
export const leaf = true;
TS
cat > "$REPO/docs/specs/spec-93-x.md" <<'MD'
### Fase 1 — importa un directorio sin index `[pending]`

**Archivos:** `apps/frontend/src/lib/offline/imports-a-bare-dir.ts`
MD
cat > "$REPO/apps/frontend/src/lib/offline/imports-a-bare-dir.ts" <<'TS'
import { leaf } from './decoy-dir';
TS
(cd "$REPO" && git add -A && git commit -q -m "spec-93: a specifier resolving to a real directory with no index")

assert_exit 0 "a specifier resolving to a real (uncommitted) directory does not crash (EISDIR regression)" \
  bash "$SCRIPT" --base "$BASE_REF" --repo "$REPO" \
  "docs/specs/spec-93-x.md#Fase 1" \
  "docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
