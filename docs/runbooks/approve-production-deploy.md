# Runbook — Approving a production deploy

Since spec-57, merging to `main` no longer ships to production on its own. A merge
syncs the QA environment, then stops and waits for you.

Related: `.github/workflows/README.md` · `docs/qa-environment.md` ·
`docs/runbooks/manual-deployment.md` · `docs/runbooks/rollback-production.md`

---

## What happens on a merge

```
merge to main ──▶ CI ──▶ deploy-qa ──▶ approve-production ⏸ ──▶ production
                          (QA VPS)        (you, here)
```

If `deploy-qa` fails, `approve-production` never runs and you are never asked.
Production is untouched. That is the intended behaviour — see *QA is down* below.

## Where the approval appears

1. GitHub → **Actions** → the **Deploy Production** run for your merge.
2. A yellow banner: **"Review deployments"** (also emailed, and shown on the
   repo's Environments page under `Production`).
3. Click it, tick `production`, then **Approve and deploy**.

## Before you approve

**1. Confirm which commit you are approving.** Open the `Approve Production Deploy`
job log. It prints:

```
Commit approved for production: <sha>
QA sync result: success
```

That SHA is what deploys — **not** `main`'s tip. If you merged more PRs while
deliberating, each queued as its own run with its own SHA. Approve them in order.

**2. Check QA.** https://qa.aureon.tractis.ai — it is running exactly that commit.
Exercise whatever the merge touched. This is the manual test step; until the
Playwright suite is wired to QA (spec-57 phase 2), there is no automated E2E
coverage here.

**3. Read `verify-prod-migrations`.** It is read-only and reports whether
production's migration ledger already diverges from the repo. Deliberately not
gated, so its output is available *before* you decide. If it is red, understand
why before approving — the database has no automatic rollback.

**4. Weigh the blast radius.** `supabase db push` is forward-only
(`docs/runbooks/rollback-production.md`). Frontend and worker/agents roll back
automatically on deploy failure; **the database does not.**

## Rejecting

Click **Reject**, or just leave it. Production is untouched — nothing has run.
The merge stays on `main`, so the next merge's run will contain it too. To ship
it later, re-run the workflow from the Actions UI and approve then.

Cancel the run instead if you want the queued slot freed immediately.

## QA is down and this is an emergency

A QA VPS outage blocks production deploys by design. Do **not** fix this by
editing the `needs:` chain in `deploy.yml` — `scripts/check-deploy-gating.sh`
will fail CI, and that check exists precisely to stop the gate being quietly
removed under pressure.

Use `docs/runbooks/manual-deployment.md` instead. If QA will be down for an
extended period, temporarily removing the required-reviewer rule from the
`Production` environment is the honest lever — it is visible, logged, and easy
to put back:

```bash
# inspect current state first
gh api repos/:owner/:repo/environments/Production --jq '.protection_rules'
```

Put it back the same day.

## Managing who can approve

```bash
# who is currently required
gh api repos/:owner/:repo/environments/Production --jq '.protection_rules'

# add a reviewer
gh api -X PUT repos/:owner/:repo/environments/Production \
  -f 'prevent_self_review=false' \
  -F 'reviewers[][type]=User' \
  -F "reviewers[][id]=$(gh api users/<login> --jq .id)"
```

`prevent_self_review` must stay `false` while there is a single maintainer —
with `true`, the person who merged cannot approve, which makes every deploy
unapprovable. This is the same trap that keeps required PR reviews off `main`
(`REMEDIATION.md`, C2). Revisit both when a second maintainer exists.
