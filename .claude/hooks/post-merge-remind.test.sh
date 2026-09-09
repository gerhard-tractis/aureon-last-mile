#!/usr/bin/env bash
#
# Tests for post-merge-remind.sh (spec-91 fase 1, ronda 2) — PostToolUse
# hook that shortcuts the manual `gh pr merge` path with a reminder to close
# the phase token. Runs against a FAKE `gh` on PATH, never the real network.
#
# Ronda 2 (review adversarial): this hook is no longer the guarantee (that's
# spec-91 fase 5, server-side reconciliation) — it's a zero-latency shortcut
# for a synchronous `gh pr merge` that actually merges right away. Three
# bugs closed here:
#
#   B2 — the PR number can appear AFTER the flags
#        (`gh pr merge --auto --squash 693`); every token in the merge
#        segment is scanned, not just the first.
#   B3 — a command that only MENTIONS "gh pr merge" (a grep, a commit
#        message) must not trigger. The command is split on shell separators
#        (&&, ||, ;, |) and a SEGMENT must literally start with
#        `gh pr merge` — a grep's only segment is the grep invocation
#        itself, which doesn't start that way.
#   M1 — the bash-level pre-filter (this .sh, not the .mjs) so node's
#        startup cost isn't paid on every single Bash call.
#
# Run: bash .claude/hooks/post-merge-remind.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/post-merge-remind.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

NODE_DIR="$(dirname "$(command -v node)")"
BASH_DIR="$(dirname "$(command -v bash)")"

# Writes BOTH a POSIX shebang script (`gh`, Linux CI) and a Windows batch
# file (`gh.cmd`, native-Windows `node`) with the same behavior.
# execSync goes through the OS shell, which resolves PATHEXT correctly on
# both — but only when `gh.cmd` actually EXISTS to be found; on POSIX the
# `.cmd` file is just inert.
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

# Bloqueante 2: a fake `gh` that actually LOOKS at its argv, so the test can
# tell "queried the right PR" apart from "fell back to the current branch's
# PR because the number wasn't found in the command". A fake that ignores
# its arguments (like make_fake_gh above) can't catch this class of bug —
# it answers the same regardless of what was asked, which is exactly why
# the first version of this test didn't catch the mutation it was meant to.
make_arg_sensitive_fake_gh() { # $1 = expected PR number, $2 = correct response, $3 = wrong-branch response
  local dir="$TMP/fakebin-argsense-$RANDOM"
  mkdir -p "$dir"
  cat > "$dir/gh" <<EOF
#!/usr/bin/env bash
for a in "\$@"; do
  if [ "\$a" = "$1" ]; then echo '$2'; exit 0; fi
done
echo '$3'
exit 0
EOF
  chmod +x "$dir/gh"
  # No `findstr` here on purpose: the test deliberately restricts PATH to
  # just this fake dir + node's + bash's, which excludes System32 — the
  # classic cmd substring trick (replace, compare) needs no external tool.
  cat > "$dir/gh.cmd" <<EOF
@echo off
setlocal
set "ARGS=%*"
if not "%ARGS:$1=%"=="%ARGS%" (echo $2) else (echo $3)
exit /b 0
EOF
  printf '%s' "$dir"
}

CRASH_IF_CALLED="$TMP/fakebin-crash"
mkdir -p "$CRASH_IF_CALLED"
cat > "$CRASH_IF_CALLED/gh" <<'EOF'
#!/usr/bin/env bash
exit 99
EOF
chmod +x "$CRASH_IF_CALLED/gh"
printf '@echo off\r\nexit /b 99\r\n' > "$CRASH_IF_CALLED/gh.cmd"

run_hook() { # $1 = json stdin, $2 = fake gh bin dir
  local stdin_json="$1" ghdir="$2"
  printf '%s' "$stdin_json" | PATH="$ghdir:$NODE_DIR:$BASH_DIR" bash "$HOOK"
}

