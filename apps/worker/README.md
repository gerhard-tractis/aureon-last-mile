# Aureon Automation Worker

The automation worker runs on a Hostinger KVM 2 VPS (São Paulo) and provides infrastructure for data ingestion connectors: email, browser automation, and API-based pipelines.

**Stack:** Node.js 20 LTS · n8n 2.9.0 · Playwright + Chromium · systemd · PostgreSQL

**Architecture:**
```
Vercel (Frontend/API)  ↔  Supabase (Database + Storage)  ↔  VPS (n8n + Worker)
```
Supabase is the sole contract layer. VPS communicates with Supabase only — never directly with Vercel.

---

## Directory Structure

```
apps/worker/
├── package.json           # @aureon/worker, Node.js >=20
├── tsconfig.json
├── .env.example           # Copy to /home/aureon/.env on VPS (chmod 600)
├── src/
│   └── index.ts           # Entry point (placeholder — Story 2.7 adds logic)
├── n8n/
│   └── workflows/         # n8n workflow exports (JSON)
│       └── .gitkeep
└── scripts/
    ├── setup.sh           # Idempotent VPS provisioning (run as root)
    └── deploy.sh          # Deployment (called by GitHub Actions)
```

---

## Initial VPS Provisioning

### Prerequisites

- Hostinger KVM 2 VPS provisioned (Ubuntu 24.04 LTS, São Paulo)
- SSH access as `root`
- Local machine with `ssh-keygen` and `gh` CLI

### Step 1: Generate SSH key pair

```bash
ssh-keygen -t ed25519 -f aureon-vps-key -N "" -C "aureon-ci-cd"
# Copy public key to VPS:
ssh-copy-id -i aureon-vps-key.pub root@<VPS_IP>
```

### Step 2: Clone repository on VPS

```bash
ssh root@<VPS_IP>
git clone https://github.com/gerhard-tractis/aureon-last-mile.git ~/aureon-last-mile
```

### Step 3: Run setup script

```bash
cd ~/aureon-last-mile
bash apps/worker/scripts/setup.sh
```

The script is **idempotent** — safe to re-run. It will:
- Create the `aureon` user with limited sudo
- Harden SSH (key-only, no root, rate-limited)
- Configure UFW firewall (SSH + port 5678)
- Install fail2ban + unattended-upgrades
- Install Node.js 20 LTS (NodeSource APT — NOT nvm)
- Install n8n 2.9.0 globally
- Set up PostgreSQL for n8n backend
- Install Playwright + Chromium (~200 MB)
- Configure 4 GB swap
- Install systemd services for n8n and worker

### Step 4: Configure environment

```bash
cp ~/aureon-last-mile/apps/worker/.env.example /home/aureon/.env
# Edit /home/aureon/.env with real values
nano /home/aureon/.env
chmod 600 /home/aureon/.env
chown aureon:aureon /home/aureon/.env
```

### Step 5: Start services

```bash
sudo systemctl start n8n
# Verify
sudo systemctl status n8n
curl http://localhost:5678/healthz
```

### Step 6: Create n8n owner account

Navigate to `http://<VPS_IP>:5678` and create the initial admin account.

> **n8n 2.x breaking change:** Owner account is created via the web UI. Do NOT use `N8N_BASIC_AUTH_ACTIVE` (removed in v2).

### Step 7: Add GitHub repository secrets

Go to: `https://github.com/gerhard-tractis/aureon-last-mile/settings/secrets/actions`

| Secret | Value | Format |
|--------|-------|--------|
| `VPS_HOST` | VPS IP address | `192.168.x.x` |
| `VPS_USER` | `aureon` | Plain text |
| `VPS_SSH_KEY` | ed25519 private key content | Full file including `-----BEGIN/END-----` markers |

Test SSH before adding to GitHub:
```bash
ssh -i aureon-vps-key aureon@$VPS_HOST "echo OK"
```

---

## Service Management

### Status

```bash
sudo systemctl status n8n
sudo systemctl status aureon-worker
```

### Logs

```bash
# Live logs
sudo journalctl -u n8n -f
sudo journalctl -u aureon-worker -f

# Recent logs
sudo journalctl -u n8n -n 100
sudo journalctl -u aureon-worker -n 100

# Since boot
sudo journalctl -u n8n -b
```

### Start / Stop / Restart

