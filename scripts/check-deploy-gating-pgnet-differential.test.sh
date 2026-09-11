#!/usr/bin/env bash
#
# check-deploy-gating-pgnet-differential.test.sh (spec-92 fase 1b / spec-93,
# review rounds 2026-09-10, B2/B3/G1/G2 + items 1/4)
# check-deploy-gating-pgnet.mjs only checks that the LITERAL TEXT of a
# detection pattern appears somewhere in the "Filter paths" step's run: — it
# cannot tell whether that text is WIRED to the right variable, has the
# right polarity, or survives a large diff without SIGPIPE. Same root cause
# and same fix as check-deploy-gating-quarantine-differential.test.sh
# (round 7), but stronger: that harness runs a SYNTHETIC candidate and never
# reads deploy.yml; this one extracts the REAL "Filter paths" run: text from
# the REAL deploy.yml and runs THAT under real bash, with git/gh stubbed,
# asserting on the GITHUB_OUTPUT it actually produces.
#
# This is also what catches B2 (SIGPIPE under pipefail on a large diff): a
# harness built only from small synthetic diffs would never hit the ~64 KB
# pipe-buffer threshold. Several cases below are 200 KB with the signal on
# the FIRST line — the shape `git diff` produces once paths sort a pending
# migration early.
#
# Run: bash scripts/check-deploy-gating-pgnet-differential.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORKFLOW="${1:-$HERE/../.github/workflows/deploy.yml}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

# ── Extract the REAL "Filter paths" run: text from the REAL deploy.yml ──────
# Written under $HERE (scripts/), not $TMP — node's ESM resolution needs to
# find js-yaml via the repo's own node_modules; a scratch dir outside the
# repo tree cannot see it. PID-suffixed and gitignored (see .gitignore): a
# fixed name left two problems — an interrupted run leaves an untracked
# .mjs behind, and two parallel runs on the same checkout (e.g. two
# worktrees sharing this path, or a killed run's trap racing a fresh one)
# would delete each other's extractor file mid-read.
EXTRACTOR="$HERE/.check-deploy-gating-pgnet-differential-extract.$$.mjs"
trap 'rm -rf "$TMP" "$EXTRACTOR"' EXIT
cat > "$EXTRACTOR" << 'EOF'
import { load } from 'js-yaml';
import fs from 'node:fs';
const doc = load(fs.readFileSync(process.argv[2], 'utf8'));
const steps = (doc.jobs && doc.jobs.changes && doc.jobs.changes.steps) || [];
const step = steps.find((s) => s.name === 'Filter paths');
if (!step) { process.stderr.write('no "Filter paths" step found\n'); process.exit(2); }
process.stdout.write(String(step.run));
EOF

RAW_RUN="$(node "$EXTRACTOR" "$WORKFLOW" 2>"$TMP/extract.err")"
if [ -z "$RAW_RUN" ]; then
  echo "FATAL: could not extract the Filter paths step from $WORKFLOW"
  cat "$TMP/extract.err" 2>/dev/null
  exit 2
fi

# GitHub Actions resolves ${{ github.repository }} SERVER-SIDE before bash
# ever sees the script. Real bash run directly does not do that
# substitution, so it must be done here — same convention other fixtures in
# this family use ("repos/x/y/commits/main").
RUN_TEXT="${RAW_RUN//\$\{\{ github.repository \}\}/x/y}"

