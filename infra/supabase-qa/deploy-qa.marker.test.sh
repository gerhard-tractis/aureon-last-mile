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
#      marker falls back to whatever marker an earlier run left — or, if
#      there never was one, to no baseline at all, which rebuilds every app.
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
    *) fail=$((fail + 1)); echo "  FAIL $1 — expected output containing '$2', got: $(printf %s "$3" | head -c 400)" ;;
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

# Read from the script rather than retyped, so the test cannot drift from it
# — and so it is DEFINED at all. extract() pulls functions only, so this was
# unset on the first pass: `exit "$QA_EXIT_MARKER_STREAK"` then tripped
# `set -u` and exited 1, and the escalation assert "expected 1" passed while
# verifying nothing about the exit code it exists to pin.
QA_EXIT_MARKER_STREAK="$(grep '^QA_EXIT_MARKER_STREAK=' "$HERE/deploy-qa.sh" | head -1 | cut -d= -f2)"
if [ -z "$QA_EXIT_MARKER_STREAK" ]; then
  echo "  FAIL could not read QA_EXIT_MARKER_STREAK from deploy-qa.sh"; exit 1
fi

# Same reasoning: hardcoding 3 here left the script's own default free to
# drift away from what this suite actually exercises (measured — mutating
# the script's `:-3` to `:-99` left every assert below unchanged, since none
# of them read the script's default).
QA_DEGRADED_MAX="$(grep '^QA_DEGRADED_MAX="\${QA_DEGRADED_MAX:-' "$HERE/deploy-qa.sh" | head -1 | sed 's/.*:-\([0-9]*\)}".*/\1/')"
if [ -z "$QA_DEGRADED_MAX" ]; then
  echo "  FAIL could not read QA_DEGRADED_MAX's default from deploy-qa.sh"; exit 1
fi

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
# fd 3 is a copy of the real stderr, taken BEFORE invoke() redirects
# anything, and it is LOAD-BEARING. Deleting it reintroduces a red run with
# no reason in it — the exact failure on_err() exists to abolish.
#
# There are two ways a function under `set -e` can fail, and only one of
# them keeps the caller's redirection alive when the ERR trap runs:
#
#   FORM A  the function ends with an explicit `return 1`. The redirection
#           is already torn down; the trap prints to the real stderr.
#   FORM B  a command INSIDE the function fails and errexit trips there.
#           The trap runs with the redirection STILL IN EFFECT.
#
# Measured on bash 5.2.21 (the VPS and the GitHub runner) and 5.2.37:
#
#   FORM A  no fd 3 -> visible=[TRAP: aborted]      fd 3 -> visible=[TRAP: aborted]
#   FORM B  no fd 3 -> visible=[]                   fd 3 -> visible=[TRAP: aborted]
#                      ^ the message went into $TMP/invoke.out, which the
#                        EXIT trap then deleted: red, and mute.
#
# This comment previously claimed the opposite and called the line
# decorative. That claim came from a probe that used FORM A — the one shape
# that cannot reproduce the bug — and it nearly got a correct guard deleted
# as dead weight. The self-check below therefore fails in FORM B on purpose,
# and it is built out of THIS file's own harness, not a copy of it.
exec 3>&2
trap 'harness_abort $?' ERR

harness_abort() { # $1 exit status of the command that tripped errexit
  # `set -eE` propagates this trap into command substitutions too, not only
  # into record_deploy_marker's own call. A command used merely to build an
  # assert's "actual" value — e.g. `$(cat "$TMP/persist/marker")` when a
  # mutant deletes that file — can trip it there, inside a CHILD subshell.
  # Reporting from there prints "record_deploy_marker aborted the deploy",
  # which never touched record_deploy_marker, and does so WITHOUT
  # incrementing $fail — that counter lives in this (unaffected) parent
  # shell, so the misattributed FAIL is invisible to the pass/fail tally.
  # Measured with the `rm -f "$path"` mutant. Only the real top-level shell
  # — the one invoke() actually runs record_deploy_marker in — may report.
  [ "$BASHPID" = "$$" ] || exit "$1"
  {
    echo "  FAIL record_deploy_marker aborted the deploy (exit $1) — it must never do that"
    echo "  --- what it had written before dying ---"
    cat "$TMP/invoke.out" "$TMP/invoke.err" 2>/dev/null | sed "s/^/  | /"
  } >&3
  exit 1
}

