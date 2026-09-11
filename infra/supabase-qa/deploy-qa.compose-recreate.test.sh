#!/usr/bin/env bash
#
# Tests for compose_changed_services()/recreate_qa_service()/
# recreate_changed_qa_services() in deploy-qa.sh (spec-93 fase 3).
#
# restart_functions() and restart_auth() each generalize the same lesson —
# `docker compose restart` reuses a container's existing config, only
# `up -d` (recreate) reads the compose file again — but only for the ONE
# service someone happened to hit the trap on. Measured on QA 2026-09-10:
# kong/rest/realtime/storage had not been recreated since 2026-08-11, purely
# because no mechanism existed to recreate them at all — not because
# anything is currently drifted (the only compose edits since then, #710 and
# #497, touched auth/edge and both already have a helper).
#
# compose_changed_services() detects which service BLOCK actually changed
# between QA_PREV_SHA and QA_SYNCED_SHA — not "the file changed", which
# would recreate every service on every unrelated edit — recreate_qa_service()
# applies the same `up -d --no-deps` fix generically, and
# recreate_changed_qa_services() ties the two together through the
# RECREATABLE_QA_SERVICES allow-list — the piece a first review round found
# no test actually exercised behaviourally (B1/B2 below).
#
# Run: bash infra/supabase-qa/deploy-qa.compose-recreate.test.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT

pass=0
fail=0

check() { # $1 name, $2 expected, $3 actual
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1 — expected '$2', got '$3'"
  fi
}

# here-strings, not `printf | grep -q` — under `set -o pipefail` (not set in
# this file, but keeping the same shape as deploy-qa.functions.test.sh's own
# documented reasoning avoids reintroducing that SIGPIPE flake if it ever is).
check_contains() {
  if grep -q -- "$3" <<< "$2"; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1 — expected to find '$3' in:"
    printf '%s\n' "$2" | sed 's/^/         /'
  fi
}

check_not_contains() {
  if grep -q -- "$3" <<< "$2"; then
    fail=$((fail + 1)); echo "  FAIL $1 — did not expect '$3' in:"
    printf '%s\n' "$2" | sed 's/^/         /'
  else
    pass=$((pass + 1)); echo "  ok   $1"
  fi
}

# ── Fixture compose file — a minimal but structurally real stand-in with the
#    same "  <service>:" top-level shape as the real one, PLUS a `db` block
#    (needed for B2: proving the allow-list filter really excludes it, not
#    just that it's absent from a string). Line numbers below are
#    deliberately hand-verified against THIS fixture, not the real file:
#      kong 5-11   auth 12-16   rest 17-21   realtime 22-26
#      storage 27-31   db 32-36
FAKE_QA="$STUB_DIR/qa"
mkdir -p "$FAKE_QA/infra/supabase-qa"
cat > "$FAKE_QA/infra/supabase-qa/docker-compose.yml" <<'YML'
name: supabase-qa

services:

  kong:
    image: kong
    environment:
      FOO: bar
    ports:
      - "8100:8000"

  auth:
    image: auth
    environment:
      FOO: bar

  rest:
    image: rest
    environment:
      FOO: bar

  realtime:
    image: realtime
    environment:
      FOO: bar

  storage:
    image: storage
    environment:
      FOO: bar

  db:
    image: postgres
    environment:
      FOO: bar

volumes:
  db-config:
YML

export QA_CHECKOUT_DIR="$FAKE_QA"
export QA_ENV_FILE="$STUB_DIR/.env.qa"
: > "$QA_ENV_FILE"

# A `git` stub: `rev-parse -q --verify X^{commit}` succeeds unless X is
# literally "badsha"; `diff --unified=0 prev target -- file` prints
# $FAKE_DIFF verbatim (a real unified-diff hunk header + body).
cat > "$STUB_DIR/git" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "-C" ]; then
  shift 2
fi
if [ "$1" = "rev-parse" ]; then
  case "$*" in
    *badsha*) exit 1 ;;
    *) exit 0 ;;
  esac
fi
if [ "$1" = "diff" ]; then
  printf '%s\n' "$FAKE_DIFF"
  exit 0
fi
exit 0
STUB
chmod +x "$STUB_DIR/git"
export PATH="$STUB_DIR:$PATH"

# A `docker` stub logging argv.
cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_LOG"
exit 0
STUB
chmod +x "$STUB_DIR/docker"

