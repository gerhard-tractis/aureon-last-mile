#!/usr/bin/env bash
#
# Tests for compose_changed_services()/recreate_qa_service() in deploy-qa.sh
# (spec-93 fase 3).
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
# would recreate every service on every unrelated edit — and
# recreate_qa_service() applies the same `up -d --no-deps` fix generically.
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

check_contains() {
  if grep -q -- "$3" <<< "$2"; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1 — expected to find '$3' in:"
    printf '%s\n' "$2" | sed 's/^/         /'
  fi
}

# ── Fixture compose file — a minimal but structurally real stand-in with the
#    same "  <service>:" top-level shape as the real one. Line numbers below
#    are deliberately hand-verified against THIS fixture, not the real file.
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

extract() { sed -n "/^$1() {/,/^}/p" "$HERE/deploy-qa.sh"; }
{
  echo "QA_CHECKOUT_DIR=\"$FAKE_QA\""
  echo "QA_ENV_FILE=\"$QA_ENV_FILE\""
  extract log
  extract err
  extract compose_changed_services
  extract recreate_qa_service
} > "$STUB_DIR/fns.sh"
# shellcheck disable=SC1091
. "$STUB_DIR/fns.sh"

echo "compose_changed_services()"

# ── Only kong's block changed (line 6 of the fixture: FOO: bar under kong,
#    which spans lines 5-10) ─────────────────────────────────────────────
FAKE_DIFF='@@ -6 +6 @@
-      FOO: bar
+      FOO: baz'
result="$(compose_changed_services aaaa bbbb)"
check "attributes a changed line to the service whose block contains it" \
  "kong" "$result"

# ── Two services touched in one diff — sorted, deduped. Line 6 is kong's
#    (block 5-11), line 28 is storage's (block 27-31) in the fixture above ─
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
#    enclosing block, not silently dropped. Line 13 is inside auth's block
#    (12-16) in the fixture above ───────────────────────────────────────────
FAKE_DIFF='@@ -14,1 +13,0 @@
-      REMOVED: true'
result="$(compose_changed_services aaaa bbbb)"
check "a deletion-only hunk still attributes to its block" \
  "auth" "$result"

# ── No usable baseline (matches widen_changed_flags' own unknown-baseline
#    reasoning): a fresh/force-reset checkout has no diff to take — returning
#    nothing here is correct because setup-qa.sh's initial `up -d` already
#    created every container fresh; there is no drift to catch yet ─────────
FAKE_DIFF=''
result="$(compose_changed_services '' bbbb)"
check "an absent previous sha reports nothing" "" "$result"

result="$(compose_changed_services badsha bbbb)"
check "a previous sha the checkout doesn't have reports nothing" "" "$result"

# ── prev == target: nothing to diff ─────────────────────────────────────────
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
echo "main() wiring"

# Scoped to main()'s own body (awk range), not a substring grep over the
# whole file — compose_changed_services()'s own function signature also
# contains the string "compose_changed_services", which would make a
# whole-file grep pass even if main() never actually called it.
main_body="$(awk '/^main\(\) \{/,/^\}/' "$HERE/deploy-qa.sh")"
check_contains "main() calls compose_changed_services" \
  "$main_body" 'compose_changed_services'
check_contains "main() calls recreate_qa_service on whatever it returns" \
  "$main_body" 'recreate_qa_service'
# `db` must never be auto-recreated by this generic path — see the comment
# on RECREATABLE_QA_SERVICES for why (stateful, and restart_auth() already
# documents the depends_on hazard of recreating it as a side effect).
check "the recreatable set excludes db" \
  "" "$(grep -oE 'RECREATABLE_QA_SERVICES="[^"]*"' "$HERE/deploy-qa.sh" | grep -o '\bdb\b')"

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