invoke() { # $1 marker path; the sha env vars come from the caller
  QA_STATE_FILE="$1" record_deploy_marker > "$TMP/invoke.out" 2> "$TMP/invoke.err"
  invoke_rc=$?
  invoke_out="$(cat "$TMP/invoke.out" "$TMP/invoke.err")"
  invoke_err="$(cat "$TMP/invoke.err")"
  invoke_stdout="$(cat "$TMP/invoke.out")"
}

# NOTE on what is NOT asserted here: there is no `check_eq "... returns 0"`.
# invoke_rc is only ever assigned if the call did NOT abort, so comparing it
# to 0 is a tautology that always passes. The real assertion for "must not
# abort the deploy" is the ERR trap above, which fires before any such line
# could run — which is exactly why it had to be made audible first.
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
  # NOT "rebuilds every app" unconditionally — that was true only when no
  # marker had ever existed. A run whose WRITE fails leaves any PRIOR marker
  # on disk untouched (write_atomic only ever fails before the rename), so
  # the next run's read_qa_prev_sha() still finds it and diffs from it —
  # a full rebuild happens only when there was never a marker to fall back
  # to. See the persistence case below, which is the scenario that made the
  # old wording false.
  check_contains "promises the last recorded marker as the fallback, not the checkout's HEAD" \
    "falls back to the last recorded marker" "$invoke_out"
  # deploy.yml promises the log "names the marker path, its owner and the
  # exact chown" — tie this to the actual ls -ld output rather than just the
  # surrounding prose, or deleting that line survives every other assert here.
  rodir_listing="$(ls -ld "$TMP/rodir" 2>&1 || true)"
  check_contains "prints the marker directory's actual permissions/owner (ls -ld), not just a path" \
    "$rodir_listing" "$invoke_out"
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

# ── A write failure does not erase a marker an EARLIER run recorded ────────
# The message above promises the next run falls back to the last recorded
# marker rather than having no baseline at all. That is only true if a write
# failure leaves a PRIOR marker on disk untouched — provable without chmod
# (not enforced on every OS this suite runs on) by blocking write_atomic's
# own temp path with a directory: `mv -f tmp path` never runs, so `path`
# cannot have been touched by this failed attempt.
mkdir -p "$TMP/persist"
QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_A" invoke "$TMP/persist/marker"
check_eq "a marker written by an earlier successful run is there to begin with" \
  "$SHA_A" "$(cat "$TMP/persist/marker")"
mkdir -p "$TMP/persist/marker.tmp.$$"
QA_SYNCED_SHA="$SHA_B" DEPLOY_SHA="$SHA_B" invoke "$TMP/persist/marker"
check_contains "this later run's write is reported as failed" \
  "could not write the deploy marker" "$invoke_out"
check_eq "and the earlier marker survives — the next run reads THAT, not no baseline" \
  "$SHA_A" "$(cat "$TMP/persist/marker")"
# This is the wording assert that matters, and it must not live only in the
# chmod-555 block above — that block is SKIPPED on any OS/user where
# directory permissions are not enforced (Git Bash, root), which would leave
# a false claim in the operator-facing message uncaught on exactly those
# hosts. This scenario needs no chmod at all.
check_contains "promises the last recorded marker as the fallback, not the checkout's HEAD" \
  "falls back to the last recorded marker" "$invoke_out"
