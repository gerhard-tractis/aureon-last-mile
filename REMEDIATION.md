# Remediation Plan — Aureon Last Mile

**Audit date:** 2026-07-29
**Tier:** Platform (multi-tenant, 4 apps + sidecar + n8n, production VPS, real customers)
**Overall health:** Strong engineering discipline in the newest slices (spec-45/47 SQL, agents app, Sentry wiring, migration template discipline) undermined by a live secret leak in a public repo, an ungated deploy pipeline, a non-reproducible database, and single-tenant assumptions hardcoded into a platform that is about to onboard tenant #2.

---

## ⚠️ Tier mismatch detected

The repo has **platform-grade architecture rules** (operator_id everywhere, RLS on 55/55 tables) but **single-tenant reality bolted on top**: `MUSAN_OPERATOR_ID` is hardcoded in both DispatchTrack edge functions and all four n8n workflow JSONs, and `whatsapp-webhook` assigns every inbound message to whichever operator row Postgres returns first. Onboarding a second operator today would silently write their data into Musan's tenant. The tenant-resolution upgrade path is item C6 below and must land before any second-operator go-live.

---

## 🔴 Critical

### C1. Live production credentials committed to a PUBLIC repo — rotate everything first
**What's wrong:** `gh repo view` shows `gerhard-tractis/aureon-last-mile` is **public**. Tracked files contain, in cleartext and in git history:
- Supabase `service_role` JWT (project `wfwlcpnkkxxzdvhvvsxb`, exp 2036): `scripts/backfill-dispatches.mjs:13`, `scripts/backfill-dispatches-by-order.mjs:13`, `scripts/sync-pending-orders.mjs:13`, `scripts/backfill-paris-packages.mjs:9` (fallback default), and 14 occurrences inside `apps/worker/n8n/workflows/beetrack-excel-import.json`
- Supabase Management token `sbp_42e2…` in **9 files** under `apps/frontend/scripts/` (`check-auth-hook.js:4`, `execute-via-mgmt-api.js:11`, `validate-rbac.js:9`, etc.)
- A **second** management token `sbp_9f10…` and a **never-expiring n8n public-API JWT** for `https://n8n.tractis.ai` in tracked `.mcp.json:9,17`
- DispatchTrack API key `998d33…` in the three `scripts/backfill-*/sync-*` files
- A real login `gerhard@tractis.ai` / `Tractis01` in `apps/frontend/e2e/branding.spec.ts:3-4`
- VPS IP + a written inventory of its weak SSH/UFW posture in `CLAUDE.md:23`, `.claude/commands/connect-to-vps.md:9`, several docs

**Why it matters:** anyone on the internet has full RLS-bypass on the production DB, account-level Supabase management control, full n8n workflow/credential control, and the customer's DispatchTrack account. Treat all of these as already compromised.

**Steps:**
- [ ] Rotate, in this order, **before touching code**: Supabase `service_role` key, both `sbp_` personal access tokens, the n8n API key, the DispatchTrack API key, and the `gerhard@tractis.ai` password (enable MFA).
- [ ] Make the repo private (Settings → Danger Zone), or if it must stay public, purge history with `git filter-repo` — rotation still comes first either way.
- [ ] Add `.mcp.json` to `.gitignore`; `git rm --cached .mcp.json`; create `.mcp.json.example` with placeholders.
- [ ] Rewrite the four `scripts/*.mjs` to read `process.env.SUPABASE_SERVICE_ROLE_KEY` / `DISPATCHTRACK_API_KEY` with a hard failure when unset (no `||` fallback literals).
- [ ] Strip credentials from `apps/worker/n8n/workflows/beetrack-excel-import.json` (n8n credential references, not inline headers); re-export.
- [ ] Move e2e credentials to `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` env vars; create a dedicated non-privileged test account.
- [ ] Remove the VPS IP + security posture from `CLAUDE.md` and tracked docs (keep in a private runbook).
- [ ] Verify: `git grep -IE 'sbp_[a-f0-9]{40}|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9|998d3378|Tractis01|187\.77\.48\.107'` returns nothing.

