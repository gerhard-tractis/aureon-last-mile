# Technical Debt Register

> Track known technical debt items that need to be addressed.
> Format: add new items at the top of their category. Mark resolved items with ✅ and a date.

---

## Infrastructure

### TD-001 — Containerise OpenClaw (native → Docker)
- **Added:** 2026-02-23
- **Status:** Open
- **Context:** OpenClaw is natively installed at `/usr/bin/openclaw` on the Hostinger VPS (`187.77.48.107`). It runs as a bare process (`openclaw-gateway`, PID-based) with no systemd service, meaning its restart behaviour on reboot is unknown. All other services on the VPS (n8n) run in Docker.
- **Risk:** Medium — process won't auto-restart after a reboot; harder to update and back up.
- **What to do:**
  1. Identify or build a Docker image for OpenClaw
  2. Migrate config/state from `/home/node/.openclaw` (or wherever the native install stores it)
  3. Create a `docker-compose.yml` alongside the existing n8n setup
  4. Add a systemd unit or Docker restart policy (`unless-stopped`)
  5. Verify `openclaw-aureon.tractis.ai` still works after cutover
  6. Remove the native binary

---

### TD-002 — Docker API exposed publicly on port 18889
- **Added:** 2026-02-23
- **Status:** Open
- **Context:** The Docker daemon API is listening on `0.0.0.0:18889` on the VPS, meaning it is reachable from the public internet. This effectively grants root-level access to anyone who can reach that port.
- **Risk:** High — critical security exposure.
- **What to do:**
  - Add UFW rule: `ufw deny 18889` to block public access immediately
  - Or bind the Docker API to `127.0.0.1` only in `/etc/docker/daemon.json`

---

## CI/CD

### TD-003 — No branch protection / PR requirement enforced ✅
- **Added:** 2026-02-23
- **Resolved:** 2026-02-23
- **Context:** All commits during Epic 1 & 2 were pushed directly to `main` (GitHub shows "Bypassed rule violations — changes must be made through a pull request"). Branch protection rules exist but `enforce_admins` was false, allowing admin bypass.
- **What was done:**
  - Enabled `enforce_admins` on `main` — admins now go through the PR flow too
  - Consolidated all production deploys into a single `deploy.yml` with sequential jobs: Supabase → Vercel + VPS Worker (parallel) → Railway (stubbed for future)
  - Removed standalone `deploy-worker.yml`
  - Deploy pipeline now only runs on code that has passed CI (tests/lint/build) via branch protection

---

## Application

*(none yet)*

---

## Database

*(none yet)*

---

## Resolved

*(none yet)*
# auto-merge test
