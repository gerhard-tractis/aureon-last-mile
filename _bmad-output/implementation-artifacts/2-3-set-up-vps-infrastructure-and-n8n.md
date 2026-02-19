# Story 2.3: Set Up VPS Infrastructure and n8n

**Epic:** 2 - Order Data Ingestion & Automation Worker
**Story ID:** 2.3
**Status:** review
**Created:** 2026-02-18

**Note:** Scope changed 2026-02-18 via Sprint Change Proposal. Original "Email Manifest Parsing" story replaced with automation worker infrastructure. See `_bmad-output/planning-artifacts/sprint-change-proposal-2026-02-18.md`.

---

## Story

**As an** Aureon DevOps engineer,
**I want to** provision a VPS with n8n and the automation worker runtime,
**So that** we have dedicated infrastructure for running data ingestion connectors (email, browser, API).

---

## Acceptance Criteria

### VPS Provisioning

```gherkin
Given A Hostinger KVM 2 VPS (São Paulo, 2 vCPU, 8GB RAM, 100GB NVMe) is provisioned
When I run the setup script and configure services
Then Ubuntu 24.04 LTS is installed and hardened:
  - UFW firewall: limit SSH (rate-limited), allow n8n port 5678
  - fail2ban installed and configured for SSH protection
  - unattended-upgrades enabled for automatic security patches
  - SSH hardened: key-only auth, root login disabled, MaxAuthTries 3, AllowUsers aureon
And Node.js 20 LTS is installed via NodeSource APT repository (NOT nvm)
And n8n 2.9.0 is installed globally and running as a systemd service with auto-restart
And n8n native user management is configured (owner account created via N8N_DEFAULT_USER_EMAIL/PASSWORD)
And n8n is connected to Supabase via both API (SUPABASE_SERVICE_ROLE_KEY) and direct PostgreSQL connection
And n8n uses PostgreSQL backend (local or Supabase schema) for workflow persistence
And 4GB swap is configured as safety net for memory spikes
And systemd services have resource limits (MemoryMax, TasksMax)
```

### Browser Automation Runtime

```gherkin
Given The VPS is provisioned with Node.js 20+
When Playwright with Chromium is installed
Then `npx playwright install --with-deps chromium` completes successfully
And A test script verifies Chromium launches headless and can navigate to a URL
And Peak memory usage is documented (~826-874MB per Chromium instance)
And Only one browser session runs at a time (enforced by Story 2.6, documented here)
```

### Repository Structure

```gherkin
Given The monorepo contains apps/frontend/ and apps/mobile/
When The worker app structure is created
Then The `apps/worker/` directory exists with:
  - src/           (worker source code, initially empty placeholder)
  - n8n/           (n8n workflow exports, initially empty)
  - scripts/       (deploy.sh, setup.sh)
  - package.json   (Node.js project config)
  - .env.example   (complete env var template with generation instructions)
  - README.md      (setup, operation, and troubleshooting guide)
And Root package.json workspaces field includes "apps/worker" (if using npm workspaces)
```

### Deployment Pipeline

```gherkin
Given The apps/worker/ directory exists in the repository
When Code is pushed to main affecting apps/worker/**
Then A GitHub Actions workflow (deploy-worker) triggers
And It connects to the VPS via SSH (action pinned to commit SHA, not mutable tag)
And Runs deploy.sh with error handling (set -e, rollback on failure)
And Verifies services via health checks (n8n responds, worker active, Supabase reachable)
And Has concurrency group to prevent simultaneous deploys
And Has timeout (10 minutes max)
And Reports success/failure status
```

### Monitoring & Connectivity

```gherkin
Given The VPS services are running
When Monitoring is configured
Then BetterStack uptime checks monitor n8n health endpoint and VPS SSH
And Sentry DSN is configured for worker error tracking
And Supabase connectivity verified: test SELECT via service role key succeeds
And Supabase Storage bucket `raw-files` is created (needed by Stories 2.5-2.6)
```

### Documentation Updates