# ── git/gh stubs ─────────────────────────────────────────────────────────
# Calls made, in order: (1) rev-parse → BASE; (2) diff --name-only BASE..DEPLOY
# → CHANGED; (3) gh api runs?status=success → LAST_SUCCESS_SHA; (4) cat-file
# -e; (5) merge-base --is-ancestor; (6) diff --name-only RANGE_BASE..DEPLOY →
# CUM_CHANGED; (7) diff RANGE_BASE..DEPLOY -- migrations/ → MIGRATIONS_DIFF.
# Range always resolves (RANGE_OK=true) unless STUB_RANGE_FAIL=true. (2)/(6)/
# (7) are under the test's control via STUB_CHANGED_FILE/STUB_CUM_CHANGED_FILE/
# STUB_MIGRATIONS_DIFF_FILE — (2) feeds `matches()` (database/frontend/etc.),
# (6) is a path LIST, (7) is migration CONTENT. The SIGPIPE class (B2) was
# found alive on all three, not just (7) — hence three independent stubs.
#
# CI incident (2026-09-10, run 34571709928, PR #793): these were originally
# plain environment VARIABLES, not files. Green on Windows/MSYS (where this
# suite was developed), rc=126 on every 200 KB case on the Linux CI runner
# — not a logic bug. Linux execve() caps each INDIVIDUAL env string at
# MAX_ARG_STRLEN (32 pages = 131072 bytes); 200 KB in one env var blows
# past that → E2BIG → bash reports 126. MSYS doesn't enforce the same cap.
# Fixed by passing large values through FILES: the env var holds a short
# PATH, the stub `cat`s it — no size limit to re-approach later. (Shrinking
# the filler under 131072 bytes was rejected: ~30 KB from a kernel limit
# nobody keeps in their head, breaking again for no reason visible in the
# diff the next time someone grows it.)
write_stubs() {
  local dir="$1"
  mkdir -p "$dir/bin"
  cat > "$dir/bin/git" << 'GITEOF'
#!/usr/bin/env bash
case "$1" in
  rev-parse) echo "basesha"; exit 0 ;;
  cat-file) exit 0 ;;
  merge-base) exit 0 ;;
  diff)
    shift
    args="$*"
    case "$args" in
      *basesha*) cat "$STUB_CHANGED_FILE" ;;              # (2) CHANGED
      *--name-only*) cat "$STUB_CUM_CHANGED_FILE" ;;       # (6) CUM_CHANGED
      *) cat "$STUB_MIGRATIONS_DIFF_FILE" ;;                # (7) MIGRATIONS_DIFF
    esac
    exit 0
    ;;
  *) exit 0 ;;
esac
GITEOF
  chmod +x "$dir/bin/git"
  # STUB_RANGE_FAIL=true makes gh answer empty, so LAST_SUCCESS_SHA is empty
  # and the script's own range-establishment check fails — exercising the
  # FAIL-CLOSED branch (RANGE_OK stays false, AUTH_HOOK and PG_NET are both
  # forced true before any content is even inspected). Without a case that
  # forces this path, a mutant deleting PG_NET=true from JUST that branch
  # (never touching the content-check branch below it) would never be
  # exercised by this harness at all.
  cat > "$dir/bin/gh" << 'GHEOF'
#!/usr/bin/env bash
if [ "${STUB_RANGE_FAIL:-}" = "true" ]; then
  echo ""
else
  echo "lastsha"
fi
exit 0
GHEOF
  chmod +x "$dir/bin/gh"
}

# Runs the real extracted script under real bash with the stubs on PATH.
# $1 = MIGRATIONS_DIFF content (7), $2 = range_fail (see write_stubs),
# $3 = CUM_CHANGED content (6), $4 = CHANGED content (2, feeds matches()),
# $5 = FORCE_DB ("true"/"false", item 4). Each payload is written to a file
# and the stub is told the PATH, not the content — see write_stubs' comment.
# Returns "rc=<v> pg_net=<v> auth_hook=<v> outfile=<path>" — callers invoke
# this via `x="$(run_filter ...)"` (a subshell), so any field a caller needs
# must ride in the printed summary, not a variable this merely assigns
# (invisible outside the subshell — B1, round 3 review).
run_filter() {
  local migrations_diff="$1" range_fail="${2:-false}" cum_changed="${3:-}" changed="${4:-}" force_db="${5:-false}"
  local dir out_file
  dir="$TMP/run-$RANDOM"
  mkdir -p "$dir"
  write_stubs "$dir"
  printf '%s' "$RUN_TEXT" > "$dir/filter.sh"
  out_file="$dir/github_output"
  : > "$out_file"
  # Payloads go through FILES, not env vars — see write_stubs' comment.
  printf '%s' "$migrations_diff" > "$dir/migrations_diff"
  printf '%s' "$cum_changed" > "$dir/cum_changed"
  printf '%s' "$changed" > "$dir/changed"
  (
    cd "$dir" \
    && PATH="$dir/bin:$PATH" \
       DEPLOY_SHA="deploysha" \
       FORCE_DB="$force_db" \
       GH_TOKEN="dummy" \
       GITHUB_OUTPUT="$out_file" \
       STUB_MIGRATIONS_DIFF_FILE="$dir/migrations_diff" \
       STUB_RANGE_FAIL="$range_fail" \
       STUB_CUM_CHANGED_FILE="$dir/cum_changed" \
       STUB_CHANGED_FILE="$dir/changed" \
       bash --noprofile --norc filter.sh
  ) > "$dir/stdout" 2> "$dir/stderr"
  local rc=$?
  local pg_net auth_hook
  pg_net="$(grep -oE '^pg_net=.*' "$out_file" | tail -1 | cut -d= -f2)"
  auth_hook="$(grep -oE '^auth_hook=.*' "$out_file" | tail -1 | cut -d= -f2)"
  echo "rc=${rc} pg_net=${pg_net} auth_hook=${auth_hook} outfile=${out_file}"
}

