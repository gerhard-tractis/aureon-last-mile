# QA Environment Runbook (spec-48)

Operator guide for the isolated full-stack QA environment on the VPS. It mirrors the
production structure — self-hosted Supabase (Docker), Next.js frontend, agents, worker —
but its schema comes exclusively from the repo migrations, its data is dummy seed data,
and it has **zero contact with any cloud service**. Everything lives under
`/home/aureon/aureon-qa` (checkout) + `/home/aureon/.env.qa` (env) and can be destroyed
and rebuilt at will.

All artifacts referenced here live in `infra/supabase-qa/` and
`packages/database/supabase/seed-qa.sql`; CI sync is the `deploy-qa` job in
`.github/workflows/deploy.yml`.

## Port map

QA ports (all localhost-only, reached via SSH tunnel):

| Port | Service |
|------|---------|
| 8100 | Kong (Supabase API gateway — `SUPABASE_URL` for all QA apps) |
| 8101 | Supabase Studio |
| 5433 | Postgres (published directly on the `db` container) |
| 3200 | Frontend (Next.js, `aureon-frontend-qa`) |
| 3210 | Agents health endpoint (`aureon-agents-qa`) |
| 3211 | Bull Board (`aureon-agents-qa`) |
| 6379 (db 1) | Redis — shares the **prod** redis-server instance, isolated into logical db 1 (`REDIS_URL=redis://localhost:6379/1`) |

Occupied **prod** ports — never bind anything to these:

| Port | Prod service |
|------|--------------|
| 3100 | Frontend |
| 3101 | Bull Board |
| 3102 | (reserved, prod) |
| 3110 | Agents health |
| 5678 | n8n |
| 5432 | Prod Postgres |
| 6379 (db 0) | Prod Redis |

`setup-qa.sh` preflight checks the QA ports with `ss -ltn` and only tolerates them being
held by the QA stack itself (safe re-runs).

## First-time setup

Run everything as the `aureon` user on the VPS, in this exact order:

```bash
# 1. SSH in (VPS IP: ask the user / see the deployment runbook — not stored in the repo)
ssh aureon@<VPS_IP>

# 2. Clone the repo to the QA checkout location
git clone https://github.com/<owner>/<repo>.git /home/aureon/aureon-qa
cd /home/aureon/aureon-qa

# 3. Create the QA env file from the template
cp infra/supabase-qa/env.qa.example /home/aureon/.env.qa

# 4. Generate all secrets (fills every CHANGE_ME_* except OPENROUTER_API_KEY)
bash infra/supabase-qa/generate-qa-secrets.sh          # target defaults to /home/aureon/.env.qa

# 5. Manually set OPENROUTER_API_KEY in /home/aureon/.env.qa.
#    Copy it from /home/aureon/.env (prod env). This is the ONLY value that is
#    ever copied from the prod env file. NEVER copy any SUPABASE_* value.
nano /home/aureon/.env.qa

# 6. Optional but recommended: validate the env file
bash infra/supabase-qa/generate-qa-secrets.sh /home/aureon/.env.qa --verify

# 7. One-shot orchestrator: preflight -> docker stack -> migrations -> seed +
#    QA users -> npm ci + builds -> systemd units -> post-checks
bash infra/supabase-qa/setup-qa.sh
```

`setup-qa.sh` is idempotent — re-run it after any failure once the cause is fixed. Its
preflight aborts (among other things) if the env file still contains `CHANGE_ME`
placeholders or mentions `supabase.co` anywhere.

## Access (SSH tunnel — no ports are ever opened in the firewall)

```bash
ssh -L 3200:localhost:3200 -L 8100:localhost:8100 -L 8101:localhost:8101 \
    -L 3211:localhost:3211 aureon@<VPS_IP>
```

Then browse **http://localhost:3200** (frontend). Studio: http://localhost:8101
(basic-auth: `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` from `/home/aureon/.env.qa`).
Bull Board: http://localhost:3211 (`BULL_BOARD_USER` / `BULL_BOARD_PASSWORD`).

QA login users (created by `create-qa-users.sh`, password `QaTest123!` for all):

| Email | Role | Operator |
|-------|------|----------|
| qa-pickup-crew@qa.test | pickup_crew | QA Test Operator |
| qa-warehouse-staff@qa.test | warehouse_staff | QA Test Operator |
| qa-loading-crew@qa.test | loading_crew | QA Test Operator |
| qa-operations-manager@qa.test | operations_manager | QA Test Operator |
| qa-admin@qa.test | admin | QA Test Operator |
| qa-super-admin@qa.test | super_admin | internal Aureon operator |

