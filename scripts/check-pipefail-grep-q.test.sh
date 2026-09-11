#!/usr/bin/env bash
# Tests de scripts/check-pipefail-grep-q.sh
#
# Corre el guard real contra ficheros de prueba desechables, nunca contra el
# repo entero — así una nueva instancia legítima en otro fichero no rompe
# esta suite, y una regresión real (reintroducir uno de los cinco patrones
# que motivaron el guard) sí lo hace.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
S="$HERE/check-pipefail-grep-q.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0

check_true() { # $1 name, $2 exit code
  if [ "$2" -eq 0 ]; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1 (exit $2)"
  fi
}

check_false() { # $1 name, $2 exit code
  if [ "$2" -ne 0 ]; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1 (expected nonzero, got 0)"
  fi
}

echo "check-pipefail-grep-q.sh"

# ── A clean file passes ─────────────────────────────────────────────────
cat > "$TMP/clean.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ $changed =~ ^apps/frontend/ ]]; then echo true; fi
grep -c foo somefile || true
EOF
bash "$S" "$TMP/clean.sh" >/dev/null 2>&1
check_true "a file with no | grep -q passes" $?

# ── The five real-world shapes, each on its own throwaway fixture ────────
cat > "$TMP/plain_q.sh" <<'EOF'
if printf '%s' "$x" | grep -q "foo"; then echo true; fi
EOF
bash "$S" "$TMP/plain_q.sh" >/dev/null 2>&1
check_false "catches | grep -q (plain)" $?

cat > "$TMP/qE.sh" <<'EOF'
printf '%s' "$x" | grep -qE "not ok [0-9]" && echo true
EOF
bash "$S" "$TMP/qE.sh" >/dev/null 2>&1
check_false "catches | grep -qE" $?

cat > "$TMP/Eq.sh" <<'EOF'
printf '%s\n' "$busy" | grep -Eq "[:.]${port}\$" || continue
EOF
bash "$S" "$TMP/Eq.sh" >/dev/null 2>&1
check_false "catches | grep -Eq (flag order swapped — setup-qa.sh's real shape)" $?

cat > "$TMP/qv.sh" <<'EOF'
grep -- ' -f ' "$calls" | grep -qv -- '-v ON_ERROR_STOP=1'
EOF
bash "$S" "$TMP/qv.sh" >/dev/null 2>&1
check_false "catches | grep -qv" $?

cat > "$TMP/deploy_yml_shape.sh" <<'EOF'
matches() { echo "$CHANGED" | grep -qE "$1" && echo true || echo false; }
EOF
bash "$S" "$TMP/deploy_yml_shape.sh" >/dev/null 2>&1
check_false "catches deploy.yml's matches() shape" $?

# ── M1 (round 6): three evasions a reviewer found within minutes of
#    reading round 5's guard, the first of which is the shape anyone
#    would type IMMEDIATELY after reading this guard's OWN error message
#    ("use -qE, -Eq, ...") and reasonably guessing flags can be separate
#    tokens too ──────────────────────────────────────────────────────────
cat > "$TMP/separate_flags.sh" <<'EOF'
if printf '%s' "$x" | grep -E -q "foo"; then echo true; fi
EOF
bash "$S" "$TMP/separate_flags.sh" >/dev/null 2>&1
check_false "M1: catches | grep -E -q (flags as separate tokens)" $?

cat > "$TMP/separate_flags_reversed.sh" <<'EOF'
if printf '%s' "$x" | grep -q -E "foo"; then echo true; fi
EOF
bash "$S" "$TMP/separate_flags_reversed.sh" >/dev/null 2>&1
check_false "M1: catches | grep -q -E (separate tokens, -q first)" $?

cat > "$TMP/egrep.sh" <<'EOF'
if printf '%s' "$x" | egrep -q "foo"; then echo true; fi
EOF
bash "$S" "$TMP/egrep.sh" >/dev/null 2>&1
check_false "M1: catches | egrep -q" $?