### C2. Production deploys are not gated on CI, and migration failure doesn't stop the frontend
**What's wrong:** `.github/workflows/deploy.yml:3-5` triggers on `push: [main]` and runs **in parallel** with `ci.yml` — a red build still deploys. Separately, Vercel's Git integration deploys every main commit **outside** Actions (acknowledged at `deploy.yml:129-134`), so when `deploy-supabase` fails, the new frontend still ships against the old schema; the auto-rollback at `deploy.yml:154-158` never fires for that path.
**Why it matters:** failing tests deploy to production; a failed migration produces live code/schema skew with no rollback.
**Steps:**
- [ ] Gate deploys on CI: convert `deploy.yml` to `on: workflow_run: workflows: ["CI"], types: [completed], branches: [main]` with `if: github.event.workflow_run.conclusion == 'success'` (or merge CI jobs into deploy.yml as `needs:`).
- [ ] Disable Vercel's Git auto-deploy for production (`vercel.json` `"git": {"deploymentEnabled": {"main": false}}` or dashboard) and make the `deploy-vercel` job run on **every** main push, ordered after migrations, not only when DB paths changed.
- [ ] Tighten branch protection: enable `enforce_admins`, require 1 PR review, keep `strict` status checks. (`docs/ci-cd-architecture.md:166-169` already claims this — make it true.)
- [ ] Verify: push a branch with a failing test → merge attempt blocked; check a main deploy run shows `deploy-vercel` executed after `deploy-supabase` on a frontend-only change.

### C3. The database is not reproducible from the repo
**What's wrong:** the foundational migration is disabled — `packages/database/supabase/migrations/20260209_multi_tenant_rls.sql.bak` is the **only** place `public.operators` and `public.audit_logs` are created (18 later migrations FK-reference `operators`). `config.toml:45-50` enables seeding from `./seed.sql`, which **does not exist**. `supabase db reset` / any fresh environment fails at the first FK migration.
**Why it matters:** no local dev reset, no staging environment possible (a stated project goal), and disaster recovery depends on the production instance never being lost.
**Steps:**
- [ ] Convert the `.bak` into a properly timestamped migration that sorts **before** `20260216170542_create_users_table_with_rbac.sql` (guard with `CREATE TABLE IF NOT EXISTS` so prod, where the tables already exist, is a no-op).
- [ ] Create `packages/database/supabase/seed.sql` (even minimal: one operator, one admin user) or set `[db.seed] enabled = false`.
- [ ] Delete `packages/database/supabase/migrations_for_old/`; rewrite `migrations/README.md` (currently instructs hand-pasting one file and is ~115 migrations stale).
- [ ] Verify: `supabase db reset` completes cleanly on a fresh local stack.

### C4. Cross-tenant data leak: SECURITY DEFINER RPC trusts caller-supplied operator_id
**What's wrong:** `get_active_routes_with_dispatches(p_operator_id, p_route_date)` (`packages/database/supabase/migrations/20260310000004_get_active_routes_with_dispatches.sql:7-62`) is `SECURITY DEFINER`, granted to `authenticated`, and filters only on the UUID **the caller passes**. Same pattern in `get_unmatched_comunas` (`20260321000001_chile_comunas_normalization.sql:487-499`).
**Why it matters:** any logged-in user of any tenant can read another tenant's routes, dispatches, customer coordinates, and driver names by passing a different UUID.
**Steps:**
- [ ] New migration (using the latest definition as template per house rule): either make both functions `SECURITY INVOKER` (RLS already isolates) or add `IF p_operator_id IS DISTINCT FROM public.get_operator_id() THEN RAISE EXCEPTION` at the top.
- [ ] Add a pgTAP test in `packages/database/supabase/tests/` asserting a user of operator A calling with operator B's UUID gets an exception/empty set.
- [ ] Verify: run the SQL test suite; manually call the RPC with a foreign UUID as an authenticated test user.

