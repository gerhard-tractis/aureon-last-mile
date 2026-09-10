#!/usr/bin/env bash
#
# Tests for widen_changed_flags() in deploy-qa.sh.
#
# The CHANGED_* flags arrive from the workflow's `changes` job, which diffs
# exactly one commit: DEPLOY_SHA against its parent. That is correct only if
# every merge's deploy run actually reaches QA. It does not.
#
# Observed 2026-08-17: #441, #438 and #442 merged within three minutes. All
# three Deploy Production runs contend for the `qa-deploy` concurrency group,
# and GitHub keeps only ONE pending run per group — so #438's QA sync was
# cancelled to make room for #442's. The next run to land was #442, a
# .github-only commit, so CHANGED_FRONTEND was false and the frontend was
# never rebuilt. QA served the pre-#438 bundle while every check was green.
#
# Migrations and the seed already defend against this by replaying in full on
# every run. These tests pin the same property for app rebuilds: the baseline
# is what QA actually has checked out, not what one commit happened to touch.
#
# Run: bash infra/supabase-qa/deploy-qa.drift.test.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0

check_eq() { # $1 name, $2 expected, $3 actual
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1 — expected '$2', got '$3'"
  fi
}

# Only the functions under test, so sourcing cannot run the script's main().
extract() { sed -n "/^$1() {/,/^}/p" "$HERE/deploy-qa.sh"; }
{
  extract log
  extract err
  extract is_true
  extract widen_changed_flags
  extract read_qa_prev_sha
} > "$TMP/fns.sh"
# shellcheck disable=SC1091
. "$TMP/fns.sh"

# ── A throwaway repo standing in for the QA checkout ─────────────────────────
REPO="$TMP/qa"
mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" config user.email t@t.t
git -C "$REPO" config user.name t

commit_touching() { # $1 path -> echoes the new sha
  mkdir -p "$REPO/$(dirname "$1")"
  echo "$RANDOM" > "$REPO/$1"
  git -C "$REPO" add -A >/dev/null
  git -C "$REPO" commit -qm "touch $1" >/dev/null
  git -C "$REPO" rev-parse HEAD
}

BASE=$(commit_touching README.md)
FRONTEND_SHA=$(commit_touching apps/frontend/src/app/page.tsx)
GITHUB_SHA=$(commit_touching .github/workflows/ci.yml)

export QA_CHECKOUT_DIR="$REPO"

echo "widen_changed_flags()"

# ── The regression: QA is behind by a frontend commit ───────────────────────
# QA sits at BASE. The run that would have deployed the frontend commit was
# dropped, so this run is for GITHUB_SHA and the workflow says nothing changed.
# The frontend commit is still in the range QA has not seen.
QA_PREV_SHA="$BASE" DEPLOY_SHA="$GITHUB_SHA" \
  CHANGED_FRONTEND=false CHANGED_WORKER=false CHANGED_AGENTS=false CHANGED_EDGE_FUNCTIONS=false \
  eval 'widen_changed_flags >/dev/null 2>&1; echo "$CHANGED_FRONTEND"' > "$TMP/out"
check_eq "rebuilds the frontend a dropped run skipped" "true" "$(cat "$TMP/out")"

# ── No false positives ──────────────────────────────────────────────────────
# QA is at the frontend commit; only .github moved since. Nothing to rebuild.
QA_PREV_SHA="$FRONTEND_SHA" DEPLOY_SHA="$GITHUB_SHA" \
  CHANGED_FRONTEND=false CHANGED_WORKER=false CHANGED_AGENTS=false CHANGED_EDGE_FUNCTIONS=false \
  eval 'widen_changed_flags >/dev/null 2>&1; echo "$CHANGED_FRONTEND"' > "$TMP/out"
check_eq "leaves the frontend alone when only .github moved" "false" "$(cat "$TMP/out")"

# ── Never narrows what the workflow asked for ───────────────────────────────
# The workflow's own diff is authoritative for the commit being deployed; this
# function may only widen. A true that becomes false would skip a real rebuild.
QA_PREV_SHA="$FRONTEND_SHA" DEPLOY_SHA="$GITHUB_SHA" \
  CHANGED_FRONTEND=true CHANGED_WORKER=false CHANGED_AGENTS=false CHANGED_EDGE_FUNCTIONS=false \
  eval 'widen_changed_flags >/dev/null 2>&1; echo "$CHANGED_FRONTEND"' > "$TMP/out"
check_eq "never turns a workflow true into false" "true" "$(cat "$TMP/out")"

# ── QA already at the target ────────────────────────────────────────────────
QA_PREV_SHA="$GITHUB_SHA" DEPLOY_SHA="$GITHUB_SHA" \
  CHANGED_FRONTEND=false CHANGED_WORKER=false CHANGED_AGENTS=false CHANGED_EDGE_FUNCTIONS=false \
  eval 'widen_changed_flags >/dev/null 2>&1; echo "$CHANGED_FRONTEND"' > "$TMP/out"
check_eq "no-ops when QA is already at the deployed commit" "false" "$(cat "$TMP/out")"