cat > "$TMP/fgrep.sh" <<'EOF'
if printf '%s' "$x" | fgrep -q "foo"; then echo true; fi
EOF
bash "$S" "$TMP/fgrep.sh" >/dev/null 2>&1
check_false "M1: catches | fgrep -q" $?

cat > "$TMP/trailing_pipe_continuation.sh" <<'EOF'
printf '%s' "$x" |
  grep -q "foo"
EOF
bash "$S" "$TMP/trailing_pipe_continuation.sh" >/dev/null 2>&1
check_false "M1: catches a trailing pipe at EOL with grep -q on the next line" $?

# A grep-family command with NO -q anywhere must still pass — the
# tokenizer must not over-match just because "grep" follows a pipe.
cat > "$TMP/pipe_no_q.sh" <<'EOF'
printf '%s' "$x" | grep -E "foo"
EOF
bash "$S" "$TMP/pipe_no_q.sh" >/dev/null 2>&1
check_true "M1: | grep -E with no -q anywhere still passes" $?

# ── A1 (round 7): a pipe with NO space before `grep` was a real regression
#    from round 5's regex (`\|\s*grep`, where \s* admits zero spaces) to
#    round 6's tokenizer (`words=($line)`, which glues "|grep" into ONE
#    word since there is no whitespace to split on). This is the shorthand
#    most people actually type ─────────────────────────────────────────────
cat > "$TMP/pipe_no_space_before.sh" <<'EOF'
printf '%s' "$x"|grep -q "foo"
EOF
bash "$S" "$TMP/pipe_no_space_before.sh" >/dev/null 2>&1
check_false "A1: catches |grep -q with no space before grep" $?

cat > "$TMP/pipe_no_space_mixed.sh" <<'EOF'
printf '%s' "$x" |grep -q "foo"
EOF
bash "$S" "$TMP/pipe_no_space_mixed.sh" >/dev/null 2>&1
check_false "A1: catches a space-then-pipe-then-no-space-grep" $?

# ── A .yml file (workflow run: blocks) is scanned the same way ───────────
cat > "$TMP/workflow.yml" <<'EOF'
jobs:
  x:
    steps:
      - run: |
          echo "$CHANGED" | grep -qE "$1"
EOF
bash "$S" "$TMP/workflow.yml" >/dev/null 2>&1
check_false "catches the pattern inside a .yml run: block" $?

# ── A comment describing the bug in prose must NOT be flagged — this
#    guard's own header, and every code comment written while fixing B2,
#    would otherwise be a permanent false positive ───────────────────────
cat > "$TMP/comment_only.sh" <<'EOF'
#!/usr/bin/env bash
# was `printf '%s' "$out" | grep -qE "$re"` — fixed below
if [[ $out =~ $re ]]; then echo true; fi
EOF
bash "$S" "$TMP/comment_only.sh" >/dev/null 2>&1
check_true "a comment-only mention of the pattern is not flagged" $?

# ── The escape hatch: a line marked pipefail-safe is skipped, with its
#    reason required right on the line ───────────────────────────────────
cat > "$TMP/whitelisted.sh" <<'EOF'
printf '%s' "$x" | grep -q "foo"  # pipefail-safe: $x is a 3-line hardcoded string
EOF
bash "$S" "$TMP/whitelisted.sh" >/dev/null 2>&1
check_true "a line marked # pipefail-safe: <reason> is skipped" $?

# ── M2 (round 6): the marker must be THIS line's own TRAILING comment, not
#    a substring anywhere — e.g. embedded inside the pattern being grepped
#    for. Before this fix, `grep -q '# pipefail-safe: x'` (grepping FOR the
#    literal marker string, never having actually justified anything)
#    would have skipped itself ─────────────────────────────────────────────
cat > "$TMP/marker_as_substring.sh" <<'EOF'
printf '%s' "$x" | grep -q '# pipefail-safe: x'
EOF
bash "$S" "$TMP/marker_as_substring.sh" >/dev/null 2>&1
check_false "M2: the marker string used as a grep PATTERN (not a real trailing comment) is still caught" $?

