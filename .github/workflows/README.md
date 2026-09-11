# GitHub Actions Workflows

Two workflows, chained: **CI must pass before anything deploys, QA must be green,
and the E2E suite against QA must pass.** From there, `approve-production`
(spec-92) resolves one of two ways:

```
push / PR ──▶ ci.yml ──(success, push to main only)──▶ deploy.yml
                                                          │
                                                          ├─▶ changes            (incl. auth_hook, pg_net)
                                                          ├─▶ deploy-qa          (QA VPS)
                                                          ├─▶ e2e-qa             (Playwright, BLOCKING)
                                                          ├─▶ approve-production
                                                          │     auth_hook OR pg_net == 'true' ?
                                                          │       ⏸ HUMAN  (environment: production)
                                                          │       : auto        (environment: production-auto)
                                                          └─▶ production fan-out
                                                                 DB → edge → vercel / VPS
```

Most merges reach production automatically once `e2e-qa` is green and the run
is still main's tip (a "run is current" freshness check inside
`approve-production` re-verifies this even on the paused path). A merge only
pauses for a human click when its diff touches the auth hook — the one class
of change QA cannot currently exercise (see spec-92, and spec-93 for closing
that gap at the root). See `docs/runbooks/approve-production-deploy.md`.

`deploy-approval-watchdog.yml` (spec-92) watches for a `main` commit that has
not reached production and has nothing currently deploying it — cron every 15
minutes, opens/updates a single issue labelled `deploy-approval-stale`.

---

## `ci.yml` — Lint, Type-Check, Test, Build

**Trigger:** every push and every pull request, on all branches.

One job named `Lint, Type-Check, Test, Build` runs, in order:

1. `npx turbo run lint`
2. `npx turbo run type-check`
3. `npx turbo run test:run`
4. `npx turbo run build`

Coverage per app is only as good as each package's scripts. Some are still
stubs — see `REMEDIATION.md` item H2 for exactly which apps report green
without running anything.

This job name is the required status check on `main`, so the string must stay
in sync with branch protection.

---

## `deploy.yml` — Deploy Production

**Trigger:** `workflow_run` — fires when **CI completes**, and only deploys when
that run both **succeeded** and was a **push to `main`** (a PR's CI run never
deploys).

Because the trigger is `workflow_run`, `github.sha` points at main's tip rather
than the commit CI tested. Every checkout and every VPS sync pins
`github.event.workflow_run.head_sha`. **Do not remove those refs** — without
them a deploy can ship a different commit than the one that passed.

### Jobs

Listed in **execution** order, which is not the order they appear in the file —
the blocks kept their original positions so the spec-57 diff stayed reviewable.

| Job | Runs when | Target |
|---|---|---|
| `changes` | always (after green CI) | computes the diff vs the previous main commit |
| `deploy-qa` | **every** green push | syncs the spec-48 QA stack on the VPS; migrations always replayed, app rebuilds path-filtered (`docs/qa-environment.md`) |
| `e2e-qa` | after `deploy-qa` succeeds | Playwright drives the real QA screens on that commit. **BLOCKING** since 2026-09-03 — `approve-production` requires `needs.e2e-qa.result == 'success'` |
| `approve-production` | after `e2e-qa` succeeds | `environment:` resolves to `production` (⏸ human) when `auth_hook` **or** `pg_net` is `'true'` — the two classes QA does not exercise (spec-92 fase 1b; `pg_net` is installed in QA and not in production, so a migration using `net.http_post()` passes QA and fails on apply) — else `production-auto` (no pause). `force_db=true` forces both on. Either way, a "run is current" step re-checks `DEPLOY_SHA` against `main`'s tip before anything downstream runs (spec-92) |
| `deploy-supabase` | approved **and** migrations / `seed.sql` / `config.toml` changed | `supabase db push --include-all` |
| `verify-prod-migrations` | after `deploy-supabase` resolves, always | read-only; fails if prod's migration ledger diverges from the repo |
| `deploy-edge-functions` | approved **and** `packages/database/supabase/functions/**` changed | `supabase functions deploy` |
| `deploy-vercel` | approved (every green push) | `vercel --prod`, with rollback on failure |
| `deploy-worker` | approved **and** `apps/worker/**` changed | VPS via `apps/worker/scripts/deploy.sh` |
| `deploy-agents` | approved **and** `apps/agents/**` changed | VPS via `apps/agents/scripts/deploy.sh` |
| `deploy-solver` | approved **and** `sidecar/or-tools/**` changed | VPS venv + `systemctl restart aureon-solver` |

App deploys depend on the migration jobs, so a failed migration stops
everything downstream. `concurrency: production-deploy` with
`cancel-in-progress: false` means two merges queue rather than race — never
cancel a half-applied migration. A run waiting for approval holds that slot, so
merges made while you deliberate queue behind it as separate runs, each pinned
to its own `DEPLOY_SHA`.

### The QA gate (spec-57)

`deploy-qa` is production's precondition, not a parallel mirror. It replays the
full migration ledger on every run, so it is the only automated proof that a
merge's schema actually applies before production attempts the same thing.

**A QA VPS outage therefore blocks production deploys.** That is deliberate. The
escape hatch is `docs/runbooks/manual-deployment.md` — not editing the
dependency out. `scripts/check-deploy-gating.sh` runs on every build and fails
if any production job stops depending on `approve-production`, or if the
auth-hook exemption (spec-92, below) inverts.

### Auto-approve, except the auth hook (spec-92)

`approve-production` pauses for a human only when the diff touches the auth
hook (`custom_access_token_hook`, or a migration granting to
`supabase_auth_admin`) — QA's GoTrue never invokes that hook, and even where
it does not, `e2e-qa`'s sign-in never reads the JWT, so a green `deploy-qa` +
`e2e-qa` proves nothing about that class of change. Everything else
auto-approves once `e2e-qa` is green. `scripts/check-deploy-gating-autoapprove.mjs`
asserts the `environment:` expression cannot invert, that the freshness step
exists and cannot be swallowed (`continue-on-error`, a trailing `|| true`), and
that no production job can declare its own `environment:` to bypass the gate.

Change detection is a plain `git diff` against `HEAD^` (main is squash-merge
only) over a full-depth checkout. It replaced a `dorny/paths-filter` +
`fetch-depth: 2` setup that could silently resolve an empty diff on
multi-commit pushes and skip the migration job.

### ⚠️ Vercel Git integration must stay disabled

`deploy-vercel` is the only thing that should deploy the frontend. If Vercel's
own Git integration is enabled for `main`, it deploys every push *outside*
GitHub Actions — in parallel with this workflow and ungated. A failed migration
would then be followed by a frontend deploy against the old schema, with no
rollback.

Disable it at **Vercel → Project → Settings → Git** (unset the production
branch, or set Ignored Build Step to `exit 1`).

---

## Branch protection on `main`

- Required status check: `Lint, Type-Check, Test, Build` (strict — branch must
  be up to date before merging)
- Force pushes and deletions: blocked
- Admin enforcement: on

Required PR reviews are **not** enabled — with a single maintainer, GitHub
would block every merge, since you cannot approve your own PR. Turn this on
when a second reviewer exists (`REMEDIATION.md`, C2).

---

## Rollback

- Frontend: automatic in-job on deploy failure; manual via Vercel dashboard.
- Worker / agents: `deploy.sh` snapshots `dist` and restores it if systemd
  reports `failed`.
- Database: **no automatic rollback.** `supabase db push` is forward-only —
  see `docs/runbooks/rollback-production.md`.
