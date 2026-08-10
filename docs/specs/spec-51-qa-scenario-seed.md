# spec-51 — QA Scenario Seed, Workflow Test Scope, and Prod Drift Gate

**Status:** in progress

## Numbering note

`spec-48` and `spec-49` are each used for two different features:
`docs/architecture/phased-rollout-strategy.md` reserves them for "Visibility
preset" and "Late-order alerts", while PRs #363 and #364 shipped the VPS QA
environment and the Easy WMS dispatch-guide URL under those numbers. `spec-50`
remains reserved for DispatchTrack reconciliation. This spec takes **51** to
avoid deepening the collision. Correcting the rollout map is separate work.

## Context

We need to test every workflow end-to-end before the phased rollout, against a QA
environment holding zero production data, and be confident that production ends
up an exact copy of what was signed off.

**Most of the infrastructure already exists.** spec-48 (PR #363, hotfixes
#365–#369) shipped a fully isolated self-hosted QA stack on the VPS: Supabase in
Docker, frontend/agents/worker as systemd units, schema built exclusively by
replaying the repo's migrations, CI sync on every merge to main. It works. **This
spec builds no new infrastructure.**

Three gaps remain:

1. **The seed is a smoke seed, not a QA seed.** `packages/database/supabase/seed-qa.sql`
   covers 5 orders, 5 of 15 `package_status_enum` values, 2 of 5
   `route_status_enum`, and zero rows in `manifests`, `pickup_routes`, `dock_*`,
   `return_*`, `conversations`, `intake_submissions`, `tenant_clients`, or
   `operator_enabled_modules`. It seeds **one** operator, so cross-tenant
   isolation is untestable.
2. **No defined test scope.** "Test every workflow" must become an enumerated,
   checkable list tied to roles and preconditions.
3. **Prod parity is not actually guaranteed.** QA replays all migrations on every
   merge (deliberately unfiltered). Prod's `deploy-supabase` job **is**
   path-filtered. `REMEDIATION.md` documents this class of bug biting twice
   already — a pinned-CLI break "went undetected until PR #214". QA passing
   proves migrations *work*; it does not prove prod *ran* them.

## Decisions

| Question | Decision |
|---|---|
| Environment split | The VPS QA stack is the E2E environment (frontend + agents + worker + solver together). Vercel Preview stays per-PR frontend review only. |
| Why not Vercel Preview for E2E | Agents (BullMQ), worker (node-cron), and the OR-Tools solver are VPS systemd services. A preview deployment is the Next.js app alone — it structurally cannot exercise those workflows. |
| Seed shape | TypeScript scenario generator: named batches, deterministic UUIDs, self-asserting. |
| Tenancy scope | Second operator + isolation, module activation matrix, role/permission matrix, operator onboarding. |
| Automated E2E | **Out of scope.** Testing is manual against a defined checklist. |

## PR sequence

| PR | Contents |
|---|---|
| **1** | This spec + prod migration drift gate |
| **2** | Enum-discrepancy resolution (see below) |
| **3** | `docs/qa-test-scope.md` + smoke-test extension in `docs/qa-environment.md` |
| **4** | Seed generator package + `replay-easy-webhook.mjs` operator override |

## Known issue — the `listo` enum discrepancy

Migration `20260324000001_dispatch_module.sql` renames `listo` →
`listo_para_despacho` in **both** `order_status_enum` and `package_status_enum`.
But `apps/frontend/src/lib/types.ts` — generated from the **remote production
project** — still shows `order_status_enum` containing `"listo"` while
`package_status_enum` correctly shows `"listo_para_despacho"`.

Either the rename half-applied in production, or the generated types are stale.
**Resolve by querying prod's `pg_enum` directly before changing any TypeScript.**
This is a live instance of the drift the gate below is built to catch.

Separately, `apps/frontend/src/lib/reception/reception-scan-validator.ts:21`
lists `'listo'` among **package** statuses, a value `package_status_enum`
definitively no longer contains — the comparison can never match. That is a bug
regardless of how the order-enum question resolves.

`apps/frontend/src/lib/types/pipeline.ts` uses `'listo'` for order status, which
is consistent with the generated types. It is not necessarily wrong; correctness
depends on the answer above.

## Production bug found via the enum work — closing a route cancels its orders

The `listo` → `listo_para_despacho` rename (`20260324000001`) updated the enums
but not the two functions comparing against that value **as TEXT**:

- `pipeline_position(TEXT)` (latest def `20260319000001`) matches only `'listo'`,
  so `pipeline_position('listo_para_despacho')` falls to `ELSE 0` — "terminal,
  not in the active pipeline".
- `recalculate_order_status()` (latest def `20260513000005`) maps position 8 back
  to `'listo'`, which is no longer a valid `order_status_enum` label. That branch
  is currently unreachable and would raise on cast if it ever were.

**The failure path:** `POST /api/dispatch/routes/[id]/close` sets every
`en_carga` package on the route to `listo_para_despacho`. That fires
`trg_recalculate_order_status`. Inside it, `v_active_count` counts packages with
`pipeline_position(status) > 0` — now zero for every package just staged. For an
order whose packages are all on the closed route,
`v_active_count + v_entregado = 0`, so the function takes the "no packages left"
branch and sets the order to **`cancelado`**.

Fixed in `20260810000001_spec51_fix_listo_para_despacho_pipeline_position.sql`,
both functions rewritten from their latest definitions per the `CLAUDE.md` rule.
Regression test: `supabase/tests/spec51_listo_para_despacho_pipeline_position.sql`.

**Existing rows are repaired** by
`20260810000002_spec51_repair_wrongly_cancelled_orders.sql`.

The repair is deliberately narrow. "Cancelled with active packages" is *not* a
bug signature on its own: the `beetrack-webhook` edge function writes
`orders.status = 'cancelado'` directly for failed and partial DispatchTrack
dispatches, bypassing the trigger and leaving packages at `en_ruta`. Repairing
on that predicate would silently resurrect genuinely failed deliveries.

The bug's actual signature is that **every** live package sits at
`listo_para_despacho` — an order in that state never dispatched, so the webhook
cannot have cancelled it. The repair re-fires the trigger rather than writing
`orders.status`, so the canonical derivation decides the outcome and the
migration cannot invent a status the trigger would not produce. It is idempotent
and reports counts via `RAISE NOTICE`.
`supabase/tests/spec51_repair_wrongly_cancelled_orders.sql` covers all four
cases, including the two that must be left alone.

To size the affected population independently:

```sql
SELECT o.operator_id, count(*) AS affected_orders
FROM orders o
WHERE o.status = 'cancelado'
  AND o.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM packages p
    WHERE p.order_id = o.id
      AND p.deleted_at IS NULL
      AND p.status = 'listo_para_despacho'
  )
  AND NOT EXISTS (
    SELECT 1 FROM packages p
    WHERE p.order_id = o.id
      AND p.deleted_at IS NULL
      AND p.status = 'retorno_hub'
  )
GROUP BY o.operator_id;
```

A backfill would re-derive status for exactly those orders. It is deliberately
not automated here: distinguishing these from genuinely cancelled orders needs a
look at real data first.

## Deliverable 3 (PR 1) — Prod migration drift gate

New job `verify-prod-migrations` in `.github/workflows/deploy.yml`, running after
`deploy-supabase`, **deliberately not path-filtered** — that filter is the bug.

Compares the migration ledger applied on the production project against
`packages/database/supabase/migrations/*.sql` using the already-pinned Supabase
CLI (2.88.1) and existing secrets. Fails on:

- **Local-only** — a migration in the repo not applied to prod (prod is behind)
- **Remote-only** — a migration applied to prod that is not in the repo (someone
  applied by hand)
- **Empty parse** — zero rows recognised, meaning the CLI output format changed
  and the gate would otherwise pass vacuously

That third check matters: a gate that cannot fail is not a gate.

The job is a **leaf** — nothing depends on it. It fails the workflow loudly
without blocking `deploy-edge-functions` / `deploy-vercel`, because pre-existing
drift would otherwise brick the entire deploy pipeline on first run. Tighten to
blocking once prod is known clean.

## Deliverable 1 (PR 4) — QA scenario seed generator

New package directory `packages/database/seed-qa/`, run via `tsx`, invoked as
`npm run seed:qa`. Every file under 300 lines.

```
seed-qa/
  index.ts              CLI entry, arg parsing, guardrails
  lib/db.ts             pg pool, transaction helper
  lib/ids.ts            deterministic UUID allocation
  lib/assert.ts         post-insert state assertions
  lib/enums.ts          enum literals + pg_enum drift check
  scenarios/{ingestion,pickup,reception,distribution,dispatch,
             outcomes,returns,comms,tenancy}.ts
```

### CLI

```
npm run seed:qa -- --scenarios=all
npm run seed:qa -- --only=returns,outcomes
npm run seed:qa -- --only=dispatch --count=50
npm run seed:qa -- --reset       # delete generated rows only
npm run seed:qa -- --dry-run
npm run seed:qa -- --verify      # re-run assertions, insert nothing
```

### Guardrails (non-negotiable — this script holds service-role write access)

Mirrors `infra/supabase-qa/apply-migrations.sh`, which hard-refuses any target
other than `localhost:5433`. Abort unless **all** hold:

- Host is `localhost`/`127.0.0.1` **and** port is `5433`
- No `supabase.co` anywhere in the connection string or environment
- The prod MUSAN operator UUID `92dc5797-047d-458d-bbdb-63f18c0dd1e7` is
  **absent** from `public.operators` — its presence means this is production data

### UUID scheme

`seed-qa.sql` owns node `...-8000-...`. The generator uses node `...-9000-...`
(still a valid UUID v4 variant) so `--reset` targets generated rows precisely
without touching the spec-48 baseline.

```
00000000-0000-4000-9000-<scenario><sequence>
Second operator: 00000000-0000-4000-9000-000000000002
```

### Two rules that make the seed a test, not just data

**Rule 1 — never write `orders.status` directly.** It is derived by
`trg_recalculate_order_status` (logic in `20260512000002`, latest definition in
`20260513000005`). Insert packages, let the trigger settle, then **assert** the
resulting `orders.status` / `leading_status` matches the scenario's intent. A
mismatch is a real bug in the derivation logic. The current `seed-qa.sql` writes
both independently and can manufacture states the trigger would never produce.

**Rule 2 — assert enum literals against `pg_enum` at startup.** Fail if the
generator's TypeScript literals have drifted from the live database. This is the
check that surfaces the `listo` discrepancy above.

### Scenario catalog

Not a cartesian product — 36 enums make that meaningless. Named scenarios chosen
to cover every reachable state and every transition edge.

| Group | Scenarios |
|---|---|
| **Ingestion** | Easy WMS despacho (with `dispatch_guide_url`) · CSV batch · manual entry · OCR intake across all 7 `intake_status_enum` values |
| **Pickup** | manifest awaiting reception · route in progress (scans `verified`/`not_found`/`duplicate`) · in transit · received with discrepancy · cancelled |
| **Reception** | route reception partial (incl. `route_mismatch`) · complete |
| **Distribution** | batch open with scans `accepted`/`rejected`/`wrong_zone`/`unmapped` · consolidation zone → `retenido` · batch closed → `sectorizado` · `dock_verifications` scan + tap |
| **Dispatch** | pre-route pool · route `draft` · loaded `en_carga` · `in_progress`/`en_ruta` · `completed` · `cancelled` |
| **Outcomes** | all delivered → `entregado` · failed → `retorno_hub` → `en_retorno` · mixed → `parcialmente_entregado` · `cancelado` · `dañado`/`extraviado`/`devuelto` |
| **Returns** | return reception pending · completed → back to `en_bodega` |
| **Comms** | conversations across channel/direction/sender · WISMO across 11 types × 5 delivery statuses · customer session + `order_reschedules` |
| **Tenancy** | second operator with mirrored data · module activation matrix (9 keys × on/off) · role matrix (6 roles) · blank operator for the onboarding walkthrough |
| **Data quality** | unmatched comuna (`get_unmatched_comunas`) · SLA-breached + priority orders · duplicate `order_number` rejection · capacity alert threshold |

Reuse rather than rewrite: the `create_seeded_route` RPC (`20260423000003`) for
routes+dispatches, the deterministic-ID pattern from
`20260423000001_spec36_dev_test_seed.sql`, and the auth-row template from
`20260616000002_spec45_internal_operator_seed.sql`. Second-operator users follow
`infra/supabase-qa/create-qa-users.sh`.

### Wiring into spec-48

`seed-qa.sql` stays exactly as-is — `setup-qa.sh`, `deploy-qa.sh`, and the
runbook all reference it. The generator layers on top and runs **manually**, not
from CI, so QA re-deploys stay fast and scenario data resets on the tester's
terms.

## Deliverable 2 (PR 3) — `docs/qa-test-scope.md`

Organised by the 9 module keys in `apps/frontend/src/lib/modules/registry.ts`
(`ops_control`, `late_order_alerts`, `pickup`, `reception`, `distribution`,
`pre_route`, `dispatch`, `returns`, `conversations`). Each entry carries:
precondition (which seed scenario supplies the state), role(s) to sign in as,
steps, expected result including the expected derived `orders.status`, and the
related spec/PR.

Plus dedicated sections for **tenant operations** (isolation, module matrix, role
matrix, onboarding) and a **regression set** for recently merged but never
E2E-tested work: spec-45, spec-46, spec-47, spec-43, spec-49, and REMEDIATION
C4/C5 (cross-tenant RPC isolation, fail-closed endpoint auth).

Also extend the 7-step smoke test in `docs/qa-environment.md` with a step for
running the generator and confirming assertions pass.

## Out of scope

- Playwright / automated E2E. The existing specs in `apps/frontend/e2e/` are
  smoke shells with no auth fixture (they pass on a login redirect) — leave them.
- Settlement, `exceptions`, `assignments` — schema exists, no application code.
- Driver POD app — doesn't exist; POD arrives via the DispatchTrack webhook.
- `apps/mobile` — not wired into any deploy job.
- Cloudflare tunnel / second cloud Supabase project — rejected, no new infra.

## Related issues (flag, do not silently fix)

- **Hardcoded prod operator UUIDs** — `MUSAN_OPERATOR_ID` in
  `packages/database/supabase/functions/beetrack-webhook/index.ts:14` and in the
  Easy WMS n8n workflow JSON. Webhook-driven ingestion in QA lands in the wrong
  tenant; PR 4 adds an operator override to `scripts/replay-easy-webhook.mjs`.
- **spec-46 guards cover 6 of 9 modules.** `ops_control`, `pickup`, `reception`,
  `distribution`, `dispatch`, and `conversations` have layout guards calling
  `requireModuleEnabled`. `pre_route` and `returns` are toggleable in the admin
  UI but gate nothing — `PreRouteTab` renders unconditionally inside
  `dispatch/page.tsx` and `ReturnsPanel` inside `operations-control`, each gated
  only by its parent module. `late_order_alerts` has no implementation yet
  (expected — still backlog in the rollout map). `ModuleMeta.navHref` is dead
  metadata, read nowhere. Belongs in a spec-46 follow-up, not here.
- **CI cannot restart the QA app services.** `deploy-qa.sh` runs
  `sudo systemctl restart aureon-*-qa`, but the passwordless sudoers rule that
  makes this work for the prod units does not cover the `-qa` ones. The job
  fails at the restart step on any push touching `apps/frontend/**`,
  `apps/agents/**`, or `apps/worker/**` — first observed on the merge of PR #372.
  QA's schema stays current (migrations need no sudo) but its application code
  silently stops tracking main. `deploy-qa.sh` now checks this up front via
  `guard_sudo()` — using `sudo -n -l systemctl restart <unit>`, which asks
  whether that exact command is permitted without running it — so the job fails
  in seconds with the remediation instead of after a five-minute build. Tested
  in `infra/supabase-qa/deploy-qa.guard-sudo.test.sh` against a stubbed `sudo`.

  The sudoers entry itself is still outstanding and is the only remaining item
  that genuinely requires host access; the command is in
  `docs/qa-environment.md`.
- **Stale spec statuses** — spec-47 still says `backlog` after 4 merged PRs.
- **Doc drift** — `.github/workflows/README.md` omits `deploy-qa`;
  `apps/frontend/docs/deployment-runbook.md` (v1.1) predates spec-48.
- **Worker tests disabled in CI** — `test:run` is an `echo`.
- **Vercel Preview points at PRODUCTION — confirmed, not yet fixed at source.**

  `apps/frontend/src/lib/supabase/environment-guard.ts` is a no-op unless
  `VERCEL_ENV === 'preview'` **and** the Supabase URL contains the production
  project ref. When it first shipped, the Vercel preview build for that very PR
  failed, while the preceding PR had built cleanly. The only delta was the
  guard, so both conditions must hold: **PR preview deployments have been
  running against the production database.** `/app/operations-control` was being
  prerendered against production at build time.

  **The real fix is in the Vercel dashboard** — set the Preview environment's
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
  `SUPABASE_SERVICE_KEY` to a non-production project. Until that happens the
  guard limits the damage:

  | Client | Access | Behaviour on preview→production |
  |---|---|---|
  | `createServerAdminClient()` | service-role, bypasses RLS | **throws** |
  | `createSSRClient()` | anon, bounded by RLS | logs once, continues |

  The asymmetry is deliberate. Service-role from a preview is unrestricted
  read/write over every tenant's production data and is never acceptable.
  Anon access is wrong but RLS-bounded, and refusing it fails the prerender of
  `/app/operations-control` (reached through `requireModuleEnabled`), which
  fails the whole deployment and blocks every PR without fixing the cause.
  Production, local, QA and CI are unaffected — `VERCEL_ENV` is either
  `production` or undefined.

## Verification

1. **Seed runs clean on QA** — `--dry-run` then `--scenarios=all`; every
   assertion and the enum drift check pass.
2. **Guardrails hold** — refuses a non-5433 port, refuses a `supabase.co` URL,
   and trips the MUSAN-UUID guard against a database containing that operator.
3. **Idempotent** — run twice, row counts unchanged; `--reset` removes only
   `...-9000-...` rows.
4. **Migration parity** — `SELECT count(*) FROM supabase_migrations.schema_migrations`
   on `:5433` equals `ls packages/database/supabase/migrations/*.sql | wc -l`.
5. **Walk the scope doc** — through the SSH tunnel at `http://localhost:3200`,
   sign in as each of the six QA roles. Cross-tenant check: operator A's admin
   must not see operator B's orders.
6. **Drift gate proves itself** — passes on a clean run, and *fails* on a
   synthetic divergence.
