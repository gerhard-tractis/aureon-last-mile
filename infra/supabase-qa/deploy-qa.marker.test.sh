#!/usr/bin/env bash
#
# Tests for record_deploy_marker() in deploy-qa.sh.
#
# The incident these pin (2026-09-09, runs 34397163949 → 34422244965 — five
# consecutive Deploy Production failures, and since spec-57 made a green QA
# sync production's precondition, five blocked production deploys):
#
#   [00:43:58] sql tests (advisory): pass=71 fail=0 skip=15
#   ##[error]deploy-qa.sh failed at line 747 (exit 1):
#            printf '%s' "${QA_SYNCED_SHA:-${DEPLOY_SHA}}" > "$QA_STATE_FILE"
#   ##[error]QA is NOT in sync with main.
#
# Every real step passed — migrations, seed, users, restarts, post_checks —
# and the run died on its very last statement, writing the state marker.
#
# Cause, measured on the VPS: /home/aureon/.qa-last-deployed-sha was
# `root:root 0644` inside a directory owned by `aureon`, seeded by hand over
# SSH during spec-88 fase 3's catch-up. The GitHub runner executes as
# `aureon` (`Runner.Listener run --startuptype service`, user aureon), so
# `> "$QA_STATE_FILE"` got EACCES on open, and `set -Eeuo pipefail` turned
# that into an aborted deploy. Same class as #718's edge-functions dir: a
# file of the wrong uid, created by hand, breaking the script hours later.
#
# The property being fixed is not "the marker must be writable" — a host can
# always be broken by hand again. It is that the marker is an OPTIMISATION of
# the next run's changed-file diff, not a correctness guarantee. Failing to
# save it must warn loudly and let a deploy that otherwise fully succeeded
# report success. Losing it only widens the next run's diff (see
# read_qa_prev_sha's fallback and widen_changed_flags), which rebuilds more
# than strictly needed — it can never make QA wrong.
#
# Run: bash infra/supabase-qa/deploy-qa.marker.test.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'chmod -R u+rwX "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT

pass=0
fail=0

check_eq() { # $1 name, $2 expected, $3 actual
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1 — expected '$2', got '$3'"
  fi
}

check_contains() { # $1 name, $2 needle, $3 haystack
  case "$3" in
    *"$2"*) pass=$((pass + 1)); echo "  ok   $1" ;;
    *) fail=$((fail + 1)); echo "  FAIL $1 — expected output containing '$2', got: $3" ;;
  esac
}

# Only the functions under test, so sourcing cannot run the script's main().
extract() { sed -n "/^$1() {/,/^}/p" "$HERE/deploy-qa.sh"; }
{
  extract log
  extract err
  extract record_deploy_marker
} > "$TMP/fns.sh"
# shellcheck disable=SC1091
. "$TMP/fns.sh"

# The real script runs under `set -Eeuo pipefail`. Reproduce it here, or a
# non-zero status inside record_deploy_marker() would be silently tolerated
# by the test and the regression would not be visible.
set -eE
trap 'echo "  FAIL an ERR trap fired inside record_deploy_marker — it must never abort the deploy"; exit 1' ERR

SHA_A=1111111111111111111111111111111111111111
SHA_B=2222222222222222222222222222222222222222

echo "record_deploy_marker()"

# ── The happy path still records the marker ─────────────────────────────────
# Whatever the failure handling, the optimisation must actually work when the
# host is healthy: the next run's baseline comes from this file.
QA_STATE_FILE="$TMP/ok/marker"
mkdir -p "$TMP/ok"
QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_B" record_deploy_marker >/dev/null 2>&1
check_eq "writes the synced sha when the file is writable" "$SHA_A" "$(cat "$TMP/ok/marker")"

# ── DEPLOY_SHA is the fallback when the sync sha is unset ───────────────────
QA_STATE_FILE="$TMP/ok/marker2"
QA_SYNCED_SHA="" DEPLOY_SHA="$SHA_B" record_deploy_marker >/dev/null 2>&1
check_eq "falls back to DEPLOY_SHA when QA_SYNCED_SHA is empty" "$SHA_B" "$(cat "$TMP/ok/marker2")"

# ── No trailing newline: read_qa_prev_sha() cats this straight into a diff ──
QA_STATE_FILE="$TMP/ok/marker3"
QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_B" record_deploy_marker >/dev/null 2>&1
check_eq "writes the bare sha with no trailing newline" "40" "$(wc -c < "$TMP/ok/marker3" | tr -d ' ')"

# ── Does this filesystem actually enforce permissions? ──────────────────────
# Two independent questions, and Git Bash on Windows answers them differently:
# it maps chmod on a FILE to the readonly attribute (enforced) but ignores
# chmod on a DIRECTORY (not enforced). root bypasses both. Probing each
# separately keeps the suite meaningful on the Linux CI runner and honest
# everywhere else — a case that cannot bite must be skipped, not asserted.
mkdir -p "$TMP/probe/dir"
printf x > "$TMP/probe/f"
chmod 444 "$TMP/probe/f" 2>/dev/null || true
chmod 555 "$TMP/probe/dir" 2>/dev/null || true
PERMS_FILE=0; PERMS_DIR=0
if [ "$(id -u)" != "0" ]; then
  (printf y > "$TMP/probe/f") 2>/dev/null || PERMS_FILE=1
  (printf y > "$TMP/probe/dir/f") 2>/dev/null || PERMS_DIR=1
fi
chmod 755 "$TMP/probe/dir" 2>/dev/null || true

