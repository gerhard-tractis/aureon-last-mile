#!/usr/bin/env bash
#
# Tests for write_atomic() and record_deploy_marker() in deploy-qa.sh.
#
# The incident these pin (2026-09-09, runs 34397163949 -> 34422244965 — five
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
# `aureon` (`Runner.Listener run --startuptype service`), so
# `> "$QA_STATE_FILE"` got EACCES on open, and `set -Eeuo pipefail` turned
# that into an aborted deploy. Same class as #718's edge-functions dir: a
# file of the wrong uid, created by hand, breaking the script hours later.
#
# Two properties are under test, and the second is the one that is easy to
# get wrong:
#
#   1. A deploy whose every real step passed must not die because a note
#      could not be saved.
#   2. Degrading must go in the SAFE direction. A run that cannot record the
#      marker leaves the next run with NO baseline, which rebuilds every app.
#      The first cut of this fell back to the checkout's HEAD instead, which
#      re-created the exact stale-baseline bug ronda 6 exists to remove — see
#      read_qa_prev_sha()'s comment and deploy-qa.drift.test.sh.
#
# Run: bash infra/supabase-qa/deploy-qa.marker.test.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'chmod -R u+rwX "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT

pass=0
fail=0
skip=0

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

skip_case() { skip=$((skip + 1)); echo "  skip $1"; }

# Only the functions under test, so sourcing cannot run the script's main().
extract() { sed -n "/^$1() {/,/^}/p" "$HERE/deploy-qa.sh"; }
{
  extract log
  extract err
  extract write_atomic
  extract record_deploy_marker
} > "$TMP/fns.sh"
# shellcheck disable=SC1091
. "$TMP/fns.sh"

QA_DEGRADED_MAX=3

# ── Run the function the way main() does, or the net catches nothing ────────
# main() calls `record_deploy_marker` as a bare simple command under
# `set -Eeuo pipefail` with an ERR trap. Bash SUPPRESSES errexit and the ERR
# trap inside a `||` list — so `out="$(record_deploy_marker)" || rc=$?`, the
# obvious way to capture both streams and the status at once, silently
# disarms the very thing under test. Measured: a mutant turning
# `rm -f "$tmp" ... || true` into a bare `rm "$tmp"` — an abort in the real
# script — passed the entire suite when called that way.
#
# So: call it bare, with the streams redirected to files, and read them after.
# If it ever returns non-zero, errexit fires here exactly as it does in
# main(), the ERR trap below reports it, and the suite stops.
set -eE
trap 'echo "  FAIL record_deploy_marker aborted the deploy — it must never do that"; exit 1' ERR

invoke() { # $1 marker path; the sha env vars come from the caller
  QA_STATE_FILE="$1" record_deploy_marker > "$TMP/invoke.out" 2> "$TMP/invoke.err"
  invoke_rc=$?
  invoke_out="$(cat "$TMP/invoke.out" "$TMP/invoke.err")"
  invoke_err="$(cat "$TMP/invoke.err")"
  invoke_stdout="$(cat "$TMP/invoke.out")"
}

SHA_A=1111111111111111111111111111111111111111
SHA_B=2222222222222222222222222222222222222222

QA_DEGRADED_FILE="$TMP/degraded"

echo "record_deploy_marker()"

# ── The happy path still records the marker ─────────────────────────────────
mkdir -p "$TMP/ok"
QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_B" invoke "$TMP/ok/marker"
check_eq "writes the synced sha when the file is writable" "$SHA_A" "$(cat "$TMP/ok/marker")"

QA_SYNCED_SHA="" DEPLOY_SHA="$SHA_B" invoke "$TMP/ok/marker2"
check_eq "falls back to DEPLOY_SHA when QA_SYNCED_SHA is empty" "$SHA_B" "$(cat "$TMP/ok/marker2")"

# No trailing newline: read_qa_prev_sha() cats this straight into a git diff.
QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_B" invoke "$TMP/ok/marker3"
check_eq "writes the bare sha with no trailing newline" "40" "$(wc -c < "$TMP/ok/marker3" | tr -d ' ')"

