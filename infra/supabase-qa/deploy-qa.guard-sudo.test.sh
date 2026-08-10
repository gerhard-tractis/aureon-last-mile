#!/usr/bin/env bash
#
# Tests for guard_sudo() in deploy-qa.sh (spec-51).
#
# The QA deploy used to build for five minutes and then die on
# "sudo: a password is required". guard_sudo checks first. These tests stub
# `sudo` so the behaviour is verifiable without a VPS.
#
# Run: bash infra/supabase-qa/deploy-qa.guard-sudo.test.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT

pass=0
fail=0

check() { # $1 name, $2 expected exit, $3 actual exit
  if [ "$2" -eq "$3" ]; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1 — expected exit $2, got $3"
  fi
}

# Install a `sudo` stub that permits exactly the units named in $ALLOWED_UNITS.
make_sudo_stub() {
  cat > "$STUB_DIR/sudo" <<'STUB'
#!/usr/bin/env bash
# Emulates: sudo -n -l systemctl restart <unit>
args=("$@")
unit=""
for ((i = 0; i < ${#args[@]}; i++)); do
  if [ "${args[$i]}" = "restart" ]; then unit="${args[$((i + 1))]}"; fi
done
for allowed in $ALLOWED_UNITS; do
  if [ "$allowed" = "$unit" ]; then exit 0; fi
done
exit 1
STUB
  chmod +x "$STUB_DIR/sudo"
}

make_sudo_stub
export PATH="$STUB_DIR:$PATH"

# Source the functions without running main(). deploy-qa.sh guards on
# BASH_SOURCE, and its top-level guards need these to be set.
# shellcheck disable=SC1090
source_guard_sudo() {
  # Extract just guard_sudo so sourcing cannot trigger the script's own setup.
  sed -n '/^guard_sudo() {/,/^}/p' "$HERE/deploy-qa.sh" > "$STUB_DIR/guard_sudo.sh"
  # shellcheck disable=SC1091
  . "$STUB_DIR/guard_sudo.sh"
}
source_guard_sudo

echo "guard_sudo()"

# ── All units permitted ─────────────────────────────────────────────────────
ALLOWED_UNITS="aureon-frontend-qa aureon-agents-qa aureon-worker-qa"
export ALLOWED_UNITS
guard_sudo aureon-frontend-qa >/dev/null 2>&1
check "passes when the unit is permitted" 0 $?

guard_sudo aureon-frontend-qa aureon-agents-qa aureon-worker-qa >/dev/null 2>&1
check "passes when every unit is permitted" 0 $?

# ── The real-world state before the sudoers fix ─────────────────────────────
ALLOWED_UNITS="aureon-worker aureon-agents"   # prod units only
export ALLOWED_UNITS
guard_sudo aureon-frontend-qa >/dev/null 2>&1
check "fails when only the prod units are permitted" 1 $?

# ── Partial coverage still fails ────────────────────────────────────────────
ALLOWED_UNITS="aureon-frontend-qa"
export ALLOWED_UNITS
guard_sudo aureon-frontend-qa aureon-agents-qa >/dev/null 2>&1
check "fails when only some QA units are permitted" 1 $?

# ── The message must carry the remediation, not just the failure ────────────
ALLOWED_UNITS=""
export ALLOWED_UNITS
output="$(guard_sudo aureon-frontend-qa 2>&1)"
if printf '%s' "$output" | grep -q "visudo" &&
   printf '%s' "$output" | grep -q "aureon-frontend-qa" &&
   printf '%s' "$output" | grep -q "qa-environment.md"; then
  pass=$((pass + 1)); echo "  ok   error names the unit and the fix"
else
  fail=$((fail + 1)); echo "  FAIL error should name the unit, visudo, and the runbook"
  printf '%s\n' "$output" | sed 's/^/         /'
fi

# ── No units to restart -> nothing to check ─────────────────────────────────
guard_sudo >/dev/null 2>&1
check "passes when given no units" 0 $?

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
