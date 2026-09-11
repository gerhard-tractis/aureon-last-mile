# Runbook — production deploys, and the one case that still asks you

Since spec-92, a merge to `main` deploys to production automatically once
`e2e-qa` is green and the run is still `main`'s current tip — no click. The
click from spec-57 is still here, but it is now the **exception**: it appears
for the **two** classes of change QA does not exercise, both measured, never
guessed:

1. **The auth hook** — `custom_access_token_hook`, which production invokes on
   every login (see "Why the auth hook is different" below).
2. **`pg_net`** — the extension is installed in QA and **not** in production
   (measured, run `34539233402`), so a migration using `net.http_post()` /
   `net.http_get()` applies green against QA and fails on apply in production
   with `schema "net" does not exist`.

A third trigger is not a class of change at all: **`force_db=true`** forces both
flags on. That input exists because the "last successful run ⇒ production is up
to date" invariant broke once (2026-08-23, 13 migrations at once); when you are
already telling the pipeline the range is untrustworthy, pausing is cheap.

Related: `.github/workflows/README.md` · `docs/qa-environment.md` ·
`docs/runbooks/manual-deployment.md` · `docs/runbooks/rollback-production.md` ·
`docs/specs/spec-92-gate-produccion-diferenciado.md`

---

## What happens on a merge — two paths

```
merge to main ──▶ CI ──▶ deploy-qa ──▶ e2e-qa ──▶ approve-production
                          (QA VPS)     (BLOCKING)      │
                                                        ├─ auth_hook OR pg_net == 'true'?
                                                        │    ⏸ YOU, here (environment: production)
                                                        │    :  auto (environment: production-auto)
                                                        └─▶ production
```

If `deploy-qa` fails, or `e2e-qa` fails, `approve-production` never runs and
nothing deploys — production is untouched. That is the intended behaviour, on
both paths.

**The common case: nothing to do.** If the merge did not touch the auth hook,
`approve-production` runs immediately once `e2e-qa` is green, re-verifies the
run is still `main`'s tip, and the production fan-out starts. You will not see
a "Review deployments" banner for these.

## When you WILL be asked

Only when the diff touches:
- anything naming `custom_access_token_hook` (the GoTrue auth hook), or
- a migration granting to `supabase_auth_admin` (how the hook gets wired up)

## Why the auth hook is different

QA's GoTrue never invokes `custom_access_token_hook` at all — it is not
registered in `infra/supabase-qa/docker-compose.yml`. And even where the hook
degrades gracefully by design, `e2e-qa`'s sign-in step never reads the JWT, so
a broken hook still produces a green login. `deploy-qa` + `e2e-qa` passing
proves nothing about this class of change — the pipeline doesn't impose
anything here, it just looks like it does. `docs/specs/spec-93-paridad-qa-produccion.md`
is closing this class of gap at the root (a measured inventory of QA↔prod
config surfaces, with a CI check for new ones); until it lands, this is a
narrow, named exception, not a general "migrations pause" rule.

## Where the approval appears, when it does

