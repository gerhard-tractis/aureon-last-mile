#!/bin/bash
# =============================================================================
# Aureon Last Mile — Worker Deployment Script
# Called by: GitHub Actions deploy-worker.yml (or manually on VPS)
# Run as: aureon user
# =============================================================================
set -euo pipefail
trap 'echo "DEPLOY FAILED at line $LINENO"; exit 1' ERR

echo "=== Aureon Worker Deploy === $(date)"

# Pre-check: disk usage must be under 90%
DISK_USAGE=$(df -h / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
if [[ "$DISK_USAGE" -gt 90 ]]; then
  echo "ERROR: Disk usage at ${DISK_USAGE}% — aborting deploy. Free disk space first."
  echo "  Run: journalctl --vacuum-size=500M"
  exit 1
fi
echo "Disk usage: ${DISK_USAGE}% — OK"

# Build worker
cd ~/aureon-last-mile/apps/worker
npm ci
npm audit --omit=dev --audit-level=moderate || echo "WARN: npm audit issues found — review before next deploy"
PATH="$PWD/node_modules/.bin:$PATH" npm run build
npm prune --omit=dev

# Restart worker service
sudo systemctl restart aureon-worker || true
sleep 3

# Health check — activating/active = running, inactive = placeholder exited cleanly (ok for now)
WORKER_STATE=$(sudo systemctl is-active aureon-worker 2>/dev/null || true)
if [[ "$WORKER_STATE" == "failed" ]]; then
  echo "ERROR: aureon-worker is in failed state"
  echo "  Debug: sudo journalctl -u aureon-worker -n 50"
  exit 1
fi
echo "aureon-worker: ${WORKER_STATE}"

# n8n check (non-fatal — n8n managed separately)
if curl -sf http://localhost:5678/healthz > /dev/null 2>&1; then
  echo "n8n: HEALTHY"
else
  echo "WARN: n8n health check failed — check n8n service separately"
fi

echo "=== Deploy SUCCESS === $(date)"
