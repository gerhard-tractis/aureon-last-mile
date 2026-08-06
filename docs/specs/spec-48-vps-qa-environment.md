# Spec 48 — VPS QA Environment (Self-Hosted Supabase + Full QA Stack)

**Status:** backlog

## Goal

A complete, isolated QA environment on the VPS (187.77.48.107) that mirrors production: a self-hosted Supabase stack (structure-only, built from the repo's migrations), a QA frontend, and QA instances of aureon-agents and aureon-worker. Used for end-to-end testing of every feature with dummy data — zero contact with the cloud (production) Supabase project.

## Decisions (from brainstorming)

- **Stack:** Official Supabase self-hosted Docker Compose (Option A), pinned versions, under `/home/aureon/supabase-qa/`.
- **Data:** Structure only — apply all repo migrations from `packages/database/supabase/migrations/`. Dummy data via a committed `seed-qa.sql`. No production data ever.
- **Secrets:** Freshly generated QA-only JWT secret, anon/service keys, and Postgres password. Cloud keys are never copied to the QA env.
- **Full stack QA:** QA frontend + QA agents + QA worker on the VPS. Existing n8n is reused with manual triggers only (no second n8n).
- **Access:** SSH tunnel by default; no UFW changes (user opens ports later if teammates need direct access).
- **Process model:** systemd units, mirroring how prod services run on the VPS (`aureon-agents.service` pattern).
- **No Supabase CLI on the VPS:** migrations are applied with a plain sorted `psql -f` loop + inserts into `supabase_migrations.schema_migrations`, so no prod-capable tooling is added to the box.

## Port Map

QA ports (verified free before install):

| Service | Port |
|---|---|
| QA Kong (Supabase API gateway) | 8100 |
| QA Studio | 8101 |
| QA Postgres (direct) | 5433 |
| QA frontend (Next.js) | 3200 |
| QA agents health | 3210 (requires new `HEALTH_PORT` env var — Task 1) |
| QA agents bull-board | 3211 (requires `BULL_BOARD_PORT` env var — Task 1) |
| Redis | reuse existing instance on 6379, **DB index 1** (agents only) |

Existing occupied ports (do not disturb): 3100, 3101, 3102, 3110, 5678, **5432** (native Postgres used by n8n — the reason QA Postgres is on 5433), **6379** (Redis).

## Architecture

```
Browser (SSH tunnel :3200, :8100)
  │
  ├─► QA frontend (systemd: aureon-frontend-qa, port 3200)
  │       └─► QA Kong :8100 ──► Auth / PostgREST / Realtime / Storage ──► QA Postgres :5433
  ├─► QA agents  (systemd: aureon-agents-qa, EnvFile /home/aureon/.env.qa)
  │       ├─► QA Kong :8100 (Supabase JS client, service role)
  │       └─► Redis :6379 DB 1 (BullMQ queues)
  └─► QA worker  (systemd: aureon-worker-qa, EnvFile /home/aureon/.env.qa)
          └─► QA Postgres :5433 DIRECTLY (node-cron + pg; no Redis — SUPABASE_DB_* vars)
```

- QA code lives in a **separate checkout** `/home/aureon/aureon-qa/` (frontend `NEXT_PUBLIC_*` vars are baked at build time, so QA needs its own build).
- Canonical env file: **`/home/aureon/.env.qa`** — single file consumed by docker compose (`--env-file /home/aureon/.env.qa`), all three systemd units (`EnvironmentFile=`), and the frontend build (`set -a; source ...`). Port variables (`KONG_HTTP_PORT=8100`, etc.) live in this file, not hardcoded in the compose.
- All QA services restart on reboot (`unless-stopped` / `WantedBy=multi-user.target`).

## Repo Deliverables

| Path | Responsibility |
|---|---|
| `infra/supabase-qa/docker-compose.yml` | Vendored official Supabase compose, pinned images, QA ports via env |
| `infra/supabase-qa/env.qa.example` | Template for ALL QA env vars (compose + frontend + agents + worker), placeholder secrets |
| `infra/supabase-qa/generate-qa-secrets.sh` | Generates every secret in `.env.qa` (JWT, keys, passwords, ENCRYPTION_KEY, bull-board creds) |
| `infra/supabase-qa/apply-migrations.sh` | Sorted psql loop over repo migrations + schema_migrations bookkeeping |
| `infra/supabase-qa/create-qa-users.sh` | Creates QA auth users per role via GoTrue admin API |
| `infra/supabase-qa/systemd/aureon-frontend-qa.service` | QA frontend unit |
| `infra/supabase-qa/systemd/aureon-agents-qa.service` | QA agents unit |
| `infra/supabase-qa/systemd/aureon-worker-qa.service` | QA worker unit |
| `infra/supabase-qa/setup-qa.sh` | VPS-side orchestrator (assumes repo already cloned; does NOT clone) |
| `packages/database/supabase/seed-qa.sql` | Dummy business data (operator, drivers, hub, routes, orders) |
| `docs/qa-environment.md` | Runbook: setup, tunnel commands, reset procedure, smoke-test checklist |

Plus one code change: `apps/agents` health + bull-board ports become env-configurable (prod defaults unchanged).

## Error Handling / Safety

- `setup-qa.sh` preflight: free RAM ≥ 3 GB, disk ≥ 10 GB, all QA ports free, `docker` + `psql` + `node` present. If docker/psql are missing, **stop and ask the user** — never install system packages unprompted.
- Guard: abort if `.env.qa` contains `supabase.co` anywhere (prevents pointing any QA service at prod).
- `apply-migrations.sh` validates its target is `localhost:5433` before touching anything.
- Worker's `SUPABASE_DB_HOST/PORT/PASSWORD` must be `localhost`/`5433`/QA password — checked by the same guard.
- No UFW/SSH/fail2ban changes of any kind.

## Verification (E2E smoke test)

1. All Supabase containers healthy (`docker compose ps`).
2. Applied migration count equals `ls packages/database/supabase/migrations/*.sql | wc -l` (117 at spec time; use the live count).
3. Login via QA frontend with seeded QA user (each role).
4. Create an order/delivery in the UI → row appears in QA Postgres with correct `operator_id`.
5. Agents: bull-board on 3211 shows QA queue activity; worker: journal shows cron runs against `localhost:5433`.
6. Isolation proof: for each QA unit, inspect the live process env (`systemctl show -p Environment` is empty for `EnvironmentFile=` units): `cat /proc/$(systemctl show -p MainPID --value aureon-agents-qa)/environ | tr '\0' '\n' | grep -c supabase.co` must be 0 (same for worker/frontend), plus `grep -c supabase.co /home/aureon/.env.qa` = 0.

---

# Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the QA environment described above, fully reproducible from the repo.

**Architecture:** Repo-side artifacts first (code change, compose, scripts, seed, units, docs) delivered via PR; then VPS-side execution over SSH using those artifacts.

**Tech Stack:** Docker Compose, Supabase self-hosted images, systemd, Bash, psql, SQL.

## Chunk 1: Repo artifacts

### Task 1: Make agents ports env-configurable (TDD)

**Files:** Modify `apps/agents/src/index.ts` (health port, currently hardcoded 3110), `apps/agents/src/orchestration/bull-board.ts` (currently hardcoded `BULL_BOARD_PORT = 3101`). Test: alongside existing agents tests (vitest).

- [ ] Write failing tests: `HEALTH_PORT` env overrides health port, defaults to 3110; `BULL_BOARD_PORT` env overrides, defaults to 3101.
- [ ] Run tests, confirm failure. Implement: read from `process.env` with the current values as defaults. Run tests, confirm pass. Run the full agents test suite.
- [ ] Commit: `feat(agents): make health and bull-board ports env-configurable`

### Task 2: Vendor the Supabase compose file

**Files:** Create `infra/supabase-qa/docker-compose.yml`, `infra/supabase-qa/env.qa.example`

- [ ] Download the official compose from `github.com/supabase/supabase/tree/master/docker`, pinned to the latest release tag at implementation time (record tag in a header comment).
- [ ] Remove `analytics` (Logflare), `vector`, and `supavisor` services **and strip every `depends_on: analytics` condition and Logflare env var from the remaining services** — deleting only the service blocks leaves a stack that never starts.
- [ ] Ports come from env: Kong `${KONG_HTTP_PORT}:8000` (8100), Studio `${STUDIO_PORT}:3000` (8101), Postgres `${POSTGRES_PORT}:5432` (5433). `restart: unless-stopped` everywhere; compose project name `supabase-qa`.
- [ ] Build `env.qa.example` from the official `.env.example` plus every var the apps need, ALL pointing at QA endpoints:
  - Frontend: `NEXT_PUBLIC_SUPABASE_URL=http://localhost:8100`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=`, `SUPABASE_SERVICE_KEY=`
  - Agents (check `apps/agents/.env.example` + `src/config.ts` for the full required list): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (note: NOT `SUPABASE_SERVICE_KEY` — agents require the `_ROLE_` name), `REDIS_URL=redis://localhost:6379/1`, `HEALTH_PORT=3210`, `BULL_BOARD_PORT=3211`, `BULL_BOARD_USER/PASSWORD`, `ENCRYPTION_KEY`, `SENTRY_DSN` (may be empty/QA project), `OPENROUTER_API_KEY`
  - Worker (check `apps/worker/.env.example`): `SUPABASE_DB_HOST=localhost`, `SUPABASE_DB_PORT=5433`, `SUPABASE_DB_PASSWORD=` (QA generated), plus any others it requires
- [ ] Verify: `docker compose -f infra/supabase-qa/docker-compose.yml --env-file <copy of example> config` exits 0.
- [ ] Commit: `feat(qa): vendor pinned supabase self-hosted compose with QA ports`

### Task 3: Secret generation script

**Files:** Create `infra/supabase-qa/generate-qa-secrets.sh`

- [ ] Generates into `/home/aureon/.env.qa` (path overridable via arg; created from `env.qa.example` if absent): 40-char JWT secret; anon + service-role JWTs signed with it (HS256, `role` claim, 10-year expiry, via a `node -e` one-liner — node exists on the VPS); Postgres password; Studio dashboard password; `ENCRYPTION_KEY`; `BULL_BOARD_USER`/`BULL_BOARD_PASSWORD`. Both `SUPABASE_SERVICE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` get the same service JWT. **All generated values must be strictly alphanumeric (hex/base64url — no `$`, quotes, spaces, `#`)** because `.env.qa` is parsed by three different parsers: docker compose, systemd `EnvironmentFile=`, and bash `source`. Idempotent: refuses to overwrite non-placeholder secrets unless `--force`.
- [ ] `--verify` mode decodes the generated JWTs against the generated secret and checks role claims.
- [ ] Test: run against a scratch copy locally (Git Bash), then `--verify`. `bash -n` clean.
- [ ] Commit: `feat(qa): QA secret generator`

### Task 4: Migration applier

**Files:** Create `infra/supabase-qa/apply-migrations.sh`

- [ ] Refuses to run unless target host:port is `localhost:5433` (or `127.0.0.1:5433`). Applies `packages/database/supabase/migrations/*.sql` in sorted filename order via `psql -v ON_ERROR_STOP=1 -f`, skipping versions already present in `supabase_migrations.schema_migrations` (create the schema/table if missing, matching the CLI's layout: `version`, `name`, `statements`), inserting a row after each success. Prints applied/skipped/total counts; exits non-zero on first failure.
- [ ] Test: `bash -n`; dry-run mode (`--dry-run`) lists what would apply.
- [ ] Commit: `feat(qa): idempotent migration applier for QA postgres`

### Task 5: seed-qa.sql + QA users script

**Files:** Create `packages/database/supabase/seed-qa.sql`, `infra/supabase-qa/create-qa-users.sh`

- [ ] Study current `seed.sql` (operators only — it contains NO auth.users pattern) and 2–3 recent migrations for table shapes. `seed-qa.sql` seeds business data only: 1 operator (`QA Test Operator`, fixed UUID), 2 drivers, 1 hub, 2 routes, 5 orders with packages across statuses. Every row carries the QA `operator_id`.
- [ ] `create-qa-users.sh` creates one user per role via the GoTrue admin API (`POST http://localhost:8100/auth/v1/admin/users` with the QA service key, `email_confirm: true`, password `QaTest123!`, role/operator metadata matching what the app's RLS expects — verify claim shape against the auth migration `20260209000001_auth_function.sql` and related RLS policies), then inserts any required profile/membership rows via psql.
- [ ] Test: apply `seed-qa.sql` against a local scratch stack (`supabase start` locally or a temp Docker Postgres with migrations applied) — completes without FK/constraint errors.
- [ ] Commit: `feat(qa): dummy seed data and QA user creation`

### Task 6: systemd units + setup orchestrator

**Files:** Create `infra/supabase-qa/systemd/aureon-frontend-qa.service`, `aureon-agents-qa.service`, `aureon-worker-qa.service`, `infra/supabase-qa/setup-qa.sh`

- [ ] Units modeled on `apps/agents/deploy/aureon-agents.service`: `WorkingDirectory=/home/aureon/aureon-qa/apps/<app>`, `EnvironmentFile=/home/aureon/.env.qa`, distinct `SyslogIdentifier` (`aureon-*-qa`). Frontend: `ExecStart=/usr/bin/node node_modules/.bin/next start -p 3200`. Agents/worker: `ExecStart=/usr/bin/node dist/index.js`.
- [ ] `setup-qa.sh` (runs on VPS; **assumes `/home/aureon/aureon-qa` is already cloned and `/home/aureon/.env.qa` already generated** — it does not clone or create secrets):
  1. Preflight: RAM/disk/QA-ports free; `docker`, `psql`, `node` present — if missing, print what's missing and exit (the operator asks the user; no unprompted system installs).
  2. Guard: `grep -q supabase.co /home/aureon/.env.qa && abort`.
  3. `docker compose -f .../docker-compose.yml --env-file /home/aureon/.env.qa up -d`; poll until all containers healthy (timeout 5 min).
  4. `apply-migrations.sh`, then `psql -f seed-qa.sql`, then `create-qa-users.sh`.
  5. Build apps in `/home/aureon/aureon-qa`: `npm ci`; frontend build with env baked in: `set -a; source /home/aureon/.env.qa; set +a; npm run build` (NEXT_PUBLIC_* are build-time); agents/worker: their build scripts.
  6. Install units to `/etc/systemd/system/`, `daemon-reload`, `enable --now` all three; print status summary.
- [ ] Test: `bash -n` (and shellcheck if available) on all scripts.
- [ ] Commit: `feat(qa): VPS setup orchestrator and systemd units`

### Task 7: Runbook

**Files:** Create `docs/qa-environment.md`

- [ ] Document: purpose, full port map (incl. occupied prod ports), first-time setup order (clone → generate secrets → fill OPENROUTER key → setup-qa.sh), SSH tunnel one-liner (`ssh -L 3200:localhost:3200 -L 8100:localhost:8100 aureon@<VPS-IP>`), DB reset procedure (`docker compose down -v` → re-run setup), smoke-test checklist, and the hard rule: QA services must never contain a `supabase.co` URL.
- [ ] Commit: `docs(qa): QA environment runbook`

### Task 8: PR

- [ ] Push branch `feat/spec-48-qa-environment`; `gh pr create`; `gh pr merge --auto --squash` (mandatory). Wait for CI + merge (`gh pr checks`, `gh pr view --json state,mergedAt`) before Chunk 2.

## Chunk 2: VPS execution

### Task 9: Prepare and deploy

- [ ] SSH to VPS (`connect-to-vps` skill). First time: `git clone <repo> /home/aureon/aureon-qa`; afterwards `git -C /home/aureon/aureon-qa pull`.
- [ ] `cp .../env.qa.example /home/aureon/.env.qa`; run `generate-qa-secrets.sh`; copy `OPENROUTER_API_KEY` from `/home/aureon/.env` (external service — acceptable to share; never copy SUPABASE_* values from that file).
- [ ] Run `setup-qa.sh`; capture full output. If preflight fails (RAM/missing tools), stop and report to the user with options.
- [ ] Verify: containers healthy; migration count matches repo count; `curl` login against `http://localhost:8100/auth/v1/token?grant_type=password` with a QA user succeeds.

### Task 10: E2E smoke test

- [ ] Run the smoke-test checklist from the spec (tunnel, login per role, create delivery, bull-board 3211 activity, worker journal, effective-env isolation proof).
- [ ] Report results with evidence. Update `docs/sprint-status.yaml`; spec status `in progress` → user confirms → `completed`.