assert_pg_net() {
  local name="$1" migrations_diff="$2" expected="$3" range_fail="${4:-false}" cum_changed="${5:-}" changed="${6:-}" force_db="${7:-false}" result actual
  result="$(run_filter "$migrations_diff" "$range_fail" "$cum_changed" "$changed" "$force_db")"
  actual="$(echo "$result" | grep -oE 'pg_net=[a-z]*' | cut -d= -f2)"
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1)); echo "  FAIL $name — expected pg_net=$expected, got: $result"
  fi
}

assert_auth_hook() {
  local name="$1" migrations_diff="$2" expected="$3" range_fail="${4:-false}" cum_changed="${5:-}" changed="${6:-}" force_db="${7:-false}" result actual
  result="$(run_filter "$migrations_diff" "$range_fail" "$cum_changed" "$changed" "$force_db")"
  actual="$(echo "$result" | grep -oE 'auth_hook=[a-z]*' | cut -d= -f2)"
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1)); echo "  FAIL $name — expected auth_hook=$expected, got: $result"
  fi
}

# Generic single-field assertion — fields assert_pg_net/assert_auth_hook
# don't parse (worker, frontend, database, ...). Same args plus $1=field.
# B1 (round 3): keeps run_summary (not /dev/null) so a future expected=""
# FAIL still shows rc= instead of looking like a genuinely empty output.
assert_output_field() {
  local field="$1" name="$2" migrations_diff="$3" expected="$4" range_fail="${5:-false}" cum_changed="${6:-}" changed="${7:-}" force_db="${8:-false}" actual run_summary out_file
  run_summary="$(run_filter "$migrations_diff" "$range_fail" "$cum_changed" "$changed" "$force_db")"
  out_file="$(echo "$run_summary" | grep -oE 'outfile=.*' | cut -d= -f2-)"
  actual="$(grep -oE "^${field}=.*" "$out_file" | tail -1 | cut -d= -f2)"
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1)); echo "  FAIL $name — expected ${field}=$expected, got: ${field}=${actual} (${run_summary})"
  fi
}

echo "check-deploy-gating.sh — pg_net differential harness (real bash, real deploy.yml)"

assert_pg_net "clean migration diff -> pg_net=false" \
  "+ create table foo (id uuid primary key);" \
  "false"

assert_pg_net "net.http_post at the end of a small diff -> pg_net=true" \
  "+ create or replace function f() returns void as \$\$ begin perform net.http_post('http://x'); end; \$\$ language plpgsql;" \
  "true"

# ── B2: SIGPIPE regression, reproduced structurally — 200 KB of filler
# AFTER the match on line one (real newline, matching a real diff's line
# structure). Before the herestring fix this reported pg_net=false.
build_big_diff() {
  local marker="$1" filler
  filler="$(node -e "process.stdout.write('x'.repeat(200000))")"
  printf '%s\n%s' "$marker" "$filler"
}
BIG_DIFF="$(build_big_diff '+ perform net.http_post('"'"'http://x'"'"');')"
assert_pg_net "200 KB diff with the signal on line ONE still -> pg_net=true (B2)" \
  "$BIG_DIFF" "true"

