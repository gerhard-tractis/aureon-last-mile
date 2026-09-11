#!/usr/bin/env bash
#
# check-deploy-gating-pgnet-differential.test.sh (spec-92 fase 1b / spec-93,
# review round 2026-09-10, B2/B3/G1/G2)
#
# check-deploy-gating-pgnet.mjs only checks that the LITERAL TEXT of the
# detection pattern appears somewhere in the "Filter paths" step's run: — it
# cannot tell whether that text is actually WIRED to set PG_NET=true, has the
# right polarity, or survives a large diff without SIGPIPE. Every one of
# those was a real, surviving mutant against the committed deploy.yml (see
# the review). Same root cause and same fix as
# check-deploy-gating-quarantine-differential.test.sh (round 7): run the
# REAL run: text from the REAL deploy.yml under REAL bash, with git/gh
# stubbed, and assert on the GITHUB_OUTPUT it actually produces — not on
# whether a string appears in the source.
#
# This is also what catches B2 (SIGPIPE under pipefail on a large diff):
# a harness built only from small synthetic diffs would never have hit the
# ~64 KB pipe-buffer threshold that made `printf | grep -q` silently report
# no match. One of the cases below is a 200 KB diff with the signal on the
# FIRST line — the exact shape `git diff` produces once paths sort a pending
# pg_net migration early (paths are migration timestamps).
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
# repo tree cannot see it.
EXTRACTOR="$HERE/.check-deploy-gating-pgnet-differential-extract.mjs"
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
# The script under test makes exactly these calls, in this order:
#   1. git rev-parse "${DEPLOY_SHA}^"                                → BASE
#   2. git diff --name-only "$BASE" "$DEPLOY_SHA"                    → CHANGED
#   3. gh api .../runs?status=success...                             → LAST_SUCCESS_SHA
#   4. git cat-file -e "${LAST_SUCCESS_SHA}^{commit}"                → existence check
#   5. git merge-base --is-ancestor "$LAST_SUCCESS_SHA" "$DEPLOY_SHA"→ ancestry check
#   6. git diff --name-only "$RANGE_BASE" "$DEPLOY_SHA"              → CUM_CHANGED
#   7. git diff "$RANGE_BASE" "$DEPLOY_SHA" -- packages/.../migrations/ → MIGRATIONS_DIFF
# The stub below always resolves the range successfully (RANGE_OK=true,
# RANGE_BASE=lastsha) and answers (2) and (6) with nothing — this harness is
# about the migrations-diff content signal, not the path-based one. (7) is
# the one call whose output is under the test's control, via
# STUB_MIGRATIONS_DIFF.
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
      *basesha*) echo "" ;;                         # (2) CHANGED — irrelevant here
      *--name-only*) echo "" ;;                      # (6) CUM_CHANGED — no path signal
      *) printf '%s' "$STUB_MIGRATIONS_DIFF" ;;       # (7) MIGRATIONS_DIFF
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

# Runs the real extracted script under real bash with the stubs on PATH and
# STUB_MIGRATIONS_DIFF as the (7) response. $2, if "true", forces the
# fail-closed branch (see write_stubs) instead of a resolved range. Returns
# "pg_net=<v> auth_hook=<v>".
run_filter() {
  local migrations_diff="$1" range_fail="${2:-false}" dir out_file
  dir="$TMP/run-$RANDOM"
  mkdir -p "$dir"
  write_stubs "$dir"
  printf '%s' "$RUN_TEXT" > "$dir/filter.sh"
  out_file="$dir/github_output"
  : > "$out_file"
  (
    cd "$dir" \
    && PATH="$dir/bin:$PATH" \
       DEPLOY_SHA="deploysha" \
       FORCE_DB="false" \
       GH_TOKEN="dummy" \
       GITHUB_OUTPUT="$out_file" \
       STUB_MIGRATIONS_DIFF="$migrations_diff" \
       STUB_RANGE_FAIL="$range_fail" \
       bash --noprofile --norc filter.sh
  ) > "$dir/stdout" 2> "$dir/stderr"
  local rc=$?
  local pg_net auth_hook
  pg_net="$(grep -oE '^pg_net=.*' "$out_file" | tail -1 | cut -d= -f2)"
  auth_hook="$(grep -oE '^auth_hook=.*' "$out_file" | tail -1 | cut -d= -f2)"
  echo "rc=${rc} pg_net=${pg_net} auth_hook=${auth_hook}"
}

assert_pg_net() {
  local name="$1" migrations_diff="$2" expected="$3" range_fail="${4:-false}" result actual
  result="$(run_filter "$migrations_diff" "$range_fail")"
  actual="$(echo "$result" | grep -oE 'pg_net=[a-z]*' | cut -d= -f2)"
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1)); echo "  FAIL $name — expected pg_net=$expected, got: $result"
  fi
}

assert_auth_hook() {
  local name="$1" migrations_diff="$2" expected="$3" range_fail="${4:-false}" result actual
  result="$(run_filter "$migrations_diff" "$range_fail")"
  actual="$(echo "$result" | grep -oE 'auth_hook=[a-z]*' | cut -d= -f2)"
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1)); echo "  FAIL $name — expected auth_hook=$expected, got: $result"
  fi
}

echo "check-deploy-gating.sh — pg_net differential harness (real bash, real deploy.yml)"

assert_pg_net "clean migration diff -> pg_net=false" \
  "+ create table foo (id uuid primary key);" \
  "false"

assert_pg_net "net.http_post at the end of a small diff -> pg_net=true" \
  "+ create or replace function f() returns void as \$\$ begin perform net.http_post('http://x'); end; \$\$ language plpgsql;" \
  "true"

# ── B2: the SIGPIPE regression, reproduced structurally ─────────────────────
# 200 KB of filler AFTER the match on line one — the shape a cumulative diff
# takes once a pending pg_net migration's path sorts early. Before the fix
# (printf '%s' "$VAR" | grep -qE ...) this reported pg_net=false under
# pipefail. Build the big payload with a real newline so the match sits on
# its own first line, matching a real diff's line structure.
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

# ── the fail-closed branch: PG_NET=true even with NO content, NO diff at all ─
# When the cumulative range cannot be established, the script must pause
# without ever looking at diff content — a mutant that deletes PG_NET=true
# from ONLY this branch (leaving the content-check branch below it intact)
# is invisible to every case above, which all resolve the range successfully.
assert_pg_net "range cannot be established -> pg_net=true (fail-closed), even with clean content" \
  "+ create table foo (id uuid primary key);" "true" "true"
assert_auth_hook "range cannot be established -> auth_hook=true (fail-closed), same branch" \
  "+ create table foo (id uuid primary key);" "true" "true"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
