#!/usr/bin/env bash
#
# Tests for post-merge-remind.sh (spec-91 fase 1) — PostToolUse hook that
# reminds the orchestrator to close a phase token after `gh pr merge`
# actually merges a PR. Runs against a FAKE `gh` on PATH, never the real
# network — this test must pass with no GitHub access.
#
# Run: bash .claude/hooks/post-merge-remind.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/post-merge-remind.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

# Isolate PATH to exactly: bash's own dir, node's dir, and our fake `gh`
# (prepended, so it's found first). The REAL `gh` must never be reachable —
# these tests assert behavior against a controlled fixture, not live GitHub.
NODE_DIR="$(dirname "$(command -v node)")"
BASH_DIR="$(dirname "$(command -v bash)")"

# Writes BOTH a POSIX shebang script (`gh`, used on Linux CI) and a Windows
# batch file (`gh.cmd`, used on a native-Windows `node`) with the same
# behavior. `execFileSync('gh', ...)` from node spawns via the OS's own
# process creation, not bash — on Windows that never recognizes a
# shebang-only file as executable (no `.exe`/`.cmd`/`.bat` extension, no
# interpreter association), so it silently falls through PATH to the REAL
# `gh.exe` instead of our fixture. Verified the hard way: the exit-2 test
# below returned exit 0 with the fixture reporting a live PR's real branch —
# it had called the real `gh`, not the fake one.
make_fake_gh() { # $1 = json body, $2 = exit code (default 0)
  local dir="$TMP/fakebin-$RANDOM"
  mkdir -p "$dir"
  cat > "$dir/gh" <<EOF
#!/usr/bin/env bash
echo '$1'
exit ${2:-0}
EOF
  chmod +x "$dir/gh"
  printf '@echo off\r\necho %s\r\nexit /b %s\r\n' "$1" "${2:-0}" > "$dir/gh.cmd"
  printf '%s' "$dir"
}

make_missing_gh_path() {
  printf '%s' "$TMP/no-gh-here-$RANDOM"
}

run_hook() { # $1 = json stdin, $2 = fake gh bin dir (or empty)
  local stdin_json="$1" ghdir="${2:-}"
  local path="$NODE_DIR:$BASH_DIR"
  [ -n "$ghdir" ] && path="$ghdir:$path"
  printf '%s' "$stdin_json" | PATH="$path" bash "$HOOK"
}

assert_exit() {
  local expected="$1" name="$2" stdin_json="$3" ghdir="${4:-}"
  local out actual
  out="$(run_hook "$stdin_json" "$ghdir" 2>"$TMP/stderr.$$")"
  actual=$?
  if [ "$actual" -eq "$expected" ]; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1))
    echo "  FAIL $name — expected exit $expected, got $actual"
    echo "       stdout: $out"
    sed 's/^/       stderr: /' "$TMP/stderr.$$"
  fi
}

assert_stderr_contains() {
  local needle="$1" name="$2" stdin_json="$3" ghdir="${4:-}"
  run_hook "$stdin_json" "$ghdir" >"$TMP/out.$$" 2>"$TMP/stderr.$$" || true
  if grep -qF "$needle" "$TMP/stderr.$$"; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1))
    echo "  FAIL $name — stderr did not contain: $needle"
    sed 's/^/       stderr: /' "$TMP/stderr.$$"
  fi
}

echo "post-merge-remind.sh"

MERGED_WITH_SPEC='{"number":693,"headRefName":"feat/spec-80-fase-2-bloqueo-faltantes","state":"MERGED","mergedAt":"2026-09-08T10:00:00Z"}'
MERGED_NO_SPEC='{"number":700,"headRefName":"chore/bump-deps","state":"MERGED","mergedAt":"2026-09-08T10:00:00Z"}'
NOT_MERGED='{"number":701,"headRefName":"feat/spec-90-fase-1-x","state":"OPEN","mergedAt":null}'

bash_tool_json() { # $1 = command
  printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$1"
}

# ── A real merge whose branch names a spec+fase: reminds, exit 2 ──────────
GHDIR="$(make_fake_gh "$MERGED_WITH_SPEC")"
assert_exit 2 "gh pr merge (merged, spec+fase in branch): reminds (exit 2)" \
  "$(bash_tool_json 'gh pr merge 693 --squash')" "$GHDIR"

assert_stderr_contains "spec-80" "reminder names the spec" \
  "$(bash_tool_json 'gh pr merge 693 --squash')" "$GHDIR"

assert_stderr_contains "fase 2" "reminder names the phase hint from the branch name" \
  "$(bash_tool_json 'gh pr merge 693 --squash')" "$GHDIR"

# ── A merged PR whose branch names no spec: silent ─────────────────────────
GHDIR2="$(make_fake_gh "$MERGED_NO_SPEC")"
assert_exit 0 "gh pr merge (merged, no spec in branch): silent (exit 0)" \
  "$(bash_tool_json 'gh pr merge 700 --squash')" "$GHDIR2"

# ── gh pr merge that did NOT actually merge (queued/open): silent ──────────
GHDIR3="$(make_fake_gh "$NOT_MERGED")"
assert_exit 0 "gh pr merge (state != MERGED): silent (exit 0)" \
  "$(bash_tool_json 'gh pr merge 701 --auto --squash')" "$GHDIR3"

# ── Not a merge command at all: never even calls gh ─────────────────────────
# A fake gh here would exit 99 if invoked — proves the hook exits before
# ever shelling out when the command doesn't match.
CRASH_IF_CALLED="$TMP/fakebin-crash"
mkdir -p "$CRASH_IF_CALLED"
cat > "$CRASH_IF_CALLED/gh" <<'EOF'
#!/usr/bin/env bash
exit 99
EOF
chmod +x "$CRASH_IF_CALLED/gh"
printf '@echo off\r\nexit /b 99\r\n' > "$CRASH_IF_CALLED/gh.cmd"
assert_exit 0 "unrelated Bash command: silent, never calls gh" \
  "$(bash_tool_json 'git status')" "$CRASH_IF_CALLED"

# ── Non-Bash tool: silent ───────────────────────────────────────────────────
assert_exit 0 "non-Bash tool_name: silent" \
  '{"tool_name":"Read","tool_input":{"file_path":"x"}}' "$CRASH_IF_CALLED"

# ── gh missing entirely (no PATH match): degrades to silence, never crashes ─
assert_exit 0 "gh not on PATH: degrades to silence, does not crash" \
  "$(bash_tool_json 'gh pr merge 693 --squash')" "$(make_missing_gh_path)"

# ── gh exits non-zero (auth/network failure): silent, never crashes ────────
GHDIR_FAIL="$TMP/fakebin-fail"
mkdir -p "$GHDIR_FAIL"
cat > "$GHDIR_FAIL/gh" <<'EOF'
#!/usr/bin/env bash
echo "error: not authenticated" >&2
exit 1
EOF
chmod +x "$GHDIR_FAIL/gh"
printf '@echo off\r\necho error: not authenticated 1>&2\r\nexit /b 1\r\n' > "$GHDIR_FAIL/gh.cmd"
assert_exit 0 "gh fails (auth/network): silent, does not crash" \
  "$(bash_tool_json 'gh pr merge 693 --squash')" "$GHDIR_FAIL"

# ── Malformed stdin JSON: silent, never crashes ─────────────────────────────
assert_exit 0 "malformed stdin JSON: silent, does not crash" \
  'not json at all' "$CRASH_IF_CALLED"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
