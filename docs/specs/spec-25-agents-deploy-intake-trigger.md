# Spec-25: Agents Deploy Pipeline + Intake Submission Trigger

**Status:** completed
**Author:** Claude (post spec-23 gap discovered)
**Date:** 2026-03-30

---

## Problem

After spec-23 was merged (OpenRouter OCR agent), the intake camera flow was still **completely non-functional** end-to-end despite the code being correct. Three separate gaps blocked it:

### Gap 1 — No trigger from frontend to BullMQ

The frontend inserts a row in `intake_submissions` with `status='received'`, then waits on Supabase Realtime for the status to update. But **nothing was listening** for that insert and enqueuing a BullMQ job. The agents process never woke up. The frontend would wait forever.

### Gap 2 — Agents service never deployed

`apps/agents` had never been built or deployed on the VPS. No `dist/`, no `node_modules`, no systemd service installed, no deploy script, no CI job. The agent code existed only in the repo.

### Gap 3 — Config required unused keys / pointed to missing env file

- `ANTHROPIC_API_KEY` and `GROQ_API_KEY` were still marked **required** in `config.ts` even though spec-23 replaced them with `OPENROUTER_API_KEY`. The service would crash at startup before ever reaching the LLM.
- `aureon-agents.service` pointed to `/etc/aureon/agents.env` which didn't exist. The correct file is `/home/aureon/.env` (shared with the worker).

### Gap 4 — Redis not installed

BullMQ requires Redis. Redis was not installed on the VPS.

---

## Solution

### Architecture

```
[Frontend / Mobile]
  1. Upload photos → Supabase Storage (manifests bucket)
  2. INSERT intake_submissions (status='received')
  3. Subscribe to Realtime on submission ID

[VPS — aureon-agents service]
  4. intake-listener detects INSERT via Supabase Realtime
  5. Enqueues job to BullMQ intake.ingest queue (Redis)
  6. intake-worker picks up job
  7. processIntakeSubmission():
     a. Download photo buffers from Storage
     b. POST to OpenRouter → google/gemini-2.5-flash (vision)
     c. Parse JSON response
     d. Dedup check (operator_id + order_number unique)
     e. INSERT orders + packages
     f. UPDATE intake_submissions status='parsed'
  8. Supabase Realtime fires → frontend shows "N orders created"
```

### Startup recovery

On service start, `intake-listener` queries `intake_submissions WHERE status='received'` and re-enqueues any submissions that arrived while the service was offline. Prevents silent data loss during restarts.

---

## Changes Made

### Code (PR #186 — merged 2026-03-30)

| File | Change |
|------|--------|
| `apps/agents/src/orchestration/intake-listener.ts` | **New.** Supabase Realtime subscriber: `intake_submissions` INSERT → `intake.ingest` BullMQ queue. Startup recovery of pending rows. |
| `apps/agents/src/orchestration/intake-listener.test.ts` | **New.** 5 tests: subscribe, enqueue on `received`, skip non-`received`, startup recovery, stop/unsubscribe. |
| `apps/agents/src/index.ts` | Wire `startIntakeListener` into startup/shutdown cycle. |
| `apps/agents/src/config.ts` | `ANTHROPIC_API_KEY` and `GROQ_API_KEY` → `optional()` (replaced by `OPENROUTER_API_KEY` in spec-23). |
| `apps/agents/src/config.test.ts` | Update tests to reflect new required/optional split. |
| `apps/agents/scripts/deploy.sh` | **New.** Deploy script: pull, `npm ci`, build, restart service, rollback on failure. Mirrors `apps/worker/scripts/deploy.sh`. |
| `apps/agents/deploy/aureon-agents.service` | `EnvironmentFile` corrected: `/etc/aureon/agents.env` → `/home/aureon/.env`. |
| `.github/workflows/deploy.yml` | **New job** `deploy-agents`: runs on `[self-hosted, vps]` runner, detects changes in `apps/agents/`, calls `deploy.sh`. |

### Infrastructure (manual, one-time)

| Action | Command |
|--------|---------|
| Install Redis | `apt-get install -y redis-server && systemctl enable redis-server` |
| Add `REDIS_URL` to env | Appended `REDIS_URL=redis://127.0.0.1:6379` to `/home/aureon/.env` |
| Add `OPENROUTER_API_KEY` | `sed -i 's|# OPENROUTER_API_KEY=...|OPENROUTER_API_KEY=<key>|' /home/aureon/.env` |

---

## Pending — First Deploy

The agents service has not yet been started on the VPS. Once `OPENROUTER_API_KEY` is set:

- [ ] Run first deploy: `ssh root@187.77.48.107 "sudo -u aureon bash ~/aureon-last-mile/apps/agents/scripts/deploy.sh"`
- [ ] Verify service is active: `systemctl is-active aureon-agents`
- [ ] Confirm logs look healthy: `journalctl -u aureon-agents -n 50`
- [ ] End-to-end test: submit a manifest photo from the mobile app, confirm orders appear in the DB

---

## Test Results

| Suite | Result |
|-------|--------|
| Agents (181 tests) | ✅ 181/181 passing |
| `tsc --noEmit` | ✅ Clean |
| CI (PR #186) | ✅ Passed and merged |

---

## Environment Variables Required on VPS (`/home/aureon/.env`)

| Variable | Status | Notes |
|----------|--------|-------|
| `SUPABASE_URL` | ✅ Already set | |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Already set | |
| `ENCRYPTION_KEY` | ✅ Already set | |
| `SENTRY_DSN` | ✅ Already set | |
| `REDIS_URL` | ✅ Added | `redis://127.0.0.1:6379` |
| `OPENROUTER_API_KEY` | ⏳ Pending | Must be set manually before first deploy |