assert_exit() {
  local expected="$1" name="$2" stdin_json="$3" ghdir="$4"
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
  local needle="$1" name="$2" stdin_json="$3" ghdir="$4"
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

bash_tool_json() { # $1 = command
  node -e '
    process.stdout.write(JSON.stringify({ tool_name: "Bash", tool_input: { command: process.argv[1] } }));
  ' "$1"
}

MERGED_WITH_SPEC='{"number":693,"headRefName":"feat/spec-80-fase-2-bloqueo-faltantes","state":"MERGED","mergedAt":"2026-09-08T10:00:00Z"}'
MERGED_NO_SPEC='{"number":700,"headRefName":"chore/bump-deps","state":"MERGED","mergedAt":"2026-09-08T10:00:00Z"}'
NOT_MERGED='{"number":701,"headRefName":"feat/spec-90-fase-1-x","state":"OPEN","mergedAt":null}'

# ── A synchronous merge (no --auto), number right after `merge`: reminds ──
GHDIR="$(make_fake_gh "$MERGED_WITH_SPEC")"
assert_exit 2 "gh pr merge 693 --squash (merged, spec+fase in branch): reminds (exit 2)" \
  "$(bash_tool_json 'gh pr merge 693 --squash')" "$GHDIR"

assert_stderr_contains "spec-80" "reminder names the spec" \
  "$(bash_tool_json 'gh pr merge 693 --squash')" "$GHDIR"

assert_stderr_contains "fase 2" "reminder names the phase hint from the branch name" \
  "$(bash_tool_json 'gh pr merge 693 --squash')" "$GHDIR"

# ── Bloqueante 2, closed: the number AFTER the flags — the exact shape
# CLAUDE.md's own mandated command uses (`gh pr merge --auto --squash`,
# with a positional PR number appended by whoever runs it manually). Uses
# an ARG-SENSITIVE fake `gh`: if extractPrArg regresses to only checking
# the token right after `merge`, it finds nothing, falls back to no `-N`
# argument at all, and this fake answers with the WRONG-branch response
# (no spec in its name) instead of the PR-693 one — turning a silent wrong
# answer into a loud, catchable exit-code difference.
WRONG_BRANCH_RESP='{"number":42,"headRefName":"main","state":"MERGED","mergedAt":"2026-09-08T09:00:00Z"}'
GHDIR_ARGSENSE="$(make_arg_sensitive_fake_gh 693 "$MERGED_WITH_SPEC" "$WRONG_BRANCH_RESP")"
assert_exit 2 "Bloqueante 2: gh pr merge --auto --squash 693 (number AFTER flags): queries PR 693, not the fallback" \
  "$(bash_tool_json 'gh pr merge --auto --squash 693')" "$GHDIR_ARGSENSE"

assert_stderr_contains "spec-80" "Bloqueante 2: reminder reflects PR 693's real branch, not the wrong-branch fallback" \
  "$(bash_tool_json 'gh pr merge --auto --squash 693')" "$GHDIR_ARGSENSE"

# ── A merged PR whose branch names no spec: silent ─────────────────────────
GHDIR2="$(make_fake_gh "$MERGED_NO_SPEC")"
assert_exit 0 "gh pr merge (merged, no spec in branch): silent (exit 0)" \
  "$(bash_tool_json 'gh pr merge 700 --squash')" "$GHDIR2"

# ── gh pr merge that did NOT actually merge (queued --auto, still OPEN) ────
GHDIR3="$(make_fake_gh "$NOT_MERGED")"
assert_exit 0 "gh pr merge --auto --squash (queued, PR still OPEN): silent (exit 0)" \
  "$(bash_tool_json 'gh pr merge --auto --squash 701')" "$GHDIR3"

# ── Bloqueante 3, closed: a command that only MENTIONS the pattern — a
# grep, a commit message — must not trigger. Deliberately uses GHDIR (a
# `gh` that WOULD happily answer "MERGED, spec-80" if actually invoked),
# not a `gh` that always fails — a fake that only ever fails can't
# distinguish "never called" from "called and errored", since both paths
# degrade to the same silent exit 0. Asserting exit 0 against a `gh` that
# would answer "yes, reminder-worthy" is the only way to prove the segment
# check actually stopped it from being called at all.
assert_exit 0 "Bloqueante 3: grep for the text 'gh pr merge' — not a real invocation, never calls gh" \
  "$(bash_tool_json 'grep -rn "gh pr merge" .claude/')" "$GHDIR"

assert_exit 0 "Bloqueante 3: commit message mentioning gh pr merge — not a real invocation, never calls gh" \
  "$(bash_tool_json 'git commit -m "gh pr merge era el problema"')" "$GHDIR"

# ── A real merge chained after another command DOES still trigger — only
# the SEGMENT needs to start with `gh pr merge`, not the whole command. ────
assert_exit 2 "a merge command chained after another (only the segment matters): still reminds" \
  "$(bash_tool_json 'echo about to merge && gh pr merge 693 --squash')" "$GHDIR"

# ── Non-Bash tool: silent ───────────────────────────────────────────────────
assert_exit 0 "non-Bash tool_name: silent" \
  '{"tool_name":"Read","tool_input":{"file_path":"x"}}' "$CRASH_IF_CALLED"

# ── gh missing entirely (no PATH match): degrades to silence, never crashes ─
EMPTY_DIR="$TMP/no-gh-here"
mkdir -p "$EMPTY_DIR"
assert_exit 0 "gh not on PATH: degrades to silence, does not crash" \
  "$(bash_tool_json 'gh pr merge 693 --squash')" "$EMPTY_DIR"

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

# ── M2: node missing from PATH degrades to silence, not a noisy 127 ────────
out="$(printf '%s' "$(bash_tool_json 'gh pr merge 693 --squash')" | PATH="$GHDIR:$BASH_DIR" bash "$HOOK" 2>"$TMP/stderr.nonode")"
actual=$?
if [ "$actual" -eq 0 ]; then
  pass=$((pass + 1)); echo "  ok   M2: node missing from PATH degrades to exit 0, not a noisy 127"
else
  fail=$((fail + 1)); echo "  FAIL M2: node missing from PATH: expected exit 0, got $actual"
  sed 's/^/       stderr: /' "$TMP/stderr.nonode"
fi

# ── M1: the bash-level pre-filter must actually skip node for commands
# that can't possibly match. Proven DETERMINISTICALLY via a marker file a
# fake `node` touches when invoked — not by wall-clock timing, which is
# flaky under system load (measured: this exact comparison inverted once
# when run alongside the rest of this repo's test suite in parallel).
NODEMARK_DIR="$TMP/nodemark-$RANDOM"
mkdir -p "$NODEMARK_DIR"
MARKER="$TMP/node-was-invoked"
cat > "$NODEMARK_DIR/node" <<EOF
#!/usr/bin/env bash
touch "$MARKER"
exec "$(command -v node)" "\$@"
EOF
chmod +x "$NODEMARK_DIR/node"

rm -f "$MARKER"
printf '%s' "$(bash_tool_json 'npm test')" | PATH="$NODEMARK_DIR:$BASH_DIR" bash "$HOOK" >/dev/null 2>&1
if [ ! -f "$MARKER" ]; then
  pass=$((pass + 1)); echo "  ok   M1: a non-matching command (no 'gh' substring) never invokes node at all"
else
  fail=$((fail + 1)); echo "  FAIL M1: non-matching command invoked node — pre-filter regressed to 'always invoke node'"
fi

rm -f "$MARKER"
printf '%s' "$(bash_tool_json 'gh pr merge 693 --squash')" | PATH="$GHDIR:$NODEMARK_DIR:$BASH_DIR" bash "$HOOK" >/dev/null 2>&1
if [ -f "$MARKER" ]; then
  pass=$((pass + 1)); echo "  ok   M1: a real gh pr merge command DOES invoke node (the pre-filter isn't over-eager either)"
else
  fail=$((fail + 1)); echo "  FAIL M1: a real gh pr merge command never invoked node — pre-filter is too aggressive"
fi

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