# ── A2 (round 7): round 6's trailing_comment() fix worked only because that
#    fixture's `#` was glued directly to the opening quote (prev char was
#    `'`, not whitespace). A single SPACE inside the quotes before the `#`
#    (`'... `# pipefail-safe: x'`, entirely plausible grep-pattern prose)
#    makes `prev` a space and the old heuristic — "preceded by whitespace
#    = real comment" — wrongly treats it as a genuine trailing comment,
#    with nothing outside the quotes ever having justified anything ──────
cat > "$TMP/marker_as_substring_with_space.sh" <<'EOF'
printf '%s' "$x" | grep -q ' # pipefail-safe: x'
EOF
bash "$S" "$TMP/marker_as_substring_with_space.sh" >/dev/null 2>&1
check_false "A2: a marker inside quotes, with a space before the #, is still caught" $?

# Quote-awareness must not create new false positives: a real trailing
# comment AFTER a quoted string containing a "#" must still be honored.
cat > "$TMP/real_marker_after_quoted_hash.sh" <<'EOF'
printf '%s' "$x" | grep -q "value#tag"  # pipefail-safe: x is a 2-line hardcoded string containing a hash-tag character
EOF
bash "$S" "$TMP/real_marker_after_quoted_hash.sh" >/dev/null 2>&1
check_true "A2: a real trailing marker after a quoted # is still honored" $?

# The guard's whitelist mechanism deliberately does not (and cannot)
# validate PROSE quality — "because I said so" mechanically parses as a
# valid trailing marker. What it DOES enforce structurally: the marker
# must trail a real comment on the SAME executable line, which the
# marker-as-substring case above proves. Prose review is a human code-
# review responsibility (round 6, M2) — this suite pins the structural
# contract, not the English.
cat > "$TMP/whitelist_low_effort_reason.sh" <<'EOF'
printf '%s' "$x" | grep -q "foo"  # pipefail-safe: because I said so
EOF
bash "$S" "$TMP/whitelist_low_effort_reason.sh" >/dev/null 2>&1
check_true "M2: the marker mechanism accepts any trailing reason text — prose quality is a review responsibility, not this script's" $?

# ── The default (no-args) file set actually includes both target dirs —
#    proven by running from a throwaway repo root with fixtures in place,
#    not by trusting the glob to be correct ──────────────────────────────
DEFROOT="$TMP/defaultscan"
mkdir -p "$DEFROOT/infra/supabase-qa" "$DEFROOT/.github/workflows"
cp "$TMP/plain_q.sh" "$DEFROOT/infra/supabase-qa/some-script.sh"
cp "$TMP/workflow.yml" "$DEFROOT/.github/workflows/some-workflow.yml"
( cd "$DEFROOT" && bash "$S" >/dev/null 2>&1 )
check_false "default (no-args) scan reaches both infra/supabase-qa/*.sh and .github/workflows/*.yml" $?

# ── Mutation evidence: reintroduce ONE of the five real instances this
#    guard exists to prevent (widen()'s exact pre-fix line from deploy-
#    qa.sh) into a throwaway copy, and confirm the guard catches it; then
#    confirm the ACTUAL fixed line in the real deploy-qa.sh passes ───────
cat > "$TMP/widen_before_fix.sh" <<'EOF'
widen() {
  if [ "$1" = true ]; then echo true
  elif printf '%s\n' "$changed" | grep -qE "$2"; then echo true
  else echo false
  fi
}
EOF
bash "$S" "$TMP/widen_before_fix.sh" >/dev/null 2>&1
check_false "mutation: the real pre-fix widen() line is caught" $?

REPO_ROOT="$(cd "$HERE/.." && pwd)"
bash "$S" "$REPO_ROOT/infra/supabase-qa/deploy-qa.sh" >/dev/null 2>&1
check_true "the real, fixed deploy-qa.sh passes today" $?

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