QA operator id: `00000000-0000-4000-8000-000000000001` (fixed, seeded by `seed-qa.sql`).

## Continuous sync (CI)

The `deploy-qa` job in `.github/workflows/deploy.yml` runs on the self-hosted VPS runner
after **every green CI run of a push to main**:

- **Migrations are applied on every run** (idempotent `apply-migrations.sh`) — this is the
  drift backstop. The prod DB job is path-filtered, but QA replays the full migration
  ledger every merge, so QA can never silently fall behind the schema.
- **App rebuilds/restarts are path-filtered**: frontend / agents / worker are rebuilt and
  restarted only when their `CHANGED_*` flag is true; the edge-functions container is
  restarted when supabase functions changed.
- If QA is not provisioned on the host (checkout or env file missing), the job exits 0.
- A failure is surfaced as a `::error::` annotation ("QA is now drifted from main") but
  **never blocks the prod deploy**. To recover, run `infra/supabase-qa/deploy-qa.sh`
  manually on the VPS or just re-run `setup-qa.sh`.

## DB reset

Blow the QA database away and rebuild it from the repo:

```bash
cd /home/aureon/aureon-qa
docker compose -f infra/supabase-qa/docker-compose.yml --env-file /home/aureon/.env.qa down -v
bash infra/supabase-qa/setup-qa.sh
```

`down -v` deletes the Postgres volume; `setup-qa.sh` recreates the stack, replays all
migrations, re-applies `seed-qa.sql`, and recreates the QA users (all idempotent).

## Smoke-test checklist

Run after first setup and after any reset. This verifies the **environment**;
the workflow test plan it enables lives in `docs/qa-test-scope.md` (spec-51).

1. **Containers healthy**: `docker compose -f infra/supabase-qa/docker-compose.yml --env-file /home/aureon/.env.qa ps` — every service `running`, health `healthy` where defined.
2. **Migration count matches the repo**:
   `PGPASSWORD=<POSTGRES_PASSWORD> psql -h localhost -p 5433 -U postgres -d postgres -qAt -c "SELECT count(*) FROM supabase_migrations.schema_migrations"`
   must equal `ls packages/database/supabase/migrations/*.sql | wc -l`.
3. **Login per role**: through the tunnel, log in at http://localhost:3200 with each of the
   six `qa-*@qa.test` users.
4. **Create an order** as a QA user → row appears in `public.orders` with
   `operator_id = 00000000-0000-4000-8000-000000000001`.
5. **Bull Board activity**: http://localhost:3211 shows queues/jobs.
6. **Worker talks to QA DB**: `journalctl -u aureon-worker-qa -n 50` mentions
   `localhost:5433`, never `supabase.co`.
7. **Scenario seed applied** (spec-51): `npm run seed:qa -- --verify` reports all
   assertions passing, including the `pg_enum` drift check. Re-seed with
   `npm run seed:qa -- --scenarios=all` after a DB reset.
8. **Isolation proof** (per QA unit):
   `sudo grep -c 'supabase.co' /proc/$(systemctl show -p MainPID --value aureon-worker-qa)/environ`
   must return `0` (repeat for `aureon-agents-qa`, `aureon-frontend-qa`).

## Hard rules

> - **Never** put a `*.supabase.co` URL in `/home/aureon/.env.qa`. QA must never contact
>   the production cloud project — `setup-qa.sh`, `deploy-qa.sh`, and `create-qa-users.sh`
>   all refuse to run if one is present.
> - **Never** open UFW/firewall ports for QA. Access is SSH-tunnel only. If a port must
>   ever be opened, the user does it themselves.
> - **Never** copy prod secrets into the QA env — the single exception is
>   `OPENROUTER_API_KEY`. Everything else is generated by `generate-qa-secrets.sh`.
> - QA is **destroyable at will**: it holds only repo-derived schema and dummy data.
>   `down -v` + `setup-qa.sh` restores it completely.

## Troubleshooting