export FAKE_DIFF=''

# The real RECREATABLE_QA_SERVICES line, pulled from the source rather than
# duplicated here — a review-round test that hardcodes its own copy of the
# allow-list can't tell a mutated production value from a correct one; only
# the source's own line can.
RECREATABLE_LINE="$(grep '^RECREATABLE_QA_SERVICES=' "$HERE/deploy-qa.sh")"
eval "$RECREATABLE_LINE"

extract() { sed -n "/^$1() {/,/^}/p" "$HERE/deploy-qa.sh"; }
{
  echo "QA_CHECKOUT_DIR=\"$FAKE_QA\""
  echo "QA_ENV_FILE=\"$QA_ENV_FILE\""
  echo "$RECREATABLE_LINE"
  extract log
  extract err
  extract compose_changed_services
  extract recreate_qa_service
  extract recreate_changed_qa_services
} > "$STUB_DIR/fns.sh"
# shellcheck disable=SC1091
. "$STUB_DIR/fns.sh"

echo "compose_changed_services()"

# ── Only kong's block changed (line 6 of the fixture) ───────────────────────
FAKE_DIFF='@@ -6 +6 @@
-      FOO: bar
+      FOO: baz'
result="$(compose_changed_services aaaa bbbb)"
check "attributes a changed line to the service whose block contains it" \
  "kong" "$result"

# ── Two services touched in one diff — sorted, deduped. Line 6 is kong's,
#    line 28 is storage's ───────────────────────────────────────────────────
FAKE_DIFF='@@ -6 +6 @@
-      FOO: bar
+      FOO: baz
@@ -28 +28 @@
-      FOO: bar
+      FOO: baz'
result="$(compose_changed_services aaaa bbbb)"
check "reports every touched service, sorted" \
  "kong
storage" "$result"

# ── A pure-deletion hunk (count 0 on the + side) still attributes to the
#    enclosing block, not silently dropped. Line 13 is inside auth's block ──
FAKE_DIFF='@@ -14,1 +13,0 @@
-      REMOVED: true'
result="$(compose_changed_services aaaa bbbb)"
check "a deletion-only hunk still attributes to its block" \
  "auth" "$result"

# ── B3 (review round) — a hunk whose OLD and NEW line numbers fall in
#    DIFFERENT blocks. Every fixture above used a hunk where the old and new
#    side happen to be the SAME number (`@@ -6 +6 @@`), so reading the wrong
#    group out of the hunk header (`\1`/`\3`, the OLD side, instead of the
#    correct `\2`/`\4`, the NEW side) would still pass every test above. This
#    hunk's old side (13) sits inside auth's block (12-16); its new side (19)
#    sits inside rest's block (17-21) — the file ON DISK, which is what
#    matters, since sync_checkout() has already reset the checkout to the
#    target revision by the time this runs for real. Reading the OLD side
#    reports "auth"; reading the correct NEW side reports "rest" — the exact
#    service this fase exists to start recreating.
FAKE_DIFF='@@ -6 +6 @@
-      FOO: bar
+      FOO: baz
@@ -13,1 +19,1 @@
-      OLD_CONTENT: here
+      FOO: baz'
result="$(compose_changed_services aaaa bbbb)"
check "attributes to the block containing the NEW (target) line, not the OLD one" \
  "kong
rest" "$result"

# ── M1 (review round) — no usable baseline (absent marker, or a sha the
#    checkout no longer has). widen_changed_flags' own doctrine for this
#    exact situation is "rebuild everything; slow is fine, silently stale is
#    not" — the first cut of this function did the opposite (returned
#    nothing), which a degraded-marker run (record_deploy_marker's own
#    documented non-fatal path) could turn into a permanently stale service:
#    once the marker recovers, the commit that changed it can never appear
#    in a future diff again. Recreating the whole allow-list costs one slow
#    run; the alternative risks that permanently. ────────────────────────────
FAKE_DIFF=''
expected_full_set="$(printf '%s\n' $RECREATABLE_QA_SERVICES)"
result="$(compose_changed_services '' bbbb)"
check "an absent previous sha recreates the whole allow-list, not nothing" \
  "$expected_full_set" "$result"

result="$(compose_changed_services badsha bbbb)"
check "a previous sha the checkout doesn't have recreates the whole allow-list too" \
  "$expected_full_set" "$result"

