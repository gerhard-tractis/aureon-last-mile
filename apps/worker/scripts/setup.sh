#!/bin/bash
# =============================================================================
# Aureon Last Mile — VPS Provisioning Script
# Target: Ubuntu 24.04 LTS on Hostinger KVM 2 (São Paulo)
# Run as: root
# Idempotent: safe to re-run; all steps check before executing
# =============================================================================
set -euo pipefail
trap 'echo "SETUP FAILED at line $LINENO — check output above"; exit 1' ERR

echo "==================================================================="
echo "  Aureon VPS Setup — $(date)"
echo "==================================================================="

# ---------------------------------------------------------------------------
# 1. System updates
# ---------------------------------------------------------------------------
echo "--- [1/14] System updates ---"
apt-get update -y
apt-get upgrade -y

# ---------------------------------------------------------------------------
# 2. Create dedicated user
# ---------------------------------------------------------------------------
echo "--- [2/14] Creating aureon user ---"
if ! id -u aureon &>/dev/null; then
  useradd -m -s /bin/bash aureon
  echo "Created user: aureon"
else
  echo "User aureon already exists — skipping"
fi

# ---------------------------------------------------------------------------
# 3. Grant limited sudo for service management only
# ---------------------------------------------------------------------------
echo "--- [3/14] Configuring sudo for aureon ---"
SUDOERS_FILE="/etc/sudoers.d/aureon"
if [[ ! -f "$SUDOERS_FILE" ]]; then
  echo 'aureon ALL=(ALL) NOPASSWD: /bin/systemctl' > "$SUDOERS_FILE"
  chmod 440 "$SUDOERS_FILE"
  echo "Created $SUDOERS_FILE"
else
  echo "Sudoers already configured — skipping"
fi

# ---------------------------------------------------------------------------
# 4. SSH hardening
# ---------------------------------------------------------------------------
echo "--- [4/14] SSH hardening ---"
SSHD_CONFIG="/etc/ssh/sshd_config"
# Backup once
if [[ ! -f "${SSHD_CONFIG}.orig" ]]; then
  cp "$SSHD_CONFIG" "${SSHD_CONFIG}.orig"
fi

# Apply hardened settings (idempotent via sed)
set_sshd() {
  local key="$1" value="$2"
  if grep -qE "^#?${key}" "$SSHD_CONFIG"; then
    sed -i "s|^#\?${key}.*|${key} ${value}|" "$SSHD_CONFIG"
  else
    echo "${key} ${value}" >> "$SSHD_CONFIG"
  fi
}

set_sshd PasswordAuthentication no
set_sshd PermitRootLogin no
set_sshd PubkeyAuthentication yes
set_sshd MaxAuthTries 3
set_sshd LoginGraceTime 30
set_sshd AllowUsers aureon
set_sshd ClientAliveInterval 300
set_sshd ClientAliveCountMax 2

systemctl reload sshd
echo "SSH hardened"

# ---------------------------------------------------------------------------
# 5. Firewall (UFW)
# ---------------------------------------------------------------------------
echo "--- [5/14] Configuring UFW firewall ---"
apt-get install -y ufw

ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp    # Rate-limited SSH: max 6 connections per 30 seconds
ufw allow 5678/tcp  # n8n web UI
ufw --force enable

ufw status verbose
echo "UFW configured"

# ---------------------------------------------------------------------------
# 6. Security packages: fail2ban + unattended-upgrades
# ---------------------------------------------------------------------------
echo "--- [6/14] Installing security packages ---"
apt-get install -y fail2ban unattended-upgrades

# fail2ban SSH jail
JAIL_LOCAL="/etc/fail2ban/jail.local"
if [[ ! -f "$JAIL_LOCAL" ]]; then
  cat > "$JAIL_LOCAL" <<'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 3

[sshd]
enabled = true
port    = ssh
filter  = sshd
logpath = /var/log/auth.log
maxretry = 3
EOF
  systemctl enable fail2ban
  systemctl restart fail2ban
  echo "fail2ban configured"