```bash
sudo systemctl start n8n
sudo systemctl stop n8n
sudo systemctl restart n8n

sudo systemctl start aureon-worker
sudo systemctl stop aureon-worker
sudo systemctl restart aureon-worker
```

### n8n Health Check

```bash
curl http://localhost:5678/healthz
```

---

## Deployment

### Automatic (GitHub Actions)

Pushes to `main` affecting `apps/worker/**` trigger `.github/workflows/deploy-worker.yml` automatically.

### Manual

SSH into the VPS and run:

```bash
ssh aureon@<VPS_HOST>
bash ~/aureon-last-mile/apps/worker/scripts/deploy.sh
```

### Rollback

```bash
# Option 1: Revert commit (triggers redeploy via CI)
git revert <commit-sha>
git push

# Option 2: SSH and checkout specific version
ssh aureon@<VPS_HOST>
cd ~/aureon-last-mile
git checkout <commit-sha>
bash apps/worker/scripts/deploy.sh
```

---

## SSH Key Rotation

```bash
# 1. Generate new key pair
ssh-keygen -t ed25519 -f aureon-vps-key-new -N "" -C "aureon-ci-cd-$(date +%Y%m)"

# 2. Add new public key to VPS
ssh aureon@<VPS_HOST> "echo '$(cat aureon-vps-key-new.pub)' >> ~/.ssh/authorized_keys"

# 3. Test new key works
ssh -i aureon-vps-key-new aureon@<VPS_HOST> "echo OK"

# 4. Update GitHub secret VPS_SSH_KEY with new private key content

# 5. Trigger a test deploy to verify CI still works

# 6. Remove old key from VPS authorized_keys
ssh -i aureon-vps-key-new aureon@<VPS_HOST> "sed -i '/aureon-ci-cd$/d' ~/.ssh/authorized_keys"
```

---

## n8n Workflow Export Procedure

To version-control n8n workflows:

1. In n8n UI: open workflow → Menu (⋮) → **Download**
2. Save the `.json` file to `apps/worker/n8n/workflows/<workflow-name>.json`
3. Commit and push

To import a workflow on a new n8n instance:

1. n8n UI → **Workflows** → **Import from File**
2. Select the JSON file

---

## Troubleshooting

### n8n won't start

```bash
sudo journalctl -u n8n -n 50
# Common causes:
# - Missing or malformed /home/aureon/.env
# - Wrong DB credentials (check DB_POSTGRESDB_PASSWORD)
# - Port 5678 already in use: sudo lsof -i :5678
# - Node.js path wrong: which node  (must be /usr/bin/node, not ~/.nvm)
```

### Worker won't start

```bash
sudo journalctl -u aureon-worker -n 50
# Common causes:
# - dist/index.js doesn't exist: run npm run build first
# - Missing environment variables in /home/aureon/.env
```

### Supabase unreachable

```bash
# Test VPS outbound connectivity
curl -sf "https://<project>.supabase.co/rest/v1/" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"

# Verify env vars are loaded
sudo -u aureon bash -c 'source /home/aureon/.env && echo $SUPABASE_URL'
```

### Disk full

```bash
df -h
# Clean old logs
sudo journalctl --vacuum-size=500M
# Check large files
du -sh /home/aureon/.cache/ms-playwright  # Playwright binaries (~200MB)
du -sh /var/log
```

### Memory pressure

```bash
free -h
# If swap is heavily used:
cat /proc/meminfo | grep Swap
# Scale back concurrent Chromium sessions (only 1 at a time — enforced in Story 2.6)
```

---

## Monitoring

- **BetterStack:** HTTP monitor on `http://<VPS_IP>:5678/healthz` (n8n)
- **Sentry:** DSN configured in `/home/aureon/.env` under `SENTRY_DSN`

---

## Memory Budget (8 GB RAM + 4 GB swap)

| Component | Typical | Peak |
|-----------|---------|------|
| n8n 2.x + task runners | 500 MB | 1.5 GB |
| PostgreSQL (local, n8n) | 200 MB | 400 MB |
| Worker process | 50 MB | 200 MB |
| Chromium (1 instance max) | 400 MB | 874 MB |
| OS + systemd + fail2ban | 500 MB | 800 MB |
| **Total** | **1.65 GB** | **3.77 GB** |

> Only one Chromium session runs at a time (enforced by Story 2.6 job queue logic).