# ── prev == target: nothing to diff ─────────────────────────────────────────
FAKE_DIFF=''
result="$(compose_changed_services aaaa aaaa)"
check "no-ops when prev equals target" "" "$result"

# ── A change outside any service block (e.g. the volumes: footer) maps to
#    no service, not an error ───────────────────────────────────────────────
FAKE_DIFF='@@ -38 +38 @@
-  db-config:
+  db-config2:'
result="$(compose_changed_services aaaa bbbb)"
check "a change outside services: maps to nothing" "" "$result"

echo ""
echo "recreate_qa_service()"

DOCKER_LOG="$STUB_DIR/dockerlog"; export DOCKER_LOG
: > "$DOCKER_LOG"
recreate_qa_service kong >/dev/null 2>&1
invocation="$(cat "$DOCKER_LOG")"
check_contains "recreates rather than restarts (compose changes need a fresh read)" "$invocation" "up -d"
check_contains "targets the given service" "$invocation" "kong"
check_contains "passes the QA env file" "$invocation" "$QA_ENV_FILE"
# Same #721-adjacent reasoning as restart_auth(): every recreatable service
# depends (directly or transitively) on `db`, so a plain `up -d <svc>` would
# also recreate `db` — QA's Postgres, carrying Musan's data — as a side
# effect of an unrelated compose edit.
check_contains "does not also touch db as a side effect" "$invocation" "--no-deps"

echo ""
echo "recreate_changed_qa_services() — B1/B2 (review round)"

# The behavioural test the review round found missing: B1 was "you can
# delete RECREATABLE_QA_SERVICES' whole value down to just kong and the
# suite stays green"; B2 was "the db safety net is asserted by grepping a
# string, not by running the filter". This exercises the REAL filter
# (compose_changed_services -> the `case` in recreate_changed_qa_services)
# against a diff that touches EVERY block in the fixture, including auth and
# db, and checks what actually got recreated on a stubbed docker.
FAKE_DIFF='@@ -6 +6 @@
-      FOO: bar
+      FOO: baz
@@ -14 +14 @@
-      FOO: bar
+      FOO: baz
@@ -19 +19 @@
-      FOO: bar
+      FOO: baz
@@ -24 +24 @@
-      FOO: bar
+      FOO: baz
@@ -29 +29 @@
-      FOO: bar
+      FOO: baz
@@ -34 +34 @@
-      FOO: bar
+      FOO: baz'
DOCKER_LOG="$STUB_DIR/dockerlog_all"; export DOCKER_LOG
: > "$DOCKER_LOG"
recreate_changed_qa_services aaaa bbbb >/dev/null 2>&1
invocation="$(cat "$DOCKER_LOG")"

check_contains "B1 — recreates kong" "$invocation" "up -d --no-deps kong"
check_contains "B1 — recreates rest (never covered before this fase)" "$invocation" "up -d --no-deps rest"
check_contains "B1 — recreates realtime (never covered before this fase)" "$invocation" "up -d --no-deps realtime"
check_contains "B1 — recreates storage (never covered before this fase)" "$invocation" "up -d --no-deps storage"
check_not_contains "B2 — never recreates db, even though its block changed" "$invocation" "no-deps db"
check_not_contains "does not double-recreate auth (already covered by restart_auth)" "$invocation" "no-deps auth"

echo ""
echo "main() wiring"

# Scoped to main()'s own body (awk range), not a substring grep over the
# whole file — recreate_changed_qa_services()'s own function signature also
# contains its name, which would make a whole-file grep pass even if main()
# never actually called it.
main_body="$(awk '/^main\(\) \{/,/^\}/' "$HERE/deploy-qa.sh")"
check_contains "main() calls recreate_changed_qa_services" \
  "$main_body" 'recreate_changed_qa_services'
# `db` must never be auto-recreated by this generic path — see the comment
# on RECREATABLE_QA_SERVICES for why (stateful, and restart_auth() already
# documents the depends_on hazard of recreating it as a side effect). This
# is B2's string-level companion, not a replacement for the behavioural test
# above — both stay, because a passing string check alone is exactly what B2
# found insufficient.
check "the recreatable set excludes db" \
  "" "$(printf '%s\n' "$RECREATABLE_LINE" | grep -o '\bdb\b')"

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