# ── The write replaces the file, it does not rewrite it in place ────────────
# Atomicity had no assert at all, and a `cp -f && rm -f` mutant survived the
# whole suite. cp truncates and rewrites the SAME inode, so an ENOSPC partway
# leaves a truncated sha — and a truncated sha that is still a unique prefix
# of a real commit RESOLVES, then diffs from the wrong point. rename() swaps
# a fully-written file in, so the inode must change.
inode() { ls -id "$1" 2>/dev/null | awk '{print $1}'; }
printf 'a' > "$TMP/probe_i1"
printf 'b' > "$TMP/probe_i2"
if [ -n "$(inode "$TMP/probe_i1")" ] && [ "$(inode "$TMP/probe_i1")" != "$(inode "$TMP/probe_i2")" ]; then
  printf '%s' "$SHA_B" > "$TMP/ok/marker5"
  before="$(inode "$TMP/ok/marker5")"
  QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_A" invoke "$TMP/ok/marker5"
  after="$(inode "$TMP/ok/marker5")"
  if [ "$after" != "$before" ]; then verdict=replaced; else verdict=rewritten-in-place; fi
  check_eq "replaces the marker rather than rewriting it in place (atomicity)" "replaced" "$verdict"
  check_eq "and the replaced marker holds the new sha" "$SHA_A" "$(cat "$TMP/ok/marker5")"
else
  skip_case "atomicity case — this filesystem does not report distinct inodes"
fi

# ── Does this filesystem actually enforce permissions? ──────────────────────
# Two independent questions, and Git Bash on Windows answers them differently:
# it maps chmod on a FILE to the readonly attribute (enforced) but ignores
# chmod on a DIRECTORY. root bypasses both. Probing each separately keeps the
# suite meaningful on the Linux CI runner — which is neither — and honest
# everywhere else: a case that cannot bite is skipped, not asserted.
mkdir -p "$TMP/probe/dir"
printf x > "$TMP/probe/f"
chmod 444 "$TMP/probe/f" 2>/dev/null || true
chmod 555 "$TMP/probe/dir" 2>/dev/null || true
PERMS_FILE=0
PERMS_DIR=0
if [ "$(id -u)" != "0" ]; then
  (printf y > "$TMP/probe/f") 2>/dev/null || PERMS_FILE=1
  (printf y > "$TMP/probe/dir/f") 2>/dev/null || PERMS_DIR=1
fi
chmod 755 "$TMP/probe/dir" 2>/dev/null || true

# ── The incident itself: a marker owned by root, in a dir we own ────────────
# The exact VPS shape. The old inline `printf > "$QA_STATE_FILE"` opened the
# FILE and got EACCES. Writing a temp and renaming needs write permission on
# the DIRECTORY only, so this self-heals: the marker is replaced and ends up
# owned by the runner. Simulated with a read-only file rather than a foreign
# uid, which a test cannot create without root; the failing syscall is the
# same one.
if [ "$PERMS_FILE" != "1" ]; then
  skip_case "read-only-marker case — chmod on files is not enforced here (Git Bash, or root)"
else
  mkdir -p "$TMP/ro"
  printf '%s' "$SHA_B" > "$TMP/ro/marker"
  chmod 444 "$TMP/ro/marker"
  QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_A" invoke "$TMP/ro/marker"
  check_eq "returns 0 when the marker file itself is not writable (the five-run outage)" "0" "$invoke_rc"
  check_eq "recovers a read-only marker in a writable dir instead of dying on it" \
    "$SHA_A" "$(cat "$TMP/ro/marker")"
  check_eq "leaves no stray temp file after recovering the marker" \
    "marker" "$(ls -A "$TMP/ro" | sort | tr '\n' ' ' | sed 's/ $//')"
fi

# ── Nothing left to try: the directory is unwritable too ────────────────────
# No temp file can be created either, so the marker genuinely cannot be saved.
# This is the path that must warn and carry on.
if [ "$PERMS_DIR" != "1" ]; then
  skip_case "unwritable-dir cases — chmod on directories is not enforced here (Git Bash, or root)"