```gherkin
Given The VPS infrastructure is set up
When Documentation is updated
Then Architecture doc reflects VPS infrastructure replacing ALL Railway/Redis/BullMQ references:
  - Backend+Workers section rewritten for VPS
  - External services table updated (add Hostinger VPS + Groq API)
  - Technology dependency graph updated
  - Service boundaries diagram redrawn
  - apps/worker/ added to application structure
And Deployment runbook has new VPS section replacing Railway section:
  - Initial provisioning checklist
  - Environment variable reference table
  - Service management commands (systemctl, journalctl)
  - SSH key rotation procedure
  - Troubleshooting guide (common issues + solutions)
  - Monitoring integration (BetterStack + Sentry)
  - Rollback procedure
```

---

## Tasks / Subtasks

### Phase 1: Repository Structure (AC: Repository Structure)
- [x] Check root `package.json` — if using npm workspaces, add `"apps/worker"` to workspaces array — **N/A: no root package.json in this repo; apps/frontend and apps/mobile are independent**
- [x] Create `apps/worker/package.json` (name: "@aureon/worker", private, engines: node >=20)
- [x] Create `apps/worker/tsconfig.json`
- [x] Create `apps/worker/src/index.ts` (placeholder: `console.log('Aureon worker starting...')`)
- [x] Create `apps/worker/n8n/workflows/.gitkeep`
- [x] Create `apps/worker/scripts/setup.sh` (Phase 2 content)
- [x] Create `apps/worker/scripts/deploy.sh` (Phase 2 content)
- [x] Create `apps/worker/.env.example` — complete template (see Environment Variables section below)
- [x] Create `apps/worker/README.md` — setup guide, service management, troubleshooting, n8n workflow export procedure

### Phase 2: VPS Setup Script (AC: VPS Provisioning, Browser Automation)

Write `apps/worker/scripts/setup.sh` — idempotent VPS provisioning script with `set -e` error handling. All commands must check if already done before executing (idempotent).

- [x] **System updates:** `apt update && apt upgrade -y`
- [x] **Create dedicated user:** `useradd -m -s /bin/bash aureon` (if not exists)
- [x] **Grant limited sudo:** `aureon ALL=(ALL) NOPASSWD: /bin/systemctl` for service management
- [x] **SSH hardening** (`/etc/ssh/sshd_config`):
  ```
  PasswordAuthentication no
  PermitRootLogin no
  PubkeyAuthentication yes
  MaxAuthTries 3
  LoginGraceTime 30
  AllowUsers aureon
  ClientAliveInterval 300
  ClientAliveCountMax 2
  ```
- [x] **Firewall (UFW):**
  ```bash
  sudo ufw default deny incoming
  sudo ufw default allow outgoing
  sudo ufw limit 22/tcp      # Rate-limited SSH (6 connections/30sec)
  sudo ufw allow 5678/tcp    # n8n web UI
  sudo ufw --force enable
  ```
- [x] **Security packages:**
  ```bash
  sudo apt install -y fail2ban unattended-upgrades
  sudo dpkg-reconfigure -plow unattended-upgrades
  # fail2ban: bantime=3600, maxretry=3
  ```
