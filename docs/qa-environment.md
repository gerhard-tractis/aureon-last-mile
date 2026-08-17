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

The sync replays **both** the migration ledger and `seed-qa.sql` on every green
merge to `main`, because both are idempotent. Adding a row to the seed file is
therefore enough to get it into QA — no SSH step. (Before this, seeding ran only
in `setup-qa.sh` at provisioning time, so seed rows added later never arrived.)
Creating QA login users stays manual, in `create-qa-users.sh`.

## Port map

QA ports. All bind to localhost; nginx publishes only the frontend and Kong to
the internet (see Access below). Everything else is tunnel-only.

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

## Access

### Public URL (spec-51) — the normal way in

**https://qa.aureon.tractis.ai** — no tunnel needed. Log in with any QA user
below.

Served by nginx, which already owned 80/443 for the other `tractis.ai`
subdomains, so **no firewall port was opened**. Config lives in
`infra/supabase-qa/nginx/aureon-qa.conf`; TLS blocks are appended in place by
`certbot --nginx`.

> Both proxy blocks need `proxy_buffer_size 32k` (present in the template):
> responses carrying Supabase's chunked auth cookies exceed nginx's 4k default
> and every logged-in page load 502s with "upstream sent too big header".
> A cookie-less curl returns 200, so a naive health check won't catch it.

Two hostnames, both proxied to localhost by nginx:

| Hostname | → | Why |
|---|---|---|
| `qa.aureon.tractis.ai` | `:3200` frontend | the page you open |
| `qa-api.aureon.tractis.ai` | `:8100` Kong | `NEXT_PUBLIC_SUPABASE_URL` is compiled into the browser bundle, so the API must be reachable from the visitor's browser too |

Because that URL is baked at build time, changing it means **rebuilding the
frontend**, not just restarting it. `SUPABASE_URL` deliberately stays
`http://localhost:8100` so agents and worker talk to Kong internally instead of
looping out through the internet and back.

### SSH tunnel — still required for the admin surfaces

Studio and Bull Board are **deliberately not exposed**: they are admin surfaces
and Studio has no per-user auth.

```bash
ssh -L 8101:localhost:8101 -L 3211:localhost:3211 aureon@<VPS_IP>
```

- Studio: http://localhost:8101 (`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`)
- Bull Board: http://localhost:3211**/bull-board** (`BULL_BOARD_USER` /
  `BULL_BOARD_PASSWORD`) — note the path; the root returns 404, and an
  unauthenticated request correctly gets 401.

The frontend is still reachable at http://localhost:3200 through a tunnel if you
prefer it.

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

## DB reset — full clean rebuild

> **`docker compose down -v` does NOT wipe the database.** The Postgres data
> directory is a **bind mount** (`./volumes/db/data:/var/lib/postgresql/data`),
> not a named volume, so `-v` only removes `db-config` and `deno-cache`. An
> earlier version of this runbook claimed otherwise — following it gives you a
> database that still holds every previous row while you believe it is clean.
> The directory is `dhcpcd`-owned, mode 700, so removing it requires **root**.

Run these in order, as `aureon` except where marked:

```bash
cd /home/aureon/aureon-qa

# 1. Stop the stack (removes the two named volumes)
docker compose -f infra/supabase-qa/docker-compose.yml \
  --env-file /home/aureon/.env.qa down -v

# 2. ROOT: delete the Postgres data directory — this is the actual wipe
sudo rm -rf infra/supabase-qa/volumes/db/data

# 3. Start fresh; Postgres re-initialises via initdb + the init scripts
docker compose -f infra/supabase-qa/docker-compose.yml \
  --env-file /home/aureon/.env.qa up -d

# 4. Wait for the database, then confirm it really is empty (expect 0)
set -a; . /home/aureon/.env.qa; set +a
PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -p 5433 -U postgres -d postgres \
  -qAtX -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"

# 5. Replay every migration from the repo
SUPABASE_DB_PASSWORD=$POSTGRES_PASSWORD bash infra/supabase-qa/apply-migrations.sh

# 6. Baseline business data, then the QA logins (auth.users was wiped too)
PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -p 5433 -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -q -f packages/database/supabase/seed-qa.sql
bash infra/supabase-qa/create-qa-users.sh

# 7. Scenario data for the workflow tests
npm run seed:qa --workspace=@aureon/database -- --scenarios=all

# 8. Restart the apps — they held connections to the database you destroyed
for u in aureon-frontend-qa aureon-agents-qa aureon-worker-qa; do
  sudo -n systemctl restart "$u"
done
```

**Verify** (expect `200`, `200`, `120`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3200/
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "http://localhost:8100/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"qa-admin@qa.test","password":"QaTest123!"}'
PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -p 5433 -U postgres -d postgres \
  -qAtX -c "SELECT count(*) FROM supabase_migrations.schema_migrations"
```

`setup-qa.sh` is **not** a substitute for steps 2–8: it never removes the data
directory, and its `install_units` step needs root (see the provisioning section
above).

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
5. **Bull Board activity**: http://localhost:3211/bull-board shows queues/jobs
   (the root path 404s; without credentials it 401s).
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
> - **Never** touch UFW/firewall rules on this host (see `CLAUDE.md` — SSH
>   hardening once caused a lockout). Public access was added in spec-51 without
>   any firewall change: nginx already owned 80/443. If a port genuinely must be
>   opened, the user does it themselves.
> - **Never** expose Studio (8101) or Bull Board (3211). They stay tunnel-only.
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