else
  mkdir -p "$TMP/rodir"
  chmod 555 "$TMP/rodir"
  # The counter must live in the unwritable directory too, or the
  # "cannot escalate" branch is unreachable and this block silently
  # asserts the ordinary streak path instead.
  rodir_saved_counter="$QA_DEGRADED_FILE"
  QA_DEGRADED_FILE="$TMP/rodir/marker.degraded"
  QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_A" invoke "$TMP/rodir/marker"
  check_eq "returns 0 when the marker cannot be saved at all" "0" "$invoke_rc"
  check_contains "says loudly that the marker could not be written" \
    "could not write the deploy marker" "$invoke_out"
  check_contains "names the marker path in the warning" "$TMP/rodir/marker" "$invoke_out"
  check_contains "states the deploy itself SUCCEEDED, so the log is not read as a failed sync" \
    "SUCCEEDED" "$invoke_out"
  check_contains "emits a ::warning:: annotation so it surfaces in the run summary" \
    "::warning::" "$invoke_out"
  # On stderr specifically: this script's own stdout is block-buffered, which
  # is what made #718's failure unreadable. A mutant moving the annotation to
  # stdout survived an assert that only looked at the merged streams.
  check_contains "sends the ::warning:: to stderr, the stream that is not block-buffered" \
    "::warning::" "$invoke_err"
  # log() legitimately writes to stdout; the property is that the ANNOTATION
  # is not there, not that stdout is silent.
  case "$invoke_stdout" in
    *"::warning::"*) stdout_verdict=leaked ;;
    *) stdout_verdict=clean ;;
  esac
  check_eq "keeps the ::warning:: off block-buffered stdout" "clean" "$stdout_verdict"
  check_contains "points at file ownership, the cause both times this bit" \
    "owned by the wrong user" "$invoke_out"
  check_contains "promises a full rebuild, not an inherited baseline" \
    "rebuilds every app" "$invoke_out"
  check_eq "leaves no stray temp file behind when the write is impossible" "" "$(ls -A "$TMP/rodir")"
  check_contains "admits it cannot escalate when the counter is unwritable too" \
    "cannot escalate" "$invoke_out"
  # The failure path must not spray tool errors of its own into the log.
  # write_atomic() is only ever called from an `if` condition, which
  # suppresses errexit for its whole call tree, so a bare `rm` there cannot
  # abort the deploy any more (measured) — but it does print
  # "rm: cannot remove ...: No such file" on every degraded run, into the
  # one log someone is reading to find out why. #718 was two hours of
  # exactly that. Keeping the mutant dead keeps the log honest.
  case "$invoke_err" in
    *"rm:"*) sweep_verdict=noisy ;;
    *) sweep_verdict=quiet ;;
  esac
  check_eq "keeps tool noise out of the degraded-run log" "quiet" "$sweep_verdict"
  QA_DEGRADED_FILE="$rodir_saved_counter"
fi

# ── The marker path is a directory ──────────────────────────────────────────
# `mv -f file dir` moves the file INSIDE dir and exits 0. Without the guard
# the function would report a recorded deploy having recorded nothing, and
# every later read_qa_prev_sha() would `cat` a directory. Caught by a mutant,
# not by review.
mkdir -p "$TMP/asdir/marker"
rm -f "$QA_DEGRADED_FILE"
QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_A" invoke "$TMP/asdir/marker"
check_eq "returns 0 when the marker path is a directory" "0" "$invoke_rc"
check_contains "warns instead of silently moving the temp file into it" \
  "could not write the deploy marker" "$invoke_out"
check_eq "does not stash the marker inside that directory" "" "$(ls -A "$TMP/asdir/marker")"
check_eq "leaves no temp file beside the directory" "marker" \
  "$(ls -A "$TMP/asdir" | sort | tr '\n' ' ' | sed 's/ $//')"

# ── write_atomic() sweeps its own temp when the write fails ────────────────
# record_deploy_marker() now clears stale temps BEFORE writing, so planting
# one there proves the sweep, not the cleanup. write_atomic() is called
# directly here, where nothing has swept ahead of it: pre-occupying its temp
# path with a read-only file makes `printf` fail with the temp still
# present, which is the ENOSPC shape - something was written and could not
# be installed, and must not be left for read_qa_prev_sha() to trip over.
if [ "$PERMS_FILE" != "1" ]; then
  skip_case "write_atomic cleanup case - chmod on files is not enforced here (Git Bash, or root)"