### C5. Webhook/service endpoints that fail open or ship default credentials
**What's wrong:**
- `packages/database/supabase/functions/beetrack-webhook/index.ts:74-80` — if `BEETRACK_WEBHOOK_SECRET` is unset, **all auth is skipped** on a `verify_jwt=false` public endpoint that can set any order to `entregado`/`cancelado`.
- `apps/agents/src/lib/health.ts:53-59` — same fail-open shape for `POST /api/ocr-extract` (burns the OpenRouter key).
- `apps/agents/src/index.ts:76-77` — Bull Board on `0.0.0.0:3101` defaults to `admin`/`changeme` when env vars are unset (and they're not in the zod schema, so nothing catches it).
- `apps/agents/src/dev/index.ts:45` — dev endpoints (order purge, state editor) are gated **only** on `ENABLE_DEV_ENDPOINTS`, not `NODE_ENV`, despite the docstring promising both.
- `packages/database/supabase/functions/dispatchtrack-route-poll/index.ts:16-29` — no auth beyond any-valid-JWT (anon works); each call fans out N outbound DispatchTrack requests.
- `apps/frontend/src/app/api/ocr-test/route.ts:44` — unauthenticated internet-facing route driving paid Gemini spend; `middleware.ts` only guards `/app/**`.

**Why it matters:** one missing env var turns production write paths and paid APIs into open endpoints on a VPS whose IP was published (C1).
**Steps:**
- [ ] Invert the fail-open checks: when the secret env var is missing, return 500/refuse to start — `beetrack-webhook/index.ts:75`, `agents/src/lib/health.ts:53`.
- [ ] Add `BULL_BOARD_USER`/`BULL_BOARD_PASSWORD` (required, `min(8)`) to the zod schema in `apps/agents/src/config.ts`; delete the `?? 'changeme'` fallback; bind Bull Board to `127.0.0.1`.
- [ ] Add the promised `NODE_ENV !== 'production'` guard in `apps/agents/src/dev/index.ts`.
- [ ] Add a shared-secret header check to `dispatchtrack-route-poll`.
- [ ] Require an authenticated admin session (or delete the route) for `/api/ocr-test`; same review for `/api/test-sentry/route.ts:28` (hardcoded fallback secret, self-labeled "remove after testing").
- [ ] Also fix while in there: `apps/agents/src/config.ts:47-56` swallows validation errors and returns `null as unknown as Config` — let it throw with the missing-var list.
- [ ] Verify: unset each secret locally → service refuses to start / endpoint returns 5xx, not 200.

### C6. Multi-tenancy is hardcoded to one customer (blocks tenant #2)
**What's wrong:** `MUSAN_OPERATOR_ID` is a constant in `beetrack-webhook/index.ts:13`, `dispatchtrack-route-poll/index.ts:12`, all four n8n workflow JSONs, and `scripts/*.mjs`. `apps/frontend/supabase/functions/whatsapp-webhook/index.ts:118-126` resolves the operator with an unordered `.from('operators').select('id').limit(1)` — the phone argument is ignored.
**Why it matters:** the moment operator #2 exists, their webhook data lands in Musan's tenant and WhatsApp messages get attached to an arbitrary operator — a data-mingling incident, not a bug.
**Steps:**
- [ ] Design tenant resolution per ingress: map webhook URL token / API key / WhatsApp phone-number-id → `operator_id` (a `connector_configs`-style lookup table already fits the existing `tenant_clients` pattern).
- [ ] Replace the constants in both edge functions and parameterize the n8n workflows (per-tenant credential/config, not per-tenant JSON copies).
- [ ] Implement `resolveOperatorId` in `whatsapp-webhook` using the receiving phone number; fail (202-and-log, not misfile) when unmapped.
- [ ] Verify: seed a second operator locally, replay a Beetrack payload and a WhatsApp message for each tenant, confirm rows land under the correct `operator_id`.

---

## 🟡 High

### H1. WhatsApp webhook edge function can never deploy
**What's wrong:** it lives at `apps/frontend/supabase/functions/whatsapp-webhook/`, but `deploy.yml:35-47`'s `edge_functions` filter only watches `packages/database/supabase/functions/**`. Edits deploy nothing, silently.
**Steps:**
- [ ] Move the function to `packages/database/supabase/functions/whatsapp-webhook/` (consolidating all edge functions in one tree) and delete the orphan location.
- [ ] Verify: touch the function in a PR → the `deploy-edge-functions` job runs.

### H2. Green CI is a false signal for 3 of 4 apps
**What's wrong:** mobile stubs everything (`apps/mobile/package.json:10-13`: `type-check`/`test` are `echo`), worker tests are disabled with an admission of pre-existing failures (`apps/worker/package.json:16`), agents/worker have no linter, and the deployed Python solver's 309-line test suite is never run (no Python job in `ci.yml`).
**Steps:**
- [ ] Worker: run `npm test -w @aureon/worker`, fix the failures, restore `"test:run": "vitest run"`.
- [ ] Mobile: wire real `"type-check": "tsc --noEmit"`; add at least smoke tests for `intake.tsx` logic; add an Expo build/EAS check or consciously document mobile as out-of-CI.
- [ ] Add a `solver-tests` job to `ci.yml` (setup-python 3.11, `pip install -r requirements.txt`, `pytest sidecar/or-tools`).
- [ ] Add ESLint to worker + agents.
- [ ] Verify: introduce a deliberate type error in mobile → CI goes red.

### H3. No backup/restore runbook; audit-log purge hard-deletes the compliance trail
**What's wrong:** `docs/runbooks/` has no restore procedure; NFR-R6 (`docs/epics.md:320-323`: monthly restore test, 2h RTO) is unimplemented. Meanwhile `archive_old_audit_logs()` (`20260217000001_...partitioning.sql:307`) does `DELETE FROM audit_logs` with a TODO where the S3 export should be — against a stated 7-year Chilean retention requirement.
**Steps:**
- [ ] Write `docs/runbooks/restore-database.md` (Supabase PITR/backup path, RPO/RTO, verification query set) and schedule the monthly restore test.
- [ ] Neuter `archive_old_audit_logs()` (RAISE EXCEPTION 'export not implemented') until export-before-delete exists; confirm it is not scheduled in pg_cron.
- [ ] Verify: perform one restore drill to a branch/staging project and record the result.

### H4. SaaS-template residue is live in production (including an anon-writable table)
**What's wrong:** `todo_list` table (`20250130181641_todo_list.sql`) grants **TRUNCATE to anon** (`:33`); `/app/table` and `/app/storage` pages (646 lines, `app/app/table/page.tsx`, `app/app/storage/page.tsx`, `lib/supabase/unified.ts:60-105`) ship a to-do app and generic file-share (24h public signed URLs) inside the authenticated product. Mobile has the same residue: `tasks.tsx`, `storage.tsx`, and a stale `lib/types.ts` whose only table is `todo_list`.
**Steps:**
- [ ] Migration: `DROP TABLE public.todo_list` (or revoke all + soft-deprecate if data exists — check first).
- [ ] Delete the frontend pages + `getMyTodoList/createTask/removeTask/updateAsDone` from `unified.ts`; delete mobile `tasks.tsx`, `storage.tsx`, `lib/types.ts` (point mobile at `@aureon/database`, which it already declares but never imports).
- [ ] Also gate or delete the shipped dev scaffolding: `/app/dev/wismo-test`, `/app/ocr-test` (not matched by `middleware.ts`).
- [ ] Verify: `git grep -i todo_list` → only migration history; `/app/table` returns 404.

### H5. Half-migrated automation: worker src abandoned, solver deployed but never called
**What's wrong:** `apps/worker/src/` is untouched since 2026-03 and duplicates the now-active n8n ingestion (`csv-email.ts` vs `easy-csv-import.json`); the OR-Tools solver (`sidecar/or-tools/`) deploys to the VPS but **nothing calls it** — the `assignment.optimize` BullMQ queue has cron schedulers enqueueing at 06:00/14:00 but **no registered handler** (`apps/agents/src/index.ts:65-68` vs `orchestration/queues.ts:7,22`). The n8n alerting workflow `operational-alerting.json` has `active: null` (not enabled).
**Steps:**
- [ ] Decide per component: wire it or delete it. Recommended: delete `apps/worker/src/connectors/csv-email.ts` (+tests) as superseded; either register an `assignment.optimize` handler that POSTs to `127.0.0.1:8090/api/v1/optimize` or remove the queue + schedulers + solver deploy job.
- [ ] Stop the zombie cron enqueue immediately (remove `assignment.optimize` from `schedulers.ts`) — jobs are piling into a queue nobody drains.
- [ ] Activate `operational-alerting` in n8n or delete the JSON.
- [ ] Verify: `git grep assignment.optimize` shows a handler or nothing; Bull Board shows no unconsumed queue.

### H6. audit_trigger_failures RLS is world-open + stored XSS in the audit viewer
**What's wrong:** `20260217000002_fix_audit_logging_critical_issues.sql:96-105` — INSERT `WITH CHECK (true)` and SELECT `USING (true)` with no `TO` clause: any user can flood it and read cross-tenant error payloads. Downstream, `apps/frontend/src/components/audit/AuditLogDetailRow.tsx:20-49` injects unescaped JSON via `dangerouslySetInnerHTML` (line 47); audited payloads originate from unauthenticated webhooks → stored XSS in an admin session.
**Steps:**
- [ ] Migration: restrict both policies (`TO service_role` for insert; operator-scoped admin read).
- [ ] Escape `<`, `>`, `&` in `highlightJson()` before markup insertion (or render with a tokenizer instead of regex + `dangerouslySetInnerHTML`); add a test with `<img src=x onerror=…>` in a payload.
- [ ] Verify: pgTAP policy test + component test pass.

### H7. Frontend tenant/layering discipline erodes in the pickup slice
**What's wrong:** ~28 queries omit the explicit `operator_id` filter (relying on RLS alone), concentrated in `hooks/pickup/useDiscrepancies.ts:29-118`, `hooks/pickup/usePickupScans.ts:34,72,90`, `hooks/distribution/useDockZones.ts:74-108`, `lib/pickup/scan-validator.ts:22-101`, `hooks/useOrders.ts:41` (insert), etc. 12 app pages query Supabase directly (`app/app/pickup/page.tsx:131,137` and the whole pickup route tree), and 3 components hold their own SPA client (`QuickSortScanner.tsx:69`, `RouteQRScannerEntry.tsx:56`, `ManualOrderForm.tsx:115`). Several use `(client as any)` casts, defeating generated types.
**Steps:**
- [ ] Add explicit `.eq('operator_id', …)` to the 28 listed queries (defense-in-depth per house rule); remove the `as any` casts by regenerating/aligning types.
- [ ] Extract the pickup-slice page queries into hooks (`hooks/pickup/`), matching the pattern the rest of the app already follows.
- [ ] Add an ESLint boundary rule (e.g. `no-restricted-imports` / eslint-plugin-boundaries) forbidding `@/lib/supabase` imports from `app/**` pages and `components/**`.
- [ ] Verify: lint rule fails on a seeded violation; `git grep -l "createSPAClient" apps/frontend/src/app apps/frontend/src/components` shrinks to the auth-only set.

### H8. One schema, four type sources
**What's wrong:** `packages/database` (the real generated types) is imported by **only** `apps/frontend`… except frontend actually uses its own `src/lib/types.ts` (2192 lines) — generated output with **hand-written types appended at lines 2152-2192** that the next `supabase gen types` will wipe. Mobile declares `@aureon/database` and imports nothing. 8 type names are defined twice in frontend (`ScanResult` with **different shapes**: `lib/dispatch/types.ts:40` vs `lib/pickup/scan-validator.ts:3`).
**Steps:**
- [ ] Make `packages/database` the single source: move the 4 hand-written types (`PreRoute*`) into a separate file, point frontend imports at `@aureon/database`, delete `src/lib/types.ts` generated body.
- [ ] Adopt it in agents/worker/mobile (all talk to the same DB).
- [ ] Deduplicate the 8 double-defined type names; rename one of the two `ScanResult`s.
- [ ] Verify: `type-check` passes repo-wide; `git grep "from '@/lib/types'"` count drops to ~0.

### H9. Documentation actively lies about the pipeline
**What's wrong:** `.github/workflows/README.md:22-24` claims "Deployment is MANUAL" (everything auto-deploys); `docs/ci-cd-architecture.md` describes 4 CI jobs, PR reviews, linear history, and a Vercel action that don't exist, and omits 4 of the 6 deploy targets; `apps/frontend/docs/deployment-runbook.md:342-408` documents a Railway/`apps/backend` path that was never built; `apps/worker/README.md` calls `src/index.ts` a placeholder; `apps/agents` and `sidecar/` have **no README at all**; agents docs give the wrong env-var name (`SUPABASE_SERVICE_KEY` vs required `SUPABASE_SERVICE_ROLE_KEY`, `docs/architecture/agents.md:216`) and wrong secrets path.
**Steps:**
- [ ] Rewrite `.github/workflows/README.md` and `docs/ci-cd-architecture.md` to match `deploy.yml` reality (or delete and link to the workflow files).
- [ ] Delete the Railway section from the deployment runbook.
- [ ] Add `apps/agents/README.md` + `apps/agents/.env.example` (documenting `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `BULL_BOARD_*`, `AGENTS_DEV_TOKEN`), `apps/mobile/.env.example` + real README, `sidecar/or-tools/README.md`, `scripts/README.md` (which scripts are safe, idempotent, and against what).
- [ ] Verify: a cold-clone walkthrough of each app's README reaches "running locally".

---

## 🟢 Medium

### M1. Deploy pipeline hardening
- [ ] `deploy.yml:29` — raise `fetch-depth` (e.g. 50) or use the filter's base ref properly so multi-commit pushes can't skip the DB job.
- [ ] Add deploy success/failure notifications (Slack/email) — today failures are only Actions annotations; combined with path filters this is how PR #214 went unnoticed.
- [ ] Worker health check (`apps/worker/scripts/deploy.sh:46-48`) treats `inactive` as success — require `active`.
- [ ] Solver deploy: move inline steps to a script with the same dist-backup/rollback shape as worker/agents; pin Python deps (`pip-compile` lockfile — currently all `>=` floors at `sidecar/or-tools/requirements.txt`), split pytest/httpx into `requirements-dev.txt`, delete the contradictory `Dockerfile`.
- [ ] Remove the persisted token from VPS git config (`deploy.yml:177,206` — `git remote set-url` cleanup step) and fix the solver checkout's undocumented out-of-band credential (`deploy.yml:232-238`).
- [ ] n8n: workflows are synced by a manual UI export ritual (`apps/worker/README.md:215-226`). Add an export-drift check (nightly n8n API pull vs repo JSONs) or push-on-deploy via the n8n API.

### M2. Database hygiene
- [ ] Add `AND operator_id = NEW.operator_id` to the 4 SECURITY DEFINER trigger UPDATEs (`20260506000001:59-63`, `20260318000001:263,295`, `20260319000001:223`) — a scan row carrying a foreign `package_id` currently mutates another tenant's package.
- [ ] Add `SET search_path` to the ~14 SECURITY DEFINER functions missing it (list in audit: `20260217000001:252,281`, `20260313000008:56`, `20260616000001`, etc.).
- [ ] Add `updated_at` triggers to `user_profiles`, `conversation_messages`, `agent_events`, `agent_tool_calls`, `return_receptions`, `return_reception_scans` (the last is read live by `get_ops_control_snapshot` age math).
- [ ] Index `orders.comuna_id` and `manifests.pickup_route_id` (seq-scanned on every route close).
- [ ] Add missing columns per house rule where genuine violations: `deleted_at` on `jobs`, `raw_files`, `operator_config`, `agent_commands`; `updated_at` on `users`.
- [ ] Restore the defensive `retorno_hub` predicate removed at `20260513000005:25` (latent trap if `pipeline_position` ever learns that status).
- [ ] Consolidate migration application to the Supabase CLI only — delete the 5 ad-hoc runners in `apps/frontend/scripts/` (they carry the `sbp_` tokens anyway, see C1) and retire `packages/database/supabase/MANUAL_STEPS.md`'s SQL-editor instructions.
- [ ] Policy for future destructive migrations: require row-count assertions before any `DROP TABLE` (pattern already exists at `20260625000001:770-790` — make it standard).

### M3. Shared code duplication → packages/
- [ ] Extract duplicated `logger.ts` and `crypto.ts` (verbatim copies in `apps/worker/src/` and `apps/agents/src/lib/`) into `packages/shared` — the AES-GCM crypto pair especially: drift breaks decryption across apps.
- [ ] Single-source the 35-line OCR extraction prompt (`apps/frontend/src/app/api/ocr-test/route.ts:5-38` vs `apps/agents/src/tools/ocr/extract-manifest.ts:6-38` — currently synced by a comment).
- [ ] Add the ESLint boundary/CI check for the "no cross-app imports, shared code in packages/" rule; update `docs/architecture.md:36` ("packages/ not yet created" is false).

### M4. Frontend cleanup
- [ ] Map raw error messages at the ~24 sites showing `err.message` directly (`app/app/pickup/page.tsx:170`, auth pages, `AuditLogsPageClient.tsx:72`) to the house `{code,message}` format.
- [ ] Remove the 20 production `console.log`s (incl. the Sentry `beforeSend` debug line firing on every event, `instrumentation-client.ts:44`); enable Sentry sourcemap upload (`next.config.ts:72-74` currently disables it, making prod traces unreadable).
- [ ] Replace `xlsx@0.18.5` (known unpatched prototype-pollution/ReDoS advisories on the npm build) — use the vendor CDN build or exceljs; drop one of `jsdom`/`happy-dom`; remove obsolete `@types/date-fns` and `@types/testing-library__jest-dom`.
- [ ] Add tests for `lib/supabase/unified.ts` (auth/session wrapper) and `lib/validation/` (0 tests each); raise API-route coverage (8/27).
- [ ] Add `import 'server-only'` to `lib/supabase/serverAdminClient.ts`.
- [ ] Non-constant-time secret compares: `whatsapp-webhook/routing.ts:85`, `agents/src/orchestration/bull-board.ts:30` → timing-safe equal.
- [ ] Resolve the stubbed scan-store path: `lib/stores/scanStore.ts:105` `// TODO: Replace with actual API call`.
- [ ] Fix the two type-only reverse imports (`hooks/pickup/useRouteManifests.ts:3`, `lib/utils/priority.ts:1`) by moving the types down a layer.

### M5. Repo hygiene
- [ ] Untrack junk: 8 root screenshots (~1 MB), `.playwright-mcp/`, `apps/frontend/test-results/` (Playwright failure artifacts), `apps/frontend/e2e/screenshots/` (rewritten every run); extend root `.gitignore` accordingly.
- [ ] Delete `apps/mobile/package-lock.json` and `apps/mobile/yarn.lock` (npm-workspaces monorepo — root lockfile only); delete mobile template assets (`react-logo*.png`).
- [ ] Move `scripts/dt-api-docs.md` (352 KB vendored API dump) to `docs/integrations/`.
- [ ] Tenant-specific data migrations (`20260709000001_enable_all_modules_transportes_musan.sql` and the connector-config series): adopt a convention going forward — tenant config via admin RPC/console, not schema history.

---

## ⚪ Low

- `.vercel/project.json` tracked (org/project IDs) — untrack.
- `chile_comuna_aliases` stores per-operator rows but has no `operator_id` column — verify RLS policy scoping is genuinely tenant-safe or add the column.
- `scripts/start-mobile.js` / `start-frontend.js` duplicate turbo dev scripts — delete.
- `ci.yml` lacks a per-branch concurrency group (superseded runs burn minutes).
- OpenClaw runs on the VPS as a bare PID process with no systemd unit (`docs/technical_debt.md:13`) — give it a unit.
- Worker heartbeat failures logged but not Sentry-reported (`apps/worker/src/poller.ts:120-126`).
- Two migration timestamp conventions (clock vs sequence) — pick one.
- `operators.deleted_at` is `TIMESTAMP`, everything else `TIMESTAMPTZ` — align.

---

## What's genuinely healthy (keep doing this)

- RLS coverage is complete: 55/55 tables enabled with tenant-scoped policies; `operator_id` indexing thorough (103 indexes).
- The `CREATE OR REPLACE` template discipline holds — all 14 multiply-defined functions traced, zero regressions; the `-- Template:` header convention works.
- spec-45/spec-47 SQL is exemplary (JWT-authorized SECURITY DEFINER RPCs with pinned search_path); pgTAP-style test suite exists.
- Frontend test density (0.86 tests/source, 90% hook coverage), 4 TODOs total, clean per-domain Zustand stores.
- Sentry wired across client/server/edge/worker/agents with PII scrubbing; health endpoints everywhere.
- Worker/agents deploy scripts (disk pre-check, dist snapshot rollback, npm audit); deploy concurrency group correct; no SQL injection anywhere; `.env.example` files are genuine placeholders (worker's is exemplary).

---

## Summary table

| Dimension | Score | Severity | Est. effort |
|-----------|-------|----------|-------------|
| Secrets / repo exposure | 1/10 | 🔴 Critical | 0.5–1 day (rotation + scrub) |
| Deploy gating / rollback | 3/10 | 🔴 Critical | 1 day |
| DB reproducibility (bootstrap/seed) | 2/10 | 🔴 Critical | 0.5–1 day |
| Tenant isolation (RPCs, webhooks, hardcoded tenant) | 4/10 | 🔴 Critical | 2–4 days (C4 quick; C6 is a small spec) |
| Endpoint auth hardening | 4/10 | 🔴/🟡 | 1 day |
| CI truthfulness (stubs, disabled tests) | 4/10 | 🟡 High | 2–3 days |
| Backup/restore & audit retention | 2/10 | 🟡 High | 1–2 days + monthly drill |
| Dead/template/abandoned code | 3/10 | 🟡 High | 1–2 days (mostly deletion) |
| Type/single-source-of-truth | 4/10 | 🟡 High | 1–2 days |
| Docs accuracy | 3/10 | 🟡 High | 1 day |
| DB hygiene (triggers, search_path, indexes) | 6/10 | 🟢 Medium | 1–2 days |
| Frontend quality (errors, deps, layering) | 6/10 | 🟢 Medium | 2–3 days |
| Repo hygiene | 5/10 | 🟢 Medium | 0.5 day |

**Total: roughly 3–4 focused weeks**, of which the critical block (C1–C6) is about one week and should come first — C1 (rotation) today.