# Same reasoning as the wording assert above: the ls -ld check also lived
# only in the chmod-555 block, which skips on any host that does not enforce
# directory permissions. This scenario fails the write for a different
# reason but still runs the same ls -ld lines, so it is a portable place to
# pin deploy.yml's promise that the log "names the marker path, its owner
# and the exact chown."
# The marker FILE itself, not just its directory — the scenario this test
# builds leaves an existing, readable marker behind, so `ls -ld` on the
# marker path succeeds and prints something real, not "No such file".
persist_marker_listing="$(ls -ld "$TMP/persist/marker" 2>&1 || true)"
check_contains "prints the marker file's actual permissions/owner (ls -ld)" \
  "$persist_marker_listing" "$invoke_out"
rmdir "$TMP/persist/marker.tmp.$$"

# ── The marker path is a directory ──────────────────────────────────────────
# `mv -f file dir` moves the file INSIDE dir and exits 0. Without the guard
# the function would report a recorded deploy having recorded nothing, and
# every later read_qa_prev_sha() would `cat` a directory. Caught by a mutant,
# not by review.
mkdir -p "$TMP/asdir/marker"
rm -f "$QA_DEGRADED_FILE"
QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_A" invoke "$TMP/asdir/marker"
check_contains "warns instead of silently moving the temp file into it" \
  "could not write the deploy marker" "$invoke_out"
check_eq "does not stash the marker inside that directory" "" "$(ls -A "$TMP/asdir/marker")"
check_eq "leaves no temp file beside the directory" "marker" \
  "$(ls -A "$TMP/asdir" | sort | tr '\n' ' ' | sed 's/ $//')"

# ── write_atomic() fails cleanly when its temp path is unusable ────────────
# The sweep now runs INSIDE write_atomic (so it also covers the counter's
# temp), which means a merely read-only temp gets cleared and the write
# succeeds — the old way of reaching this branch no longer reaches it.
# A DIRECTORY at the temp path does: `rm -f` will not remove it and
# `printf >` cannot write it, so the failure path runs with the leftover
# genuinely stuck. What must hold is that it reports failure, writes no
# marker, and does not abort.
mkdir -p "$TMP/tmpblock"
mkdir -p "$TMP/tmpblock/marker.tmp.$$"
wa_rc=0
write_atomic "$TMP/tmpblock/marker" "$SHA_A" 2>/dev/null || wa_rc=$?
check_eq "write_atomic reports failure when its temp path is unusable" "1" "$wa_rc"
if [ -e "$TMP/tmpblock/marker" ]; then wrote=present; else wrote=absent; fi
check_eq "write_atomic writes no marker it could not complete" "absent" "$wrote"
rmdir "$TMP/tmpblock/marker.tmp.$$"

# ── The sweep covers the COUNTER's temp, not just the marker's ─────────────
# The counter's temp is "<marker>.degraded.tmp.<pid>". A sweep anchored on
# the marker name alone does not match it, so a SIGKILL between its write
# and its rename left one orphaned byte in aureon's home forever. Moving the
# sweep inside write_atomic makes it every path's problem, not the marker's.
mkdir -p "$TMP/ctr"
QA_DEGRADED_FILE="$TMP/ctr/marker.degraded"
printf %s orphan > "$TMP/ctr/marker.degraded.tmp.99999"
mkdir -p "$TMP/ctr/marker"   # unwritable marker path, to force the counter write
QA_SYNCED_SHA="$SHA_A" DEPLOY_SHA="$SHA_A" invoke "$TMP/ctr/marker"
check_eq "sweeps an orphaned counter temp, not only the marker's" \
  "marker marker.degraded" "$(ls -A "$TMP/ctr" | sort | tr '\n' ' ' | sed 's/ $//')"
QA_DEGRADED_FILE="$TMP/degraded"

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
check_eq "and records a streak of 1" "1" "$(cat "$QA_DEGRADED_FILE")"
check_contains "says where in the streak it is" "1/3" "$invoke_out"

degrade
check_eq "and records a streak of 2" "2" "$(cat "$QA_DEGRADED_FILE")"