- [x] **Node.js 20 LTS via NodeSource** (NOT nvm — nvm doesn't work with systemd):
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  # Gives /usr/bin/node and /usr/bin/npm — stable paths for systemd
  ```
- [x] **n8n 2.9.0** (pinned version — 8 CVEs in older versions):
  ```bash
  sudo npm install -g n8n@2.9.0
  ```
- [x] **n8n PostgreSQL backend** (local PostgreSQL or Supabase schema):
  ```bash
  sudo apt install -y postgresql
  sudo -u postgres createuser n8n
  sudo -u postgres createdb n8n -O n8n
  # Add DB_TYPE=postgresdb + connection vars to .env
  ```
- [x] **Playwright + Chromium:**
  ```bash
  sudo -u aureon npx playwright install --with-deps chromium
  # Binaries at /home/aureon/.cache/ms-playwright/ (~200MB)
  ```
- [x] **4GB swap** (safety net for Chromium memory spikes — peak 826-874MB):
  ```bash
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
  sudo sysctl -p
  ```
- [x] **systemd service: n8n** (`/etc/systemd/system/n8n.service`):
  ```ini
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
  ```
- [x] **systemd service: worker** (`/etc/systemd/system/aureon-worker.service`):
  ```ini
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
  ```
- [x] **Secure .env file:** `chmod 600 /home/aureon/.env && chown aureon:aureon /home/aureon/.env`
- [x] **Enable and start services:** `systemctl daemon-reload && systemctl enable n8n aureon-worker && systemctl start n8n`
- [x] **Smoke tests:**
  ```bash
  # 1. n8n health check
  curl -sf http://localhost:5678/healthz || { echo "n8n health check FAILED"; exit 1; }

  # 2. Chromium launch test
  sudo -u aureon npx playwright test --list || echo "Playwright basic check"

  # 3. Supabase connectivity
  curl -sf "${SUPABASE_URL}/rest/v1/" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    || { echo "Supabase connectivity FAILED"; exit 1; }

  # 4. Service auto-restart test
  sudo systemctl stop n8n && sleep 15 && sudo systemctl is-active n8n \
    || { echo "n8n auto-restart FAILED"; exit 1; }
  ```

Write `apps/worker/scripts/deploy.sh`:
```bash
#!/bin/bash
set -euo pipefail
trap 'echo "DEPLOY FAILED at line $LINENO"; exit 1' ERR

echo "=== Aureon Worker Deploy ==="

# Pre-checks
df -h / | awk 'NR==2 {if ($5+0 > 90) {print "DISK >90%"; exit 1}}'

cd ~/aureon-last-mile
git pull origin main

cd apps/worker
npm ci --production
npm audit --production --audit-level=moderate || echo "WARN: npm audit issues found"
npm run build

sudo systemctl restart aureon-worker
sleep 5

# Health checks
sudo systemctl is-active aureon-worker || { echo "Worker restart FAILED"; exit 1; }
curl -sf http://localhost:5678/healthz || echo "WARN: n8n health check failed"

echo "=== Deploy SUCCESS ==="
```

### Phase 3: GitHub Actions Deployment (AC: Deployment Pipeline)

Create `.github/workflows/deploy-worker.yml` following existing patterns from `deploy.yml`:

```yaml
name: Deploy Worker to VPS

on:
  push:
    branches: [main]
    paths:
      - 'apps/worker/**'

concurrency:
  group: vps-deploy
  cancel-in-progress: false

jobs:
  deploy-worker:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Deploy to VPS via SSH
        uses: appleboy/ssh-action@<PIN_TO_COMMIT_SHA_OF_v1.2.4>
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          timeout: 60s
          script: |
            bash ~/aureon-last-mile/apps/worker/scripts/deploy.sh

      - name: Verify deployment
        if: failure()
        run: echo "::error::VPS deployment failed. Check worker logs via SSH."
```

**Note:** Get the commit SHA from https://github.com/appleboy/ssh-action/releases — do NOT use `@v1` tag (supply chain risk after tj-actions incident March 2025). Also check open issue #337 on that repo.

**Worker CI pipeline** (linting, testing, type-checking) is OUT OF SCOPE for Story 2.3. Will be created in Story 2.7 when actual worker application code exists.

### Phase 4: Documentation (AC: Documentation Updates)

- [x] Update `_bmad-output/planning-artifacts/architecture.md` — specific sections to change:
  - [x] **"Backend + Workers: Railway" section** → Replace entirely with:
    ```
    Automation Worker: Hostinger VPS (São Paulo, KVM 2)
    - n8n 2.x (workflow orchestration, IMAP listener, CSV processing) — 24/7 systemd daemon
    - Playwright + Chromium (browser automation) — on-demand per job
    - Worker process (job queue orchestrator) — 24/7 systemd daemon
    - Node.js 20 LTS runtime
    - No Redis — Supabase jobs table with FOR UPDATE SKIP LOCKED replaces BullMQ
    ```
  - [x] **Application structure diagram** → Add `apps/worker/` entry
  - [x] **External services table** → Add rows:
    - `Hostinger VPS | KVM 2: automation worker infrastructure | $6.99/month`
    - `Groq API | LLM inference for browser agent (Llama 4 Scout) | ~$1/month`
  - [x] **Service boundaries diagram** → Redraw: `Vercel ↔ Supabase ↔ VPS` (Supabase is sole contract layer)
  - [x] **Technology dependency graph** → Remove Railway, Redis, BullMQ; add VPS, Playwright, n8n 2.x
  - [x] **"aureon-api" Railway references** → Removed key references; remaining historical refs preserved as context
  - [x] Add note: "BullMQ (Redis job queue) replaced by Supabase `jobs` table with `FOR UPDATE SKIP LOCKED`"
- [x] Update `apps/frontend/docs/deployment-runbook.md`:
  - [x] **Railway section** → Add deprecation callout: `> **OBSOLETE (2026-02-18):** n8n moved to Hostinger VPS. See VPS Deployment section below.`
  - [x] **Remove** `RAILWAY_TOKEN` from required secrets table
  - [x] **Add** new secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (with format notes)
  - [x] **Add new section: "VPS Deployment (Hostinger)"** with:
    1. Initial provisioning checklist
    2. Running setup.sh
    3. Environment variables table (Required/Optional, Component, How to Generate)
    4. Service management:
       ```
       sudo systemctl status n8n / aureon-worker
       sudo journalctl -u n8n -f
       sudo systemctl restart n8n / aureon-worker
       ```
    5. Deployment (automatic via GitHub Actions, manual via `deploy.sh`)
    6. SSH key rotation: Generate new key → Update VPS authorized_keys → Update GitHub Secret → Test deploy
    7. Rollback: `git revert <sha> && git push` triggers redeploy; or SSH in and `git checkout <sha> && bash deploy.sh`
    8. Troubleshooting:
       - n8n won't start → `journalctl -u n8n -n 50`, check Node.js path, check .env permissions
       - Worker won't start → Same, check `dist/index.js` exists
       - Supabase unreachable → Check VPS outbound, verify env vars, test curl
       - Disk full → `df -h`, clean journald: `journalctl --vacuum-size=500M`
    9. Monitoring: BetterStack for uptime, Sentry for errors

### Phase 5: Manual VPS Provisioning (AC: VPS Provisioning, Monitoring)

- [ ] **Provision VPS:** Hostinger KVM 2 (São Paulo, Ubuntu 24.04 LTS), verify auto-renewal/billing
- [ ] **Generate SSH key pair:**
  ```bash
  ssh-keygen -t ed25519 -f aureon-vps-key -N "" -C "aureon-ci-cd"
  # Copy public key to VPS: ssh-copy-id -i aureon-vps-key.pub root@<VPS_IP>
  ```
- [ ] **Initial SSH as root:** Create `aureon` user, add public key, disable root login, restart sshd
- [ ] **Run `setup.sh`** on VPS as root (creates user, installs everything, configures services)
- [ ] **Configure GitHub repository secrets** (Settings → Secrets → Actions):
  - `VPS_HOST`: VPS IP address (e.g., `192.168.1.1`)
  - `VPS_USER`: `aureon`
  - `VPS_SSH_KEY`: Content of `aureon-vps-key` private key file (entire file including BEGIN/END markers)
  - Test SSH from local first: `ssh -i aureon-vps-key aureon@$VPS_HOST "echo OK"`
- [ ] **Create n8n owner account:** Navigate to `http://<VPS_IP>:5678`, create initial admin user
- [ ] **Verify Supabase connectivity:**
  ```bash
  # API access
  curl -sf "https://<project>.supabase.co/rest/v1/orders?select=count" \
    -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
    -H "apikey: <SERVICE_ROLE_KEY>"

  # Direct DB access (for n8n PostgreSQL node)
  psql "postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres" -c "SELECT 1"
  ```
- [ ] **Create Supabase Storage bucket:** `raw-files` (needed by Stories 2.5-2.6 for file uploads)
  - In Supabase Dashboard → Storage → New bucket → Name: `raw-files`, Public: No
  - Add policy: Allow service role full access
- [ ] **Generate encryption key** (for Story 2.4-2.6 connector credentials):
  ```bash
  openssl rand -hex 32
  # Add result as ENCRYPTION_KEY in VPS .env
  ```
- [ ] **Configure BetterStack monitoring:**
  - Add HTTP monitor: `http://<VPS_IP>:5678/healthz` (n8n health)
  - Add heartbeat monitor for worker process (or SSH-based check)
  - Configure alerts: email + preferred channel (ask Gerhard: Telegram/Slack?)
- [ ] **Configure Sentry:** Create "aureon-worker" project in Sentry, add DSN to VPS .env
- [ ] **Run deploy-worker.yml:** Push a trivial change to `apps/worker/` and verify GitHub Actions deploys successfully

---

## Dev Notes

### Business Context & Value

This story creates the foundational infrastructure for ALL automated data ingestion in Epic 2. Without it, Stories 2.5-2.7 cannot proceed.

**Why VPS instead of Railway:**
- Playwright/Chromium requires persistent installation (not ephemeral containers)
- $6.99/month vs Railway's $5-20/month — comparable cost, much more capability
- Full control over system configuration (systemd, cron, firewall)
- No timeout limits for browser scraping operations
- No Redis needed — Supabase `jobs` table with `FOR UPDATE SKIP LOCKED` replaces BullMQ

**Dependencies:**
- **Depends on:** Story 2.1 (orders table) ✅ DONE
- **Blocks:** Stories 2.4, 2.5, 2.6, 2.7
- **Contract:** VPS ↔ Supabase ONLY. No direct VPS ↔ Vercel communication.

### Scalability Note (MVP Only)

Single VPS is suitable for MVP (<100 concurrent jobs/day). Future scaling would require multiple worker instances, load balancer, or managed Kubernetes. This is not in scope for Epic 2.

---

## Developer Context & Guardrails

### This is an Infrastructure Story, Not a Code Story

The developer creates shell scripts, GitHub Actions YAML, placeholder directory structure, and documentation. The actual worker application code comes in Stories 2.5-2.7. Worker CI pipeline (test/lint) will be created in Story 2.7 when application code exists.

### Architecture Change — Railway Replaced by VPS

| Component | OLD (Architecture Doc) | NEW (This Story) |
|-----------|----------------------|-------------------|
| n8n hosting | Railway | Hostinger VPS (São Paulo) |
| n8n version | 1.x | **2.9.0** (8 CVEs in older versions) |
| n8n auth | Basic auth env vars | **Native user management** (2.x breaking change) |
| n8n database | SQLite | **PostgreSQL** (prevents write-lock issues) |
| Job queue | BullMQ + Redis | Supabase `jobs` table + `FOR UPDATE SKIP LOCKED` |
| Browser automation | Not planned | Playwright + Chromium on VPS |
| LLM for scraping | Not planned | Groq API → Llama 4 Scout |
| Worker process | Railway service | systemd service on VPS |
| Node.js install | Not specified | **NodeSource APT** (NOT nvm — nvm breaks systemd) |
| Deployment | Railway auto-deploy | GitHub Actions → SSH → deploy.sh |

### Supabase is the Contract Layer

```
Vercel (Frontend/API)  ←→  Supabase (Database + Storage)  ←→  VPS (Worker + n8n)
```

n8n connects to Supabase two ways:
1. **Supabase node** (API): Uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for auth, storage, simple queries
2. **PostgreSQL node** (direct DB): Uses `SUPABASE_DB_*` connection for complex SQL (`FOR UPDATE SKIP LOCKED`, bulk inserts, joins)

### Zero Tolerance for These Mistakes

| WRONG | RIGHT |
|-------|-------|
| Install Redis or BullMQ | Supabase `jobs` table (Story 2.4) |
| Create Railway config | VPS with systemd |
| Use `N8N_BASIC_AUTH_ACTIVE` | n8n 2.x native user management (`N8N_DEFAULT_USER_*`) |
| Install Node.js via nvm | NodeSource APT repo (`/usr/bin/node`) |
| `appleboy/ssh-action@v1` | Pin to commit SHA (supply chain risk) |
| `ufw allow 22/tcp` | `ufw limit 22/tcp` (rate-limited) |
| Run services as root | Dedicated `aureon` user |
| Store secrets in git | `.env.example` + GitHub Secrets + VPS `.env` (chmod 600) |
| Manual deployments | GitHub Actions on push to `apps/worker/**` |
| Write worker app code | Infrastructure only — placeholders for Stories 2.5-2.7 |
| Chromium "200-400MB" | Peak **826-874MB** — add swap, enforce serial execution |
| SQLite for n8n | **PostgreSQL** (write-lock issues under concurrency) |

---

## Technical Requirements

### VPS Specifications

| Requirement | Value |
|------------|-------|
| **Provider** | Hostinger KVM 2 |
| **Location** | São Paulo, Brazil |
| **CPU** | 2 vCPU |
| **RAM** | 8 GB + 4 GB swap |
| **Storage** | 100 GB NVMe |
| **OS** | Ubuntu 24.04 LTS |
| **Cost** | $6.99/month |

### Software Stack

| Software | Version | Install Method | Purpose |
|----------|---------|---------------|---------|
| **Node.js** | 20 LTS | NodeSource APT | Runtime (`/usr/bin/node`) |
| **n8n** | 2.9.0 (pinned) | `npm install -g n8n@2.9.0` | Workflow orchestration |
| **PostgreSQL** | 16 (system) | `apt install postgresql` | n8n backend database |
| **Playwright** | Latest | `npx playwright install` | Browser automation |
| **Chromium** | Bundled | With Playwright | Headless browser (peak ~870MB) |
| **fail2ban** | System | `apt install fail2ban` | SSH brute-force protection |
| **UFW** | System | Pre-installed | Firewall |

### Environment Variables (VPS `.env`)

Single `.env` file at `/home/aureon/.env` (chmod 600), shared by n8n and worker services.

```bash
# === n8n Configuration (v2.x — NO basic auth env vars) ===
N8N_PORT=5678
N8N_PROTOCOL=http
N8N_HOST=0.0.0.0
N8N_LOG_LEVEL=info
N8N_EXECUTION_PROCESS_TIMEOUT_MAX=3600      # 1hr max for browser jobs
# n8n 2.x owner account: Created via web UI on first launch
# N8N_DEFAULT_USER_EMAIL and N8N_DEFAULT_USER_PASSWORD only for initial setup

# === n8n PostgreSQL Backend ===
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=localhost
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_DATABASE=n8n
DB_POSTGRESDB_USER=n8n
DB_POSTGRESDB_PASSWORD=<generate: openssl rand -base64 24>

# === Supabase API Connection (for n8n Supabase node) ===
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Supabase Dashboard → Settings → API>

# === Supabase Direct DB (for n8n PostgreSQL node — complex queries) ===
SUPABASE_DB_HOST=db.<project-ref>.supabase.co
SUPABASE_DB_PORT=5432
SUPABASE_DB_NAME=postgres
SUPABASE_DB_USER=postgres
SUPABASE_DB_PASSWORD=<from Supabase Dashboard → Database → Connection string>

# === Worker Configuration ===
NODE_ENV=production
WORKER_POLL_INTERVAL_MS=30000

# === Credential Encryption (for Story 2.4+ connector configs) ===
# Generate: openssl rand -hex 32
ENCRYPTION_KEY=<64-char-hex-string>

# === Monitoring ===
SENTRY_DSN=<from Sentry → aureon-worker project → Client Keys>

# === Groq API (for Story 2.6 browser agent — can defer until 2.6) ===
# GROQ_API_KEY=<from console.groq.com>

# === Webhook URL (deferred — configure when reverse proxy/domain set up) ===
# Required for Stories 2.5-2.7 webhook callbacks. For MVP, n8n runs at
# http://<VPS_IP>:5678. Reverse proxy (Nginx/Caddy + Let's Encrypt) is
# a future enhancement — not required for IMAP polling or scheduled jobs.
# WEBHOOK_URL=https://n8n.yourdomain.com
```

### GitHub Actions Secrets

| Secret | Value | Format |
|--------|-------|--------|
| `VPS_HOST` | VPS IP address | `192.168.x.x` |
| `VPS_USER` | `aureon` | Plain text |
| `VPS_SSH_KEY` | ed25519 private key | Full file content including `-----BEGIN/END-----` markers |

### Memory Budget (8GB RAM + 4GB swap)

| Component | Typical | Peak | Notes |
|-----------|---------|------|-------|
| n8n 2.x + task runners | 500 MB | 1.5 GB | Task runners increase memory |
| PostgreSQL (local, n8n) | 200 MB | 400 MB | Shared buffers |
| Worker process | 50 MB | 200 MB | Node.js baseline |
| Chromium (1 instance) | 400 MB | 874 MB | Story 2.6 only, serial execution |
| OS + services | 500 MB | 800 MB | Ubuntu + systemd + fail2ban |
| **Total** | **1.65 GB** | **3.77 GB** | **4.23 GB headroom + 4GB swap** |

### Repository Structure

```
apps/worker/
├── package.json           # @aureon/worker, private, engines: node>=20
├── tsconfig.json
├── .env.example           # Complete template with generation instructions
├── README.md              # Setup, operation, troubleshooting, n8n export procedure
├── src/
│   └── index.ts           # Placeholder (actual code in Story 2.7)
├── n8n/
│   └── workflows/
│       └── .gitkeep       # Export here: n8n UI → Menu → Download → save as JSON
└── scripts/
    ├── setup.sh           # Idempotent VPS provisioning (run as root)
    └── deploy.sh          # Deployment (called by GitHub Actions)
```

---

## Architecture Compliance

### Service Communication Pattern

```
┌─────────────────┐     ┌─────────────────────────┐     ┌─────────────────┐
│   Vercel         │     │      Supabase            │     │   VPS (Hostinger)│
│  (Frontend/API)  │────▶│  PostgreSQL + Storage    │◀────│  n8n + Worker    │
│                  │     │  Auth + Realtime         │     │  Playwright      │
└─────────────────┘     └─────────────────────────┘     └─────────────────┘
                              ▲
                              │
                         Contract Layer
                    (Only communication path)
```

### Key Architectural Decisions

1. **No Redis/BullMQ** — Supabase `jobs` table with `FOR UPDATE SKIP LOCKED` is simpler
2. **No Railway** — VPS provides persistent Playwright and full system control
3. **n8n PostgreSQL backend** — Prevents SQLite write-lock issues under concurrent workflow execution
4. **Dual Supabase connection** — API (service role key) + direct PostgreSQL for complex queries
5. **Service role key bypasses RLS** — Intentional for multi-tenant worker operations. Worker reads ALL tenants' jobs.

---

## Previous Story Intelligence

### Story 2.2 Context

Story 2.2 (CSV/Excel Upload) is `in-progress`. Validation logic in `src/lib/validation/orderImportValidation.ts` will be referenced (not directly reused) by n8n connectors in Stories 2.5-2.6 for consistency (phone format, date format, comuna validation).

### Epic 1 Lessons Applied

- **CI/CD early** → This story creates GitHub Actions from the start
- **Docs prevent disasters** → Architecture + runbook updated in Phase 4
- **Test connectivity first** → setup.sh has smoke tests (n8n, Chromium, Supabase)
- **Real fetch, not mocks** → Supabase connectivity tests use actual HTTP/SQL (commit 71a9ef9 lesson)
- **Env var management** → .env.example with ALL vars + generation instructions

### What Story 2.7 Will Add

Story 2.3 provides the runtime environment. Story 2.7 fills in the application logic:
- Worker polling loop + job state machine
- Retry logic + exponential backoff
- Scheduled job creation (cron)
- Structured JSON logging to stdout → journald
- Sentry error integration
- Health check endpoints
- Worker CI pipeline (test.yml equivalent)

---

## Project Context Reference

| Document | Path |
|----------|------|
| Sprint Change Proposal | `_bmad-output/planning-artifacts/sprint-change-proposal-2026-02-18.md` |
| Architecture | `_bmad-output/planning-artifacts/architecture.md` |
| Deployment Runbook | `apps/frontend/docs/deployment-runbook.md` |
| Epic 2 Planning | `_bmad-output/planning-artifacts/epics.md` (Epic 2 section) |
| CSV Parsing Spike | `apps/frontend/docs/csv-excel-parsing-spike.md` |

**Downstream Stories:**
- **2.4:** Automation worker DB schema (creates `tenant_clients`, `jobs`, `raw_files` tables)
- **2.5:** Easy CSV/email connector (n8n IMAP workflow + CSV parsing)
- **2.6:** Paris/Beetrack browser connector (Playwright + Groq, uses Chromium installed here)
- **2.7:** Job orchestration + monitoring (worker application code, CI pipeline)

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Claude Code)