# ── The incident itself: a marker owned by root, in a dir we own ────────────
# The exact VPS shape — root:root 0644 marker inside aureon's own home. The
# old inline `printf > "$QA_STATE_FILE"` opened the FILE for writing and got
# EACCES. Writing a temp file and renaming needs write permission on the
# DIRECTORY only, so this case now self-heals: the marker is replaced, ends up
# owned by the runner, and the deploy is untouched. Simulated with a read-only
# file rather than a foreign uid, which a test cannot create without root; the
# syscall that used to fail is the same one.
if [ "$PERMS_FILE" != "1" ]; then
  echo "  skip read-only-marker case — chmod on files is not enforced here (Git Bash, or root)"
else
  mkdir -p "$TMP/ro"
  printf '%s' "$SHA_B" > "$TMP/ro/marker"
  chmod 444 "$TMP/ro/marker"
  QA_STATE_FILE="$TMP/ro/marker"
  rc=0
  out="$(QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_A" record_deploy_marker 2>&1)" || rc=$?
  check_eq "returns 0 when the marker file itself is not writable (the five-run outage)" "0" "$rc"
  check_eq "recovers a read-only marker in a writable dir instead of dying on it" \
    "$SHA_A" "$(cat "$TMP/ro/marker")"
  check_eq "leaves no stray temp file after recovering the marker" \
    "marker" "$(ls -A "$TMP/ro" | sort | tr '\n' ' ' | sed 's/ $//')"
fi

# ── Nothing left to try: the directory is unwritable too ────────────────────
# No temp file can be created either, so the marker genuinely cannot be saved.
# This is the path that must warn and carry on: a deploy whose every real step
# passed cannot be reported as a failed sync over a lost note.
if [ "$PERMS_DIR" != "1" ]; then
  echo "  skip unwritable-dir cases — chmod on directories is not enforced here (Git Bash, or root)"
else
  mkdir -p "$TMP/rodir"
  chmod 555 "$TMP/rodir"
  QA_STATE_FILE="$TMP/rodir/marker"
  rc=0
  out="$(QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_A" record_deploy_marker 2>&1)" || rc=$?
  check_eq "returns 0 when the marker cannot be saved at all" "0" "$rc"
  check_contains "says loudly that the marker could not be written" "could not write the deploy marker" "$out"
  check_contains "names the marker path in the warning" "$TMP/rodir/marker" "$out"
  check_contains "states the deploy itself SUCCEEDED, so the log is not read as a failed sync" "SUCCEEDED" "$out"
  check_contains "emits a ::warning:: annotation so it surfaces in the run summary" "::warning::" "$out"
  check_contains "points at file ownership, the cause both times this bit" "owned by the wrong user" "$out"
  check_eq "leaves no stray temp file behind when the write is impossible" "" "$(ls -A "$TMP/rodir")"
fi

# ── The marker path is a directory ─────────────────────────────────────────
# `mv -f file dir` moves the file INSIDE dir and exits 0. Without an explicit
# guard the function would report a recorded deploy having recorded nothing,
# and every later read_qa_prev_sha() would `cat` a directory. Caught only
# because a mutant that dropped the temp+rename still passed the suite.
mkdir -p "$TMP/asdir/marker"
QA_STATE_FILE="$TMP/asdir/marker"
rc=0
out="$(QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_A" record_deploy_marker 2>&1)" || rc=$?
check_eq "returns 0 when the marker path is a directory" "0" "$rc"
check_contains "warns instead of silently moving the temp file into it" \
  "could not write the deploy marker" "$out"
check_eq "does not stash the marker inside that directory" "" "$(ls -A "$TMP/asdir/marker")"
check_eq "leaves no temp file beside the directory" "marker" \
  "$(ls -A "$TMP/asdir" | sort | tr '\n' ' ' | sed 's/ $//')"

# ── The temp file cannot be written ────────────────────────────────────────
# The unwritable-directory case never gets as far as creating a temp file, so
# it cannot prove the cleanup runs — a mutant deleting the `rm -f` survived
# the whole suite. Pre-occupying the temp path with a read-only file makes
# `printf` fail with the temp still present, which is the ENOSPC-shaped path:
# something was left behind and must be swept. `$$` is the shell's pid and is
# stable inside command substitution, so the temp name is predictable here.
if [ "$PERMS_FILE" != "1" ]; then
  echo "  skip temp-cleanup case — chmod on files is not enforced here (Git Bash, or root)"
else
  mkdir -p "$TMP/tmpblock"
  QA_STATE_FILE="$TMP/tmpblock/marker"
  printf 'stale' > "${QA_STATE_FILE}.tmp.$$"
  chmod 444 "${QA_STATE_FILE}.tmp.$$"
  rc=0
  out="$(QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_A" record_deploy_marker 2>&1)" || rc=$?
  check_eq "returns 0 when the temp file cannot be written" "0" "$rc"
  check_contains "warns when the temp file cannot be written" "could not write the deploy marker" "$out"
  check_eq "sweeps the temp file it could not use" "" "$(ls -A "$TMP/tmpblock")"
fi

# ── A failed write must leave nothing half-written ──────────────────────────
# read_qa_prev_sha() cats this file blind. A truncated or partial sha would be
# read as a baseline, and widen_changed_flags() would diff against garbage
# instead of falling back to "rebuild everything". Empty is safe; wrong is not.
QA_STATE_FILE="$TMP/ok/marker4"
QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_B" record_deploy_marker >/dev/null 2>&1
check_eq "leaves no temp files next to a successfully written marker" \
  "marker marker2 marker3 marker4" "$(ls -A "$TMP/ok" | sort | tr '\n' ' ' | sed 's/ $//')"

trap - ERR

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
