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
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