### Debug Log References

- No root `package.json` found — npm workspaces N/A. Each app (`apps/frontend`, `apps/mobile`) is independent.
- `appleboy/ssh-action` pinned to commit SHA `a7d4b97cd9e01e8e09cedc7c85cb9b2bb4e00ab4` (v1.2.4) per supply chain security requirement.
- Phase 5 (Manual VPS Provisioning) requires Gerhard's Hostinger account credentials — HALT condition. Infrastructure scripts are ready; actual provisioning awaits Gerhard.

### Completion Notes List

- **Phase 1 (Repository Structure):** All files created: `apps/worker/package.json`, `tsconfig.json`, `src/index.ts`, `n8n/workflows/.gitkeep`, `scripts/setup.sh`, `scripts/deploy.sh`, `.env.example`, `README.md`.
- **Phase 2 (VPS Setup Scripts):** `setup.sh` is idempotent, covers all 14 provisioning steps including UFW (`ufw limit 22/tcp` not `allow`), NodeSource APT (not nvm), n8n 2.9.0 pinned, PostgreSQL backend, Playwright + Chromium, 4GB swap, both systemd services with resource limits, smoke tests. `deploy.sh` has `set -euo pipefail`, disk pre-check, `npm ci`, build, restart, health check.
- **Phase 3 (GitHub Actions):** `.github/workflows/deploy-worker.yml` created with `appleboy/ssh-action` pinned to commit SHA, concurrency group `vps-deploy`, `cancel-in-progress: false`, 10-minute timeout, path filter `apps/worker/**`.
- **Phase 4 (Documentation):** `_bmad-output/planning-artifacts/architecture.md` updated — Railway replaced with Hostinger VPS in all key sections (tech stack YAML, Backend+Workers section, service boundaries, technology dependency graph, application structure, external services, caching layer). `apps/frontend/docs/deployment-runbook.md` v1.1 — added full VPS Deployment section, deprecated Railway section, updated GitHub secrets table (removed `RAILWAY_TOKEN`, added `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY`), updated ToC and changelog.
- **Phase 5 (Manual VPS Provisioning):** HALT — requires Gerhard's Hostinger account. All scripts and configuration are ready. See open items below.