# The third trips the limit and must FAIL the deploy — errexit is expected
# here, so the ERR-trap net above is deliberately not the assertion.
# invoke() redirects inside the subshell, so the escalation text lands in
# invoke's files rather than the subshell's - read those, not a wrapper.
rc=0
( degrade ) || rc=$?
esc="$(cat "$TMP/invoke.out" "$TMP/invoke.err")"
check_eq "the third consecutive degraded run fails the deploy" "$QA_EXIT_MARKER_STREAK" "$rc"
# Distinct from 1 on purpose: deploy.yml keys the true diagnosis off it, and
# a plain 1 would fall through to "QA is now drifted from main", which is the
# one thing that has NOT happened here.
check_eq "and does so with a code the workflow can tell apart from any other failure" \
  "distinct" "$([ "$QA_EXIT_MARKER_STREAK" != "1" ] && echo distinct || echo generic)"
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
echo "the harness itself"

# ── The net has to be audible, or a red run says nothing ───────────────────
# This used to run a hand-written REPLICA of the harness inside a heredoc.
# That made it untestable in the way that matters: `grep -c` found TWO
# harness_abort definitions, and a mutant that gutted the REAL one left the
# replica untouched, so the self-check stayed green while the thing it
# claims to protect was gone. The child is now generated from THIS file:
# the same `exec 3>&2` and the same harness_abort, extracted verbatim.
# `|| true`: errexit is still live here (only the ERR trap was removed
# above, not `set -eE` from line 99) — grep exits 1 on no match, and an
# unguarded assignment would kill the suite before this block's own asserts
# run. Measured: deleting `exec 3>&2` from this file made grep find nothing,
# and the whole suite died with zero FAILs printed — mute in exactly the
# shape this file exists to abolish.
real_fd3="$(grep '^exec 3>&2$' "$0" || true)"
check_eq "the harness still dups the real stderr before invoke() redirects" \
  "exec 3>&2" "$real_fd3"
real_abort="$(awk '/^harness_abort\(\) \{/{f=1} f{print} f&&/^\}/{exit}' "$0")"
check_eq "the harness is defined once, so the self-check cannot test a copy" \
  "1" "$(grep -c '^harness_abort() {' "$0")"

{
  echo 'TMP="$1"'
  echo 'mkdir -p "$TMP"'
  echo "$real_fd3"
  echo "$real_abort"
  # NOT `echo "trap '\'harness_abort \$?\' ERR"` — inside a double-quoted
  # echo, `\'` is not an escape, so that emitted the literal 6 characters
  # `'\'` followed by `harness_abort $?\'`, which bash then tokenizes as
  # `trap \harness_abort "0'" ERR`: an invalid signal spec ("0'") that
  # trap rejects, alongside a valid one ("ERR") that DOES get installed —
  # but bound to the bare word `harness_abort`, with no `$?` argument.
  # Measured: the child's trap fires with $1 empty, not the real exit
  # status. Single-quote the whole trap command instead; `\$?` is a real
  # escape inside double quotes, so this leaves `harness_abort $?` intact.
  echo "trap 'harness_abort \$?' ERR"
  # FORM B: a command fails INSIDE the function. A `return 1` here would
  # tear the redirection down first and prove nothing.
  echo 'record_deploy_marker() { echo "some output first"; rm /nonexistent/nope 2>/dev/null; }'
  echo 'invoke() { record_deploy_marker > "$TMP/invoke.out" 2> "$TMP/invoke.err"; invoke_rc=$?; }'
  echo 'set -eE'
  echo 'invoke'
  echo 'echo "REACHED THE END - the net did not fire"'
} > "$TMP/selfcheck.sh"
sc_out="$(bash "$TMP/selfcheck.sh" "$TMP/scdir" 2>&1 || true)"
check_contains "an abort is reported, not swallowed by invoke() redirection" \
  "aborted the deploy" "$sc_out"