else
  mkdir -p "$TMP/tmpblock"
  printf %s stale > "$TMP/tmpblock/marker.tmp.$$"
  chmod 444 "$TMP/tmpblock/marker.tmp.$$"
  wa_rc=0
  write_atomic "$TMP/tmpblock/marker" "$SHA_A" 2>/dev/null || wa_rc=$?
  check_eq "write_atomic reports failure when its temp cannot be written" "1" "$wa_rc"
  check_eq "write_atomic wrote no marker it could not complete" "absent" \
    "$([ -e "$TMP/tmpblock/marker" ] && echo present || echo absent)"
  check_eq "write_atomic sweeps the temp it could not use" "" "$(ls -A "$TMP/tmpblock")"
fi

# ── A stale read-only temp does not block the next run ─────────────────────
# The same planted temp, but through record_deploy_marker(): its sweep
# clears it first, so a killed run cannot wedge every deploy that follows.
mkdir -p "$TMP/staletmp"
printf %s stale > "$TMP/staletmp/marker.tmp.$$"
chmod 444 "$TMP/staletmp/marker.tmp.$$" 2>/dev/null || true
QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_A" invoke "$TMP/staletmp/marker"
check_eq "a stale read-only temp is swept, and the marker still records" \
  "$SHA_A" "$(cat "$TMP/staletmp/marker")"

# ── A killed run's leftover temp is swept, not accumulated ──────────────────
# SIGKILL between the write and the rename leaves a .tmp.<pid> behind and
# nothing else collects them. The workflow's qa-deploy concurrency group means
# only one sync runs at a time on this host, so taking all of them is safe.
mkdir -p "$TMP/sweep"
printf 'orphan' > "$TMP/sweep/marker.tmp.99999"
QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_A" invoke "$TMP/sweep/marker"
check_eq "sweeps a killed run's orphaned temp file" "marker" \
  "$(ls -A "$TMP/sweep" | sort | tr '\n' ' ' | sed 's/ $//')"

echo
echo "the degraded-run streak"

# ── A standing misconfiguration must stop being nobody's problem ────────────
# The warning lands on a GREEN run, and a yellow annotation has no owner and
# no expiry. One degraded run is noise; a streak is a host that will produce
# the next #718. The counter escalates it to a red deploy.
mkdir -p "$TMP/streak/asdir"
QA_DEGRADED_FILE="$TMP/streak/counter"
degrade() { QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_A" invoke "$TMP/streak/asdir"; }

rm -f "$QA_DEGRADED_FILE"
degrade
check_eq "first degraded run stays green" "0" "$invoke_rc"
check_eq "and records a streak of 1" "1" "$(cat "$QA_DEGRADED_FILE")"
check_contains "says where in the streak it is" "1/3" "$invoke_out"

degrade
check_eq "second degraded run stays green" "0" "$invoke_rc"
check_eq "and records a streak of 2" "2" "$(cat "$QA_DEGRADED_FILE")"

# The third trips the limit and must FAIL the deploy — errexit is expected
# here, so the ERR-trap net above is deliberately not the assertion.
# invoke() redirects inside the subshell, so the escalation text lands in
# invoke's files rather than the subshell's - read those, not a wrapper.
rc=0
( degrade ) || rc=$?
esc="$(cat "$TMP/invoke.out" "$TMP/invoke.err")"
check_eq "the third consecutive degraded run fails the deploy" "1" "$rc"
check_contains "escalates with an ::error:: annotation" "::error::" "$esc"
check_contains "says how many runs in a row failed" "3 times in a row" "$esc"

# A successful write clears the streak, so unrelated blips months apart never
# accumulate into a red run.
printf '9' > "$QA_DEGRADED_FILE"
QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_A" invoke "$TMP/streak/good"
if [ -e "$QA_DEGRADED_FILE" ]; then cleared=present; else cleared=absent; fi
check_eq "a successful write clears the streak" "absent" "$cleared"

# Garbage in the counter must not crash the arithmetic under `set -e`.
printf 'not-a-number' > "$QA_DEGRADED_FILE"
degrade
check_eq "treats a corrupt counter as zero rather than dying on it" "1" "$(cat "$QA_DEGRADED_FILE")"

trap - ERR

echo
echo "  $pass passed, $fail failed, $skip skipped"
[ "$fail" -eq 0 ]