1. GitHub → **Actions** → the **Deploy Production** run for your merge.
2. A yellow banner: **"Review deployments"** (also emailed, and shown on the
   repo's Environments page under `production`).
3. Click it, tick `production`, then **Approve and deploy**.

## Before you approve

**1. Confirm which commit you are approving.** Open the `Approve Production
Deploy` job log. It prints the commit and whether the diff touched the auth
hook. Approving does not skip the freshness check — if a newer merge landed
while you were deliberating, the job fails closed rather than deploying stale
code on top of it. If that happens, re-run the workflow for the newer commit
instead of retrying this one.

**2. Check QA.** https://qa.aureon.tractis.ai — running exactly that commit.
Exercise the hook-adjacent change by hand; this is precisely the class of
change QA's automated checks cannot see.

**3. Read `verify-prod-migrations`.** Read-only, reports whether production's
migration ledger already diverges from the repo. Not gated, so its output is
available *before* you decide.

**4. Weigh the blast radius.** `supabase db push` is forward-only
(`docs/runbooks/rollback-production.md`). Frontend and worker/agents roll back
automatically on deploy failure; **the database does not.**

## Rejecting

Click **Reject**, or just leave it. Production is untouched. Cancel the run
instead if you want its queued production concurrency slot freed immediately.

## A run that never resolves — `deploy-approval-stale`

`deploy-approval-watchdog.yml` (spec-92) checks every 15 minutes whether the
commit at `main`'s tip has reached production. If a run sits unresolved for
more than 60 minutes — still waiting on a click, `e2e-qa` red, or anything
else — it opens (or updates) a single issue labelled `deploy-approval-stale`.
It also fires immediately, without waiting the 60 minutes, if two runs for
different commits are unresolved at the same time: approving the older one
after a newer merge landed would ship stale code, so cancel the older run
rather than approving it.

The issue closes itself once a run reaches production. If you see it: open the
linked run, find where it stopped (waiting for approval, a red `e2e-qa`, a
failed freshness check), and act on that — the issue itself carries no state
beyond "still unresolved" or "resolved".

## What auto-approval does NOT cover — declared gaps

Auto-approval removed the click for most merges, but the click was never a
real defense against these either — declaring them here is more honest than
letting them hide behind "someone approved it". Measured by the spec-92
review (2026-09-09), six named classes — see the full table in
`docs/specs/spec-92-gate-produccion-diferenciado.md`:

1. **Migrations whose pgTAP is red against QA.** `sql_tests_check` in
   `infra/supabase-qa/deploy-qa.sh` is advisory — it can report FAIL and
   `deploy-qa` still succeeds. **This is why the spec's own merge does not
   land until that check is blocking** (depends on PR #717).
2. **QA compose changes outside the Edge Functions path** never reach the
   container they modify in a normal CI/CD cycle.
3. **Hook rewrites that don't match the detection signals** — a semantic
   rewrite of the function body that never mentions
   `custom_access_token_hook` or `supabase_auth_admin` as literal text.
4–6. Cumulative-`--include-all` application, `workflow_dispatch` +
   `force_db` backlogs, and >64KB migration diffs — all closed in the
   spec-92 review round 2 (B1/M2); listed for the record of what was
   checked, not because they're still open.
- **Scale.** Production has ~112k dispatches and ~61k packages; a backfill
  that times out there does not time out in QA. Nobody measured table volume
  by clicking a button before this spec, and nothing measures it after.
- **Config divergence beyond the auth hook.** `spec-93` is the structural fix
  for this class — until it lands, any QA↔prod config difference not yet
  named as an exception here has the same blind spot the auth hook had before
  this spec.
- **The human gate itself losing its protection.** `deploy-approval-watchdog.yml`
  now checks whether the `production` environment still carries its
  required-reviewer rule on every run (15-minute cron) and alerts
  immediately if not — this is live GitHub config, invisible to any YAML
  guard in this repo.

## Managing who can approve

```bash
# who is currently required
gh api repos/:owner/:repo/environments/production --jq '.protection_rules'

# add a reviewer
gh api -X PUT repos/:owner/:repo/environments/production \
  -f 'prevent_self_review=false' \
  -F 'reviewers[][type]=User' \
  -F "reviewers[][id]=$(gh api users/<login> --jq .id)"
```

`prevent_self_review` must stay `false` while there is a single maintainer —
with `true`, the person who merged cannot approve, which makes every
auth-hook deploy unapprovable. This is the same trap that keeps required PR
reviews off `main` (`REMEDIATION.md`, C2). Revisit both when a second
maintainer exists.

`production-auto` (the environment `approve-production` resolves to when the
diff does not touch the auth hook) has no protection rules by design — do not
add reviewers to it; that would silently restore the pre-spec-92 pause for
every merge.


---

## The one link no guard in this repo can see

Everything above is enforced by `scripts/check-deploy-gating*.mjs` against
`.github/workflows/deploy.yml` — twelve links of the chain, each verified by
mutation against the real file.

**The pause itself is not in a file.** It is a `required_reviewers` rule on the
`production` environment, in GitHub's settings. Checked 2026-09-11:

```
$ gh api repos/gerhard-tractis/aureon-last-mile/environments/production     --jq '.protection_rules[] | .type + " " + ((.reviewers // []) | map(.reviewer.login) | join(","))'
required_reviewers gerhard-tractis

$ gh api repos/gerhard-tractis/aureon-last-mile/environments/production-auto
404   # GitHub creates it on first use — expected, this is the no-pause path
```

Removing that reviewer, or adding reviewers to `production-auto`, changes the
gate's behaviour **without touching a single line of code**, and no test in this
repo can detect it. `deploy-approval-watchdog` (fase 3) queries
`environments/production` on every run and alerts when `productionGateProtected`
is false — including when the query itself fails, which is fail-closed. That is
the only coverage this link has.

If you ever see production deploying an auth-hook change without asking you,
check that rule **before** you look at the workflow.