# `rm /nonexistent/nope` exits 1; harness_abort's $1 must be THAT status, not
# empty. A mutant dropping `$?` from the trap's action (`trap 'harness_abort $?' ERR`
# -> `trap 'harness_abort' ERR`) survived every other assert here — $1 is
# simply unset inside harness_abort, `$1` in its own message expands to
# empty, and "aborted the deploy (exit )" still contains "aborted the deploy".
check_contains "and reports the exit status that actually tripped errexit" \
  "aborted the deploy (exit 1)" "$sc_out"
check_contains "and the reason reaches the reader with the output that preceded it" \
  "some output first" "$sc_out"
case "$sc_out" in
  *"REACHED THE END"*) net_verdict=leaked ;;
  *) net_verdict=stopped ;;
esac
check_eq "an abort stops the suite instead of passing through" "stopped" "$net_verdict"

echo
echo "the failure message the operator reads (deploy.yml)"

# ── A correct red with a false reason is still two hours lost ──────────────
# Hitting the streak limit exits 78, and deploy.yml's generic failure step
# would otherwise print "QA is now drifted from main" — which is false. QA is
# in sync; only the note failed, and every degraded run that led here fell
# back to whatever marker was already on disk, or rebuilt every app only if
# there was none. The operator reads the LAST ::error::, so the accurate one
# has to be the only one printed on this path.
YML="$HERE/../../.github/workflows/deploy.yml"
# NOT a skip. The chmod skips above are real environments (Git Bash, root);
# a checkout without .github/workflows/deploy.yml is not one. When the file
# was merely missing, six asserts vanished and the suite still exited 0 —
# which is how three mutants looked "killed" while nothing had run.
if [ ! -f "$YML" ]; then
  fail=$((fail + 1))
  echo "  FAIL deploy.yml not found at $YML — this suite asserts against it;"
  echo "       a checkout missing it is broken, not an environment to skip."
else
  yml="$(cat "$YML")"
  check_contains "the script and the workflow agree on the escalation code" \
    'QA_DEPLOY_RC:-}" = "78"' "$yml"
  check_contains "the sync step records the exit code for the failure step" \
    'echo "$rc" > "$RUNNER_TEMP/qa-deploy-rc"' "$yml"
  check_contains "and the failure step reads it back from that file" \
    'cat "$RUNNER_TEMP/qa-deploy-rc"' "$yml"
  # Capturing the exit code cost `set -e` on that step once, leaving the `cd`
  # unguarded — a failed cd would have run the deploy against whatever tree
  # the runner happened to be in. `|| rc=$?` is a condition context, so the
  # two are not in tension.
  sync_step="$(sed -n '/name: Sync QA environment/,/name: Report failure/p' "$YML")"
  check_contains "the sync step keeps errexit, so its cd stays guarded" \
    "set -euo pipefail" "$sync_step"
  check_contains "the marker path says QA is in sync, not drifted" \
    "::error::QA is in sync" "$yml"
  check_contains "and points at a file permission rather than a QA drift" \
    "FILE PERMISSION on the VPS, not a QA drift" "$yml"
  # This is the wording the OPERATOR reads first, in the run summary — the
  # copy that got fixed in deploy-qa.sh's own log had a twin here that was
  # never pinned. Measured: reverting just this phrase in deploy.yml left
  # the suite at 43 passed, 0 failed.
  check_contains "and promises the last recorded marker as the fallback here too" \
    "fell back to the last recorded marker" "$yml"
  # The generic drift message must still exist for every OTHER failure.
  check_contains "the real drift message survives for every other failure" \
    "QA is now drifted from main" "$yml"
  code="$(grep -c 'QA_EXIT_MARKER_STREAK=78' "$HERE/deploy-qa.sh" || true)"
  check_eq "78 is defined once in the script, so the two cannot drift apart" "1" "$code"
fi
echo
echo "  $pass passed, $fail failed, $skip skipped"
[ "$fail" -eq 0 ]
