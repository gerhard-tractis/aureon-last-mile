# GitHub Actions Workflows

Two workflows, chained: **CI must pass before anything deploys.**

```
push / PR ──▶ ci.yml ──(success, push to main only)──▶ deploy.yml
```

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

| Job | Runs when | Target |
|---|---|---|
| `changes` | always (after green CI) | computes the diff vs the previous main commit |
| `deploy-supabase` | migrations / `seed.sql` / `config.toml` changed | `supabase db push --include-all` |
| `verify-prod-migrations` | **every** green push (never path-filtered) | fails if prod's migration ledger diverges from the repo |
| `deploy-edge-functions` | `packages/database/supabase/functions/**` changed | `supabase functions deploy` |
| `deploy-vercel` | **every** green push | `vercel --prod`, with rollback on failure |
| `deploy-worker` | `apps/worker/**` changed | VPS via `apps/worker/scripts/deploy.sh` |
| `deploy-agents` | `apps/agents/**` changed | VPS via `apps/agents/scripts/deploy.sh` |
| `deploy-solver` | `sidecar/or-tools/**` changed | VPS venv + `systemctl restart aureon-solver` |
| `deploy-qa` | **every** green push | syncs the spec-48 QA stack on the VPS; migrations always replayed, app rebuilds path-filtered. Never blocks prod (see `docs/qa-environment.md`) |

App deploys depend on the migration jobs, so a failed migration stops
everything downstream. `concurrency: production-deploy` with
`cancel-in-progress: false` means two merges queue rather than race — never
cancel a half-applied migration.

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
