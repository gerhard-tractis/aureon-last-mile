#!/bin/bash
# =============================================================================
# Aureon Last Mile — Agents Deployment Script
# Called by: GitHub Actions deploy-agents job (or manually on VPS)
# Run as: aureon user
# =============================================================================
set -euo pipefail
trap 'echo "DEPLOY FAILED at line $LINENO"; exit 1' ERR

echo "=== Aureon Agents Deploy === $(date)"

# Pre-check: disk usage must be under 90%
DISK_USAGE=$(df -h / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
if [[ "$DISK_USAGE" -gt 90 ]]; then
  echo "ERROR: Disk usage at ${DISK_USAGE}% — aborting deploy. Free disk space first."
  echo "  Run: journalctl --vacuum-size=500M"
  exit 1
fi
echo "Disk usage: ${DISK_USAGE}% — OK"

cd ~/aureon-last-mile

cd apps/agents

# Snapshot current dist for rollback
if [[ -d dist ]]; then
  cp -r dist dist.bak
fi

# Clear node_modules before install — avoids permission errors from any
# root-owned files left by prior manual installs (renaming works even
# when files inside are root-owned, because we own the parent directory)
if [[ -d node_modules ]]; then
  mv node_modules "/tmp/agents-nm-$(date +%s)" 2>/dev/null || true
fi

npm ci --no-workspaces
npm audit --omit=dev --audit-level=moderate --no-workspaces || echo "WARN: npm audit issues found — review before next deploy"
PATH="$PWD/node_modules/.bin:$PATH" npm run build
npm prune --omit=dev --no-workspaces

# Install systemd service on first deploy
if ! systemctl is-enabled aureon-agents &>/dev/null; then
  echo "Installing aureon-agents systemd service..."
  sudo cp deploy/aureon-agents.service /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable aureon-agents
fi

sudo systemctl restart aureon-agents
sleep 3

AGENTS_STATE=$(systemctl is-active aureon-agents 2>/dev/null || true)
if [[ "$AGENTS_STATE" == "failed" ]]; then
  echo "ERROR: aureon-agents is in failed state"
  echo "  Debug: sudo journalctl -u aureon-agents -n 50"
  if [[ -d dist.bak ]]; then
    echo "Rolling back to previous dist..."
    rm -rf dist && mv dist.bak dist
    sudo systemctl restart aureon-agents
    sleep 3
    echo "Rollback complete — previous version restored"
  fi
  exit 1
fi
echo "aureon-agents: ${AGENTS_STATE}"

rm -rf dist.bak 2>/dev/null || true

echo "=== Deploy SUCCESS === $(date)"