| Symptom | Command |
|---------|---------|
| App service down / crash-looping | `journalctl -u aureon-frontend-qa -n 50` (also `aureon-agents-qa`, `aureon-worker-qa`) |
| Supabase container problems | `docker compose -f infra/supabase-qa/docker-compose.yml --env-file /home/aureon/.env.qa ps` / `... logs --tail 50 <service>` |
| Env file suspect | `bash infra/supabase-qa/generate-qa-secrets.sh /home/aureon/.env.qa --verify` |
| Migrations only (preview first) | `apply-migrations.sh --dry-run`, then `SUPABASE_DB_PASSWORD=<pw> bash infra/supabase-qa/apply-migrations.sh` — hard-refuses any target other than localhost:5433 |
| Re-seed / re-create users only | `PGPASSWORD=<pw> psql -h localhost -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f packages/database/supabase/seed-qa.sql`, then `bash infra/supabase-qa/create-qa-users.sh` |
| Regenerate all secrets | `bash infra/supabase-qa/generate-qa-secrets.sh --force` (then `setup-qa.sh` to rebuild with the new values) |
| `deploy-qa` fails with `sudo: a password is required` | The CI runner cannot restart the QA systemd units — see below |
| Anything else | Re-run `bash infra/supabase-qa/setup-qa.sh` — every step is idempotent |

## First-time provisioning needs root — `setup-qa.sh` alone is not enough

**This bit the environment once already.** Until 2026-08-10 the QA app tier had
never run: `systemctl list-unit-files` showed only the production units, all
three `aureon-*-qa` services were inactive, and ports 3200/3211 were dead.
`setup-qa.sh` had been run but its `install_units` step could not have
succeeded, because that step needs root and the comment above it wrongly assumed
`aureon` already had blanket passwordless sudo for `systemctl`. The real sudoers
files (`/etc/sudoers.d/aureon-worker`, `/etc/sudoers.d/aureon-agents`) are
narrow and command-scoped — they never covered the QA units, and they certainly
never covered `cp` into `/etc/systemd/system`.

Two things are therefore required **once, as root**, on a fresh box:

```bash
# 1. Install and start the QA units (needs root: writes to /etc/systemd/system)
cd /home/aureon/aureon-qa
cp infra/supabase-qa/systemd/aureon-frontend-qa.service \
   infra/supabase-qa/systemd/aureon-agents-qa.service \
   infra/supabase-qa/systemd/aureon-worker-qa.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now aureon-frontend-qa aureon-agents-qa aureon-worker-qa
```

Build the apps first (`npm ci` at the repo root, then `npm run build` for
`@aureon/frontend`, `@aureon/agents`, `@aureon/worker`) — the units run
`dist/index.js` and `.next`, and will crash-loop without them.

```bash
# 2. Let the CI job restart those units later, without a password.
#    Validate BEFORE installing — a malformed sudoers file locks out sudo.
visudo -c -f /path/to/candidate && \
  install -m 0440 -o root -g root /path/to/candidate /etc/sudoers.d/aureon-qa
```

The installed rule (mirroring the prod files' narrow style):

```
aureon ALL=(root) NOPASSWD: /usr/bin/systemctl restart aureon-frontend-qa, \
  /usr/bin/systemctl restart aureon-agents-qa, \
  /usr/bin/systemctl restart aureon-worker-qa, \
  /usr/bin/systemctl is-active aureon-frontend-qa, \
  /usr/bin/systemctl is-active aureon-agents-qa, \
  /usr/bin/systemctl is-active aureon-worker-qa, \
  /usr/bin/journalctl -u aureon-frontend-qa *, \
  /usr/bin/journalctl -u aureon-agents-qa *, \
  /usr/bin/journalctl -u aureon-worker-qa *
```

Both are done on the current VPS. Verify with
`sudo -n -l /usr/bin/systemctl restart aureon-frontend-qa` as `aureon` — the
same probe `deploy-qa.sh`'s `guard_sudo()` uses.

Also note: `create-qa-users.sh` had not been run either, so only the migration's
system user existed and **nobody could log in**. If `SELECT count(*) FROM
public.users` returns 1, run it.

## Resolved — CI can now restart the QA app services

Historical note, kept because the symptom is distinctive. `deploy-qa.sh`
restarts the QA units with `sudo systemctl restart aureon-*-qa`. Before
`/etc/sudoers.d/aureon-qa` existed, the job failed on any push touching
`apps/frontend/**`, `apps/agents/**` or `apps/worker/**` with:

```
[...] restarting aureon-frontend-qa
sudo: a terminal is required to read the password
sudo: a password is required
```

QA's *schema* kept up to date regardless (migrations run through docker and
psql, needing no privilege), but QA's *application code* silently stopped
tracking main — so a QA app-behaviour test could be running against a stale
build without saying so.

`deploy-qa.sh` now checks this up front in `guard_sudo()` before the expensive
builds, using `sudo -n -l systemctl restart <unit>` — which asks whether that
exact command is permitted without running it. Probing with a different verb
(`is-active`) would report a failure that is not real once a command-scoped
rule exists.