# ── Unknown baseline means rebuild everything ───────────────────────────────
# A fresh or force-reset checkout has no usable previous commit. Guessing
# "nothing changed" is how QA stays stale; rebuilding is merely slow.
QA_PREV_SHA="" DEPLOY_SHA="$GITHUB_SHA" \
  CHANGED_FRONTEND=false CHANGED_WORKER=false CHANGED_AGENTS=false CHANGED_EDGE_FUNCTIONS=false \
  eval 'widen_changed_flags >/dev/null 2>&1; echo "$CHANGED_FRONTEND $CHANGED_WORKER $CHANGED_AGENTS $CHANGED_EDGE_FUNCTIONS"' > "$TMP/out"
check_eq "rebuilds everything when the baseline is unknown" "true true true true" "$(cat "$TMP/out")"

# A sha that is not in this repo is just as unusable as an empty one.
QA_PREV_SHA="0000000000000000000000000000000000000000" DEPLOY_SHA="$GITHUB_SHA" \
  CHANGED_FRONTEND=false CHANGED_WORKER=false CHANGED_AGENTS=false CHANGED_EDGE_FUNCTIONS=false \
  eval 'widen_changed_flags >/dev/null 2>&1; echo "$CHANGED_FRONTEND"' > "$TMP/out"
check_eq "rebuilds everything when the baseline is not a known commit" "true" "$(cat "$TMP/out")"

# ── Each area maps to its own flag ──────────────────────────────────────────
WORKER_SHA=$(commit_touching apps/worker/index.ts)
QA_PREV_SHA="$GITHUB_SHA" DEPLOY_SHA="$WORKER_SHA" \
  CHANGED_FRONTEND=false CHANGED_WORKER=false CHANGED_AGENTS=false CHANGED_EDGE_FUNCTIONS=false \
  eval 'widen_changed_flags >/dev/null 2>&1; echo "$CHANGED_WORKER $CHANGED_FRONTEND"' > "$TMP/out"
check_eq "maps apps/worker to the worker flag only" "true false" "$(cat "$TMP/out")"

echo
echo "read_qa_prev_sha() (spec-88 fase 3, ronda 6)"

# The bug this ronda chased: sync_checkout() used to read QA_PREV_SHA
# straight from the checkout's `git rev-parse HEAD`. `git reset --hard`
# (inside sync_checkout, unconditionally, every run) advances that HEAD
# BEFORE any restart/rebuild step runs later in main() — so a run that dies
# partway through main() (restart_functions hit a real permission bug,
# #718, 2026-09-09) still leaves the checkout's HEAD at the new commit. The
# next run then reads that already-advanced HEAD as "prev", and any file
# that landed in the commit the dead run already checked out silently drops
# out of the diff. Measured live: this exact mechanism dropped
# CHANGED_QA_COMPOSE to false on the retry after #710 merged, and
# `docker inspect supabase-qa-auth` showed the container still running its
# pre-merge environment — `restart_auth()` was simply never called.
QA_CHECKOUT_DIR="$REPO"
QA_STATE_FILE="$TMP/state-missing"
# An ABSENT marker must report NOTHING, which widen_changed_flags() turns
# into "rebuild every app" (see its unknown-baseline cases above).
#
# This used to fall back to `git rev-parse HEAD`, on the reasoning that the
# only way to have no marker was a first run on a fresh host. Making the
# marker write non-fatal (#732, after five deploys died on an unwritable
# marker) created a second way, and with it a hole big enough to undo this
# whole ronda:
#
#   run N   degraded - the marker could not be written at all, deploy green
#   run N+1 sync_checkout's `git reset --hard` lands, then main() dies
#           partway (the #718 permission bug, same day)
#   run N+2 no marker, so prev = HEAD = run N+1's sha - and every file run
#           N+1 checked out but never deployed drops out of the diff
#
# That is the bug this ronda exists to remove, arriving by the back door.
# Before the write became non-fatal the invariant survived by CRASHING. It
# now survives by degrading to the SAFE baseline instead: no marker, no
# baseline, rebuild everything. The cost is one slow run on a genuinely
# fresh host - the case where rebuilding everything was correct anyway.
check_eq "reports no baseline when the marker is absent, so everything rebuilds" \
  "" "$(read_qa_prev_sha)"

printf '%s' "$FRONTEND_SHA" > "$TMP/state-present"
QA_STATE_FILE="$TMP/state-present"
check_eq "reads the marker instead of git HEAD once one exists" \
  "$FRONTEND_SHA" "$(read_qa_prev_sha)"

# The exact scenario that broke: the checkout's HEAD has already moved past
# what the marker says, because a previous run's sync_checkout() ran but its
# later restarts died. read_qa_prev_sha() must still report the OLDER,
# marker-recorded commit — not the checkout's newer HEAD — so
# widen_changed_flags() sees the true, still-outstanding diff.
# STALE is not ABSENT, and the difference is the whole design: the real
# incident's marker was root-owned but perfectly READABLE, so it is a safe,
# older baseline and stays in use. Only a marker that is not there at all
# forces the full rebuild.
QA_STATE_FILE="$TMP/state-present"
check_eq "still uses a stale-but-readable marker rather than rebuilding everything" \
  "$FRONTEND_SHA" "$(read_qa_prev_sha)"

current_head="$(git -C "$REPO" rev-parse HEAD)"
if [ "$current_head" = "$FRONTEND_SHA" ]; then
  fail=$((fail + 1)); echo "  FAIL test setup — REPO HEAD unexpectedly equals FRONTEND_SHA, the case below proves nothing"
else
  check_eq "reports the marker even when the checkout has since moved past it" \
    "$FRONTEND_SHA" "$(read_qa_prev_sha)"
fi

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