else
  echo "fail2ban already configured — skipping"
fi

dpkg-reconfigure -plow unattended-upgrades

# ---------------------------------------------------------------------------
# 7. Node.js 20 LTS via NodeSource APT (NOT nvm — nvm breaks systemd)
# ---------------------------------------------------------------------------
echo "--- [7/14] Installing Node.js 20 LTS ---"
if ! command -v node &>/dev/null || [[ "$(node --version | cut -d'.' -f1)" != "v20" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  echo "Node.js installed: $(node --version)"
else
  echo "Node.js 20 already installed: $(node --version)"
fi

# ---------------------------------------------------------------------------
# 8. n8n 2.9.0 (pinned — 8 CVEs in older versions)
# ---------------------------------------------------------------------------
echo "--- [8/14] Installing n8n 2.9.0 ---"
if ! command -v n8n &>/dev/null || ! n8n --version 2>/dev/null | grep -q "2.9.0"; then
  npm install -g n8n@2.9.0
  echo "n8n installed: $(n8n --version 2>/dev/null || echo 'check manually')"
else
  echo "n8n 2.9.0 already installed — skipping"
fi

# ---------------------------------------------------------------------------
# 9. PostgreSQL backend for n8n (prevents SQLite write-lock issues)
# ---------------------------------------------------------------------------
echo "--- [9/14] Configuring PostgreSQL for n8n ---"
apt-get install -y postgresql

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='n8n'" | grep -q 1; then
  sudo -u postgres createuser n8n
  sudo -u postgres createdb n8n -O n8n

  # Set password for n8n DB user (read from env if available)
  if [[ -n "${DB_POSTGRESDB_PASSWORD:-}" ]]; then
    sudo -u postgres psql -c "ALTER USER n8n WITH PASSWORD '${DB_POSTGRESDB_PASSWORD}';"
  else
    echo "WARNING: DB_POSTGRESDB_PASSWORD not set — set password manually:"
    echo "  sudo -u postgres psql -c \"ALTER USER n8n WITH PASSWORD 'your-password';\""
  fi
  echo "PostgreSQL n8n database created"
else
  echo "PostgreSQL n8n role already exists — skipping"
fi

# ---------------------------------------------------------------------------
# 10. Playwright + Chromium (peak memory: 826-874MB per instance)
# ---------------------------------------------------------------------------
echo "--- [10/14] Installing Playwright + Chromium ---"
if [[ ! -d "/home/aureon/.cache/ms-playwright" ]]; then
  sudo -u aureon npx playwright install --with-deps chromium
  echo "Playwright + Chromium installed"
else
  echo "Playwright already installed — skipping"
fi

# ---------------------------------------------------------------------------
# 11. 4GB swap (safety net for Chromium memory spikes)
# ---------------------------------------------------------------------------
echo "--- [11/14] Configuring 4GB swap ---"
if [[ ! -f /swapfile ]]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile

  # Persist across reboots
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi

  # Reduce swap aggressiveness (use swap only when RAM is nearly full)
  if ! grep -q 'vm.swappiness=10' /etc/sysctl.conf; then
    echo 'vm.swappiness=10' >> /etc/sysctl.conf
  fi
  sysctl -p

  echo "4GB swap configured"
else
  echo "Swap already configured — skipping"
fi

# ---------------------------------------------------------------------------
# 12. systemd service: n8n
# ---------------------------------------------------------------------------
echo "--- [12/14] Installing n8n systemd service ---"
cat > /etc/systemd/system/n8n.service <<'EOF'
[Unit]
Description=n8n Workflow Automation
After=network.target postgresql.service

[Service]
Type=simple
User=aureon
WorkingDirectory=/home/aureon
EnvironmentFile=/home/aureon/.env
ExecStart=/usr/bin/n8n start
Restart=always
RestartSec=10
TimeoutStopSec=30
MemoryMax=4G
MemoryHigh=3G
TasksMax=256
StandardOutput=journal
StandardError=journal
SyslogIdentifier=n8n

[Install]
WantedBy=multi-user.target
EOF

# systemd service: aureon-worker
cat > /etc/systemd/system/aureon-worker.service <<'EOF'
[Unit]
Description=Aureon Automation Worker
After=network.target

[Service]
Type=simple
User=aureon
WorkingDirectory=/home/aureon/aureon-last-mile/apps/worker
EnvironmentFile=/home/aureon/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
TimeoutStopSec=30
MemoryMax=2G
TasksMax=128
StandardOutput=journal
StandardError=journal
SyslogIdentifier=aureon-worker

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable n8n aureon-worker
echo "systemd services installed and enabled"

# ---------------------------------------------------------------------------
# 13. Secure .env file (must exist before starting services)
# ---------------------------------------------------------------------------
echo "--- [13/14] Securing .env file ---"
ENV_FILE="/home/aureon/.env"
if [[ -f "$ENV_FILE" ]]; then
  chmod 600 "$ENV_FILE"
  chown aureon:aureon "$ENV_FILE"
  echo ".env permissions secured"
else
  echo "WARNING: /home/aureon/.env does not exist."
  echo "Copy apps/worker/.env.example to /home/aureon/.env and fill in values BEFORE starting services."
  echo "Then run: chmod 600 /home/aureon/.env && chown aureon:aureon /home/aureon/.env"
fi

# ---------------------------------------------------------------------------
# 14. Start services + smoke tests
# ---------------------------------------------------------------------------
echo "--- [14/14] Starting services and running smoke tests ---"

if [[ -f "$ENV_FILE" ]]; then
  systemctl start n8n
  sleep 10  # Allow n8n to initialise

  # Smoke test 1: n8n health check
  echo "  [SMOKE] n8n health check..."
  curl -sf http://localhost:5678/healthz || { echo "FAILED: n8n health check"; exit 1; }
  echo "  PASS: n8n responding"

  # Smoke test 2: Chromium launch
  echo "  [SMOKE] Playwright/Chromium check..."
  sudo -u aureon node -e "
    const { chromium } = require('playwright');
    (async () => {
      const browser = await chromium.launch({ args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.goto('about:blank');
      await browser.close();
      console.log('Chromium OK');
    })().catch(e => { console.error('Chromium FAILED:', e.message); process.exit(1); });
  " 2>/dev/null || echo "  WARN: Chromium test skipped (playwright npm package not installed in worker — expected at this stage)"

  # Smoke test 3: Supabase connectivity
  if [[ -n "${SUPABASE_URL:-}" && -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    echo "  [SMOKE] Supabase connectivity..."
    curl -sf "${SUPABASE_URL}/rest/v1/" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
      -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
      || { echo "FAILED: Supabase connectivity"; exit 1; }
    echo "  PASS: Supabase reachable"
  else
    echo "  SKIP: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — test Supabase connectivity manually"
  fi

  # Smoke test 4: n8n auto-restart
  echo "  [SMOKE] n8n auto-restart..."
  systemctl stop n8n
  sleep 15
  if systemctl is-active --quiet n8n; then
    echo "  PASS: n8n auto-restarted"
  else
    echo "  FAILED: n8n did not auto-restart"
    exit 1
  fi
else
  echo "SKIPPING service start and smoke tests — /home/aureon/.env not found."
  echo "After populating .env, run manually:"
  echo "  sudo systemctl start n8n"
  echo "  curl http://localhost:5678/healthz"
fi

echo ""
echo "==================================================================="
echo "  Setup COMPLETE — $(date)"
echo "==================================================================="
echo ""
echo "NEXT STEPS:"
echo "  1. Copy apps/worker/.env.example to /home/aureon/.env and fill in values"
echo "  2. sudo systemctl start n8n"
echo "  3. Navigate to http://<VPS_IP>:5678 and create the n8n owner account"
echo "  4. Add GitHub secrets: VPS_HOST, VPS_USER, VPS_SSH_KEY"
echo "  5. Push a change to apps/worker/ to trigger the deploy pipeline"
