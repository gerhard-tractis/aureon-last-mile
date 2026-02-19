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

# Pull latest code
cd ~/aureon-last-mile
git pull origin main

# Build worker
cd apps/worker
npm ci --production
npm audit --production --audit-level=moderate || echo "WARN: npm audit issues found — review before next deploy"
npm run build

# Restart worker service
sudo systemctl restart aureon-worker
sleep 5

# Health checks
if ! sudo systemctl is-active --quiet aureon-worker; then
  echo "ERROR: aureon-worker failed to start after restart"
  echo "  Debug: sudo journalctl -u aureon-worker -n 50"
  exit 1
fi
echo "aureon-worker: ACTIVE"

# n8n check (non-fatal — n8n managed separately)
if curl -sf http://localhost:5678/healthz > /dev/null 2>&1; then
  echo "n8n: HEALTHY"
else
  echo "WARN: n8n health check failed — check n8n service separately"
fi

echo "=== Deploy SUCCESS === $(date)"