BIG_AUTH_DIFF="$(build_big_diff '+ grant supabase_auth_admin to postgres; -- custom_access_token_hook')"
assert_auth_hook "200 KB diff with the auth-hook signal on line ONE still -> auth_hook=true (same B2 class, base branch line)" \
  "$BIG_AUTH_DIFF" "true"

# ── B2 round 2: same SIGPIPE class, on CUM_CHANGED — a PATH LIST. ~1,100
# changed paths (~60 bytes each) cross the 64 KB pipe buffer, and this repo
# has a documented 1,599-file incident; CUM_CHANGED is the CUMULATIVE range.
BIG_CUM_CHANGED="$(build_big_diff 'infra/supabase-qa/custom_access_token_hook.sql')"
assert_auth_hook "200 KB CUM_CHANGED (path list) with the signal on line ONE still -> auth_hook=true (B2, CUM_CHANGED)" \
  "+ create table foo (id uuid primary key);" "true" "false" "$BIG_CUM_CHANGED"

# ── item 1: the THIRD instance of the same SIGPIPE class — `matches()`, fed
# by CHANGED (2), behind database/edge_functions/worker/agents/solver/
# frontend. Worse than pg_net/auth_hook failing false: it decides WHAT
# DEPLOYS, not whether to pause. `worker` (not `frontend`, M1 round-2
# correction — deploy-vercel is gated only on approve-production + changes
# succeeding, not outputs.frontend at deploy.yml:471-480; frontend=false
# there just means QA silently skips rebuilding, a different bug).
# `worker=false` DOES skip deploy-worker directly (deploy.yml:505-514) —
# green run, nothing shipped to the VPS.
BIG_CHANGED="$(build_big_diff 'apps/worker/src/index.ts')"
assert_output_field worker \
  "200 KB CHANGED with an apps/worker/ path on line ONE still -> worker=true (item 1, matches())" \
  "+ create table foo (id uuid primary key);" "true" "false" "" "$BIG_CHANGED" "false"

# ── item 4: force_db must also force auth_hook/pg_net — RANGE_BASE trusts
# "a successful run at sha X ⇒ production has every migration up to X",
# and force_db exists BECAUSE that broke once (2026-08-23, 13 migrations at
# once). Clean content everywhere else, but FORCE_DB=true — both true.
assert_output_field pg_net \
  "FORCE_DB=true forces pg_net=true even with clean content (item 4)" \
  "+ create table foo (id uuid primary key);" "true" "false" "" "" "true"
assert_output_field auth_hook \
  "FORCE_DB=true forces auth_hook=true even with clean content (item 4)" \
  "+ create table foo (id uuid primary key);" "true" "false" "" "" "true"

# ── G1: signal width — case, call forms, schema mentions ────────────────────
assert_pg_net "NET.HTTP_POST uppercase -> pg_net=true (case-insensitive)" \
  "+ perform NET.HTTP_POST('http://x');" "true"

assert_pg_net "net.http_delete -> pg_net=true (real pg_net 0.7+ function)" \
  "+ perform net.http_delete(1);" "true"

assert_pg_net "schema-qualified extensions.net.http_post -> pg_net=true" \
  "+ perform extensions.net.http_post('http://x');" "true"

assert_pg_net "whitespace around the dot (legal SQL) -> pg_net=true" \
  "+ perform net . http_post('http://x');" "true"

assert_pg_net "bare pg_net mention (install/grant, not a call) -> pg_net=true" \
  "+ create extension if not exists pg_net;" "true"

assert_pg_net "SCHEMA net mention -> pg_net=true" \
  "+ grant usage on schema net to postgres;" "true"

assert_pg_net "unrelated content -> pg_net=false" \
  "+ create index concurrently on orders (operator_id);" "false"

# ── fail-closed: PG_NET=true with NO content, NO diff at all — a mutant
# deleting PG_NET=true from only this branch (content-check branch intact)
# is invisible to every case above, which all resolve the range.
assert_pg_net "range cannot be established -> pg_net=true (fail-closed), even with clean content" \
  "+ create table foo (id uuid primary key);" "true" "true"
assert_auth_hook "range cannot be established -> auth_hook=true (fail-closed), same branch" \
  "+ create table foo (id uuid primary key);" "true" "true"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