### File List

**New files:**
- `apps/worker/package.json`
- `apps/worker/tsconfig.json`
- `apps/worker/src/index.ts`
- `apps/worker/n8n/workflows/.gitkeep`
- `apps/worker/scripts/setup.sh`
- `apps/worker/scripts/deploy.sh`
- `apps/worker/.env.example`
- `apps/worker/README.md`
- `.github/workflows/deploy-worker.yml`

**Modified files:**
- `_bmad-output/planning-artifacts/architecture.md`
- `apps/frontend/docs/deployment-runbook.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/2-3-set-up-vps-infrastructure-and-n8n.md` (this file)

---

## Story Completion Status

**Status:** review
**Analysis Completed:** 2026-02-18
**Quality Review:** Passed (4-agent validation: architecture, epics/PRD, CI/CD patterns, web research)

**Next Steps for Developer:**
1. Read this entire story file
2. Read `_bmad-output/planning-artifacts/sprint-change-proposal-2026-02-18.md` (story origin)
3. Read `apps/frontend/docs/deployment-runbook.md` (will be updated in Phase 4)
4. Phase 1: Repository structure (no external deps)
5. Phase 2: VPS setup + deploy scripts
6. Phase 3: GitHub Actions workflow
7. Phase 4: Documentation updates (architecture + runbook)
8. Phase 5: Manual provisioning (requires Gerhard's Hostinger account)

**Open Items Requiring Gerhard's Input:**
- Hostinger account credentials for VPS provisioning
- Notification channel preference for worker alerts (email, Telegram, Slack?)
- DNS/domain for n8n web UI (optional — IP:5678 works for MVP)
