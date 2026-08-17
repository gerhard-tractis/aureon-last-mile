# spec-57 — QA gate before production

**Status:** in progress

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to implement this plan. Steps use `- [ ]` checkbox syntax.

**Goal:** Make a merge to `main` reach production only after the QA environment has been
synced green *and* a human has explicitly approved that specific commit.

**Architecture:** Insert a single `approve-production` job into `.github/workflows/deploy.yml`
that depends on `deploy-qa` and carries `environment: production`. Every job that mutates
production depends on it. The GitHub `Production` environment gets a required-reviewer
protection rule, so that one job — and therefore the whole production fan-out — pauses for a
human click. A guard script asserts the wiring can't silently regress.

**Tech Stack:** GitHub Actions (`workflow_run`, environments, deployment protection rules),
existing self-hosted VPS runner, Playwright (phase 2).

---

## Problem

Investigated 2026-08-16. There is no QA gate — QA and production deploy **in parallel** from
the same green merge.

`deploy-qa` (`.github/workflows/deploy.yml:350`) declares `needs: [changes]`. `deploy-vercel`
(`:213`) declares `needs: [changes, deploy-supabase, deploy-edge-functions]`. They are sibling
jobs in one `workflow_run`; no production job references QA. The file says so outright at `:348`:

> "No prod job depends on this one — a QA sync failure is surfaced with `::error::` but never
> blocks production deploys."

Compounding factors found in the same pass:

| Finding | Evidence |
|---|---|
| No manual approval anywhere | All 3 GitHub Environments (`Production`, `Preview`, `virtuous-reflection / production`) have `protection_rules: []`; the deploy jobs don't declare `environment:` at all, so those environments are inert. |
| E2E tests exist but never run | 6 Playwright specs in `apps/frontend/e2e/`. No `e2e` script in `apps/frontend/package.json`; `ci.yml` runs only `turbo lint/type-check/test:run/build`. |
| E2E is local-only by construction | `apps/frontend/playwright.config.ts` uses `baseURL: http://localhost:3000` + `webServer: npm run dev`. |
| No required reviews on `main` | Branch protection: one check (`Lint, Type-Check, Test, Build`), `enforce_admins: true`, `required_pull_request_reviews: null`. |
| Database is forward-only | `supabase db push`; no automatic rollback (`docs/runbooks/rollback-production.md`). |

Net: **merge to `main` = production, ~10 minutes later, with zero human checkpoint.**
Combined with the `gh pr merge --auto --squash` convention in `CLAUDE.md`, the path from push
to production is fully unattended.

## Decisions

Taken 2026-08-16; defaults proposed by Claude, approved by Gerhard ("lets follow your plan").

1. **Gate scope: every production-mutating job** — `deploy-supabase`, `deploy-edge-functions`,
   `deploy-vercel`, `deploy-worker`, `deploy-agents`, `deploy-solver`. Gating only the DB and
   frontend would still let worker/agents ship code against an unvalidated schema.

2. **Approval pins the tested SHA — already free.** `deploy.yml` pins
   `github.event.workflow_run.head_sha` into `DEPLOY_SHA` and every checkout/VPS sync uses it.
   A run paused for approval holds the `production-deploy` concurrency slot
   (`cancel-in-progress: false`), so later merges queue as separate runs with their own SHAs.
   Approving run N deploys exactly commit N. No new pinning work required.

3. **One gate job, not `environment:` on six jobs.** Whether GitHub raises one approval per
   environment per run or one per job is not something to guess at. A single
   `approve-production` job makes it deterministic: exactly one approval, one place to reason
   about, and the fan-out ordering stays readable.

4. **`verify-prod-migrations` stays ungated.** It is read-only — it reports what production's
   schema actually is. That information is most useful *before* deciding whether to approve.

5. **QA failure now blocks production.** This is the point of the change, and it is a real
   tradeoff: a QA VPS outage will block production deploys. Accepted deliberately — see Risks.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `.github/workflows/deploy.yml` | Production + QA deploy orchestration | Modify — add `approve-production`, re-wire `needs:` |
| `scripts/check-deploy-gating.sh` | Assert every prod job depends on the gate | Create |
| `scripts/check-deploy-gating.test.sh` | Tests for the guard, using YAML fixtures | Create |
| `.github/workflows/ci.yml` | CI | Modify — run the guard alongside `check-migration-versions.sh` |
| `.github/workflows/README.md` | Workflow documentation | Modify — new flow diagram + job table |
| `package.json` (root) | Root deps | Modify — add `js-yaml` devDependency |
| `docs/runbooks/approve-production-deploy.md` | Operator guide for the approval step | Create |

---

## Chunk 1 — Phase 1: QA-first ordering + approval gate

### Task 1: Guard script that pins the gating invariant

The history of `deploy.yml` is a history of silent gating bugs — the `dorny/paths-filter`
empty-diff bug, the Supabase CLI pin, the path filter that masked DB failures. A gate that can
be removed by one careless `needs:` edit is not a gate. This script fails CI if any
production-mutating job stops depending on `approve-production`.

**Files:**
- Create: `scripts/check-deploy-gating.sh`
- Create: `scripts/check-deploy-gating.test.sh`
- Modify: `package.json` (root) — add `js-yaml` devDependency

- [ ] **Step 1: Add the YAML parser as an explicit dependency**

`js-yaml` and `yaml` are currently present in `node_modules` only as hoisted transitive deps.
Depending on that is exactly the kind of thing that breaks six months from now.

```bash
npm install --save-dev --workspaces=false js-yaml
```

Verify it landed in root `package.json` `devDependencies`, not a workspace.

- [ ] **Step 2: Write the failing test**

Create `scripts/check-deploy-gating.test.sh`, matching the style of the existing
`scripts/verify-prod-migrations.test.sh` (same `pass`/`fail` counters, same `ok`/`FAIL` output).

The script under test takes a workflow file path as `$1` so tests can feed fixtures:

```bash
#!/usr/bin/env bash
#
# Tests for check-deploy-gating.sh (spec-57).
# Run: bash scripts/check-deploy-gating.test.sh
#
set -uo pipefail

SCRIPT="$(dirname "$0")/check-deploy-gating.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

# assert_exit <expected_code> <test name> <workflow yaml>
assert_exit() {
  local expected="$1" name="$2" yaml="$3" actual output
  printf '%s\n' "$yaml" > "$TMP/wf.yml"
  output=$(bash "$SCRIPT" "$TMP/wf.yml" 2>&1)
  actual=$?
  if [ "$actual" -eq "$expected" ]; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1)); echo "  FAIL $name — expected exit $expected, got $actual"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
}

echo "check-deploy-gating.sh"

GOOD='jobs:
  approve-production:
    environment: production
  deploy-vercel:
    needs: [changes, approve-production]
  deploy-worker:
    needs: [changes, approve-production]
  deploy-supabase:
    needs: [changes, approve-production]
  deploy-edge-functions:
    needs: [changes, approve-production]
  deploy-agents:
    needs: [changes, approve-production]
  deploy-solver:
    needs: [changes, approve-production]
  deploy-qa:
    needs: [changes]
  verify-prod-migrations:
    needs: [changes, deploy-supabase]'

# A prod job that forgot the gate — the exact regression this guard exists for.
UNGATED="${GOOD/  deploy-vercel:
    needs: [changes, approve-production]/  deploy-vercel:
    needs: [changes]}"

# The gate job exists but lost its environment, so it never pauses.
NO_ENV="${GOOD/    environment: production/    runs-on: ubuntu-latest}"

# QA must gate the gate.
MISSING_GATE="${GOOD/  approve-production:
    environment: production/  approve-production:
    environment: production
    needs: []}"

assert_exit 0 "passes on a correctly gated workflow" "$GOOD"
assert_exit 1 "fails when a prod job does not need approve-production" "$UNGATED"
assert_exit 1 "fails when approve-production has no environment" "$NO_ENV"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
bash scripts/check-deploy-gating.test.sh
```

Expected: fails — `check-deploy-gating.sh: No such file or directory`.

- [ ] **Step 4: Write the guard script**

Create `scripts/check-deploy-gating.sh`. Parse with `js-yaml` via `node -e` rather than grep —
`needs:` appears in both block and flow style in this file, and grep-based YAML parsing is how
gating bugs get shipped.

```bash
#!/usr/bin/env bash
#
# check-deploy-gating.sh (spec-57) — fails if any production-mutating job in
# deploy.yml can run without passing through the approve-production gate.
#
# The gate is the only thing standing between a merge and production. It must
# not be removable by a stray `needs:` edit, so CI asserts the shape.
#
# Usage: check-deploy-gating.sh [path-to-deploy.yml]
set -euo pipefail

WORKFLOW="${1:-$(dirname "$0")/../.github/workflows/deploy.yml}"
[ -f "$WORKFLOW" ] || { echo "ERROR: no such workflow: $WORKFLOW" >&2; exit 2; }

node -e '
const fs = require("fs");
const yaml = require("js-yaml");

const GATE = "approve-production";
// Every job that mutates production. deploy-qa is deliberately absent (it runs
// BEFORE the gate) and verify-prod-migrations is read-only.
const PROD_JOBS = [
  "deploy-supabase", "deploy-edge-functions", "deploy-vercel",
  "deploy-worker", "deploy-agents", "deploy-solver",
];

const wf = yaml.load(fs.readFileSync(process.argv[1], "utf8"));
const jobs = wf.jobs || {};
const errors = [];

const gate = jobs[GATE];
if (!gate) {
  errors.push(`missing job: ${GATE}`);
} else if (gate.environment !== "production") {
  errors.push(`${GATE} must declare `environment: production` (found: ${JSON.stringify(gate.environment)})`);
}

const needsOf = (j) => {
  const n = (jobs[j] || {}).needs;
  if (!n) return [];
  return Array.isArray(n) ? n : [n];
};

for (const job of PROD_JOBS) {
  if (!jobs[job]) continue;          // job legitimately removed — not this guard`s problem
  if (!needsOf(job).includes(GATE)) {
    errors.push(`${job} does not depend on ${GATE} — it can reach production ungated`);
  }
}

if (!needsOf(GATE).includes("deploy-qa")) {
  errors.push(`${GATE} must depend on deploy-qa — QA is the gate`s precondition`);
}

if (errors.length) {
  console.error("deploy.yml gating check FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("deploy.yml gating check ok — all production jobs pass through " + GATE);
' "$WORKFLOW"
```

> **Implementer note:** the heredoc above uses backticks inside a shell double-quoted
> `node -e` string, which will break. Write the node program to a real file
> (`scripts/check-deploy-gating.mjs`) and have the bash wrapper call it, or use single
> quotes throughout with no backticks. Prefer the separate `.mjs` file — it is testable
> and avoids quoting entirely. Adjust the test's `SCRIPT` path only if you change the
> entry point name.

- [ ] **Step 5: Run the test to verify it passes**

```bash
bash scripts/check-deploy-gating.test.sh
```

Expected: `3 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-deploy-gating.sh scripts/check-deploy-gating.test.sh package.json package-lock.json
git commit -m "test(spec-57): guard asserting every prod deploy job passes the approval gate"
```

---

### Task 2: Add the `approve-production` gate to deploy.yml

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Run the guard against the real workflow to watch it fail**

```bash
bash scripts/check-deploy-gating.sh
```

Expected: FAIL — `missing job: approve-production`, plus one line per ungated prod job.
This is the current production reality, asserted.

- [ ] **Step 2: Insert the gate job**

Add after the `deploy-qa` job block (so file order matches execution order). Note `deploy-qa`
itself is **unchanged** — it keeps `needs: [changes]` and still runs first.

```yaml
  # ─── 8. Production approval gate ─────────────────────────────────────────────
  # The single human checkpoint between a green merge and production (spec-57).
  #
  # Everything that mutates production depends on this job, and this job depends
  # on deploy-qa — so production is reachable only after QA has been synced and
  # its post-checks passed. `environment: production` is what makes it pause:
  # the Production environment carries a required-reviewer rule, so GitHub holds
  # the job until a human approves it in the Actions UI.
  #
  # Because the run holds the `production-deploy` concurrency slot while it
  # waits, later merges queue behind it as separate runs, each pinned to its own
  # DEPLOY_SHA. Approving this run deploys exactly the commit named below.
  #
  # scripts/check-deploy-gating.sh fails CI if any prod job stops depending on
  # this one. Do not remove that check.
  approve-production:
    name: Approve Production Deploy
    needs: [changes, deploy-qa]
    if: always() && !failure() && !cancelled() && needs.deploy-qa.result == 'success'
    environment: production
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Record what is being approved
        run: |
          echo "Approved for production: ${DEPLOY_SHA}"
          echo "QA sync: ${{ needs.deploy-qa.result }}"
          echo "QA environment: https://qa.aureon.tractis.ai"
```

- [ ] **Step 3: Re-wire every production job to depend on the gate**

Apply these exact `needs:`/`if:` edits. The `!failure() && !cancelled()` guards stay as they
are; only the dependency list and the explicit gate check change.

| Job | `needs:` becomes | `if:` gains |
|---|---|---|
| `deploy-supabase` | `[changes, approve-production]` | `needs.approve-production.result == 'success' &&` before the existing `database == 'true'` |
| `deploy-edge-functions` | `[changes, approve-production, deploy-supabase]` | unchanged (already `always() && ...`) |
| `deploy-vercel` | `[changes, approve-production, deploy-supabase, deploy-edge-functions]` | unchanged |
| `deploy-worker` | `[changes, approve-production, deploy-supabase, deploy-edge-functions]` | unchanged |
| `deploy-agents` | `[changes, approve-production, deploy-supabase, deploy-edge-functions]` | unchanged |
| `deploy-solver` | `[changes, approve-production, deploy-supabase, deploy-edge-functions]` | unchanged |

`deploy-supabase` needs the explicit `result == 'success'` check because its `if:` is a plain
path-filter expression with no `always()`, so a skipped gate would otherwise still let it run.
The others already start with `always() && !failure() && !cancelled()`, which correctly treats
a non-successful gate as a stop.

- [ ] **Step 4: Leave `verify-prod-migrations` alone**

It stays `needs: [changes, deploy-supabase]` with its `always()` guard. It is read-only and
its output is what you want *before* approving. Do not add the gate to it.

- [ ] **Step 5: Run the guard to verify it passes**

```bash
bash scripts/check-deploy-gating.sh
```

Expected: `deploy.yml gating check ok — all production jobs pass through approve-production`.

- [ ] **Step 6: Validate the workflow YAML parses**

```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/deploy.yml','utf8')); console.log('yaml ok')"
```

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat(spec-57): gate production deploys behind QA sync + manual approval"
```

---

### Task 3: Wire the guard into CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the check next to the existing migration-version check**

Insert immediately after the `Check migration version prefixes are unique` step — same
rationale (cheap assertions before the slow jobs):

```yaml
      # The production gate is only as good as the wiring. Fails the build if a
      # prod deploy job stops depending on approve-production (spec-57).
      - name: Check production deploy gating
        run: bash ./scripts/check-deploy-gating.sh

      - name: Test the deploy-gating guard
        run: bash ./scripts/check-deploy-gating.test.sh
```

- [ ] **Step 2: Verify locally**

```bash
bash ./scripts/check-deploy-gating.sh && bash ./scripts/check-deploy-gating.test.sh
```

Both exit 0.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(spec-57): assert deploy gating on every build"
```

---

### Task 4: Documentation

**Files:**
- Modify: `.github/workflows/README.md`
- Create: `docs/runbooks/approve-production-deploy.md`

- [ ] **Step 1: Update the flow diagram in `.github/workflows/README.md`**

Replace the diagram at the top with:

```
push / PR ──▶ ci.yml ──(success, push to main)──▶ deploy.yml
                                                    │
                                                    ├─▶ changes
                                                    ├─▶ deploy-qa        (QA VPS)
                                                    ├─▶ approve-production  ⏸ HUMAN
                                                    └─▶ prod fan-out     (DB → edge → app)
```

- [ ] **Step 2: Update the job table**

Add the `approve-production` row and correct the `deploy-qa` row — it is no longer true that
"Never blocks prod". Also update the `deploy-vercel` row: it now requires approval.

- [ ] **Step 3: Replace the stale claim at `deploy.yml:348`**

The comment "No prod job depends on this one" is now false. Rewrite it to say QA is the
precondition for `approve-production`, and that a QA failure blocks production by design.

- [ ] **Step 4: Write the operator runbook**

`docs/runbooks/approve-production-deploy.md` covering:
- Where the approval appears (GitHub → Actions → the run → "Review deployments").
- What to check in QA before approving: https://qa.aureon.tractis.ai, and the
  `verify-prod-migrations` job output for schema drift.
- That approving deploys the SHA named in the `approve-production` job log, not `main`'s tip.
- How to reject, and what state that leaves production in (untouched — nothing has run).
- The emergency path: `docs/runbooks/manual-deployment.md`.
- That a QA VPS outage blocks production, and how to proceed if that is an emergency.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/README.md .github/workflows/deploy.yml docs/runbooks/approve-production-deploy.md
git commit -m "docs(spec-57): document the QA gate and the approval runbook"
```

---

### Task 5: Enable the protection rule (post-merge, manual)

⚠️ **Ordering matters.** Merge the PR *first*, then add the rule. If the rule is added while
`deploy.yml` has no `environment: production`, nothing happens; if it is added before the merge,
this PR's own deploy pauses for approval — harmless, but confusing.

- [ ] **Step 1: Confirm the PR merged and its deploy run completed**

```bash
gh pr checks <N>
gh pr view <N> --json state,mergedAt
gh run list --workflow="Deploy Production" --limit 3
```

- [ ] **Step 2: Add the required reviewer to the `Production` environment**

```bash
gh api -X PUT repos/:owner/:repo/environments/Production \
  -f 'prevent_self_review=false' \
  -F 'reviewers[][type]=User' \
  -F "reviewers[][id]=$(gh api users/gerhard-tractis --jq .id)"
```

`prevent_self_review=false` is required — with a single maintainer, `true` would make every
deploy unapprovable, the same trap that keeps required PR reviews off (`REMEDIATION.md`, C2).

- [ ] **Step 3: Verify the rule is live**

```bash
gh api repos/:owner/:repo/environments/Production --jq '.protection_rules'
```

Expected: a `required_reviewers` rule, not `[]`.

- [ ] **Step 4: Verify end-to-end on the next real merge**

Watch the next merge. Confirm: `deploy-qa` runs → `approve-production` shows
"Waiting for review" → no production job has started → approve → production fan-out runs
against the SHA in the gate job's log.

Record the observed behaviour here — specifically whether GitHub raised **one** approval for
the run, which is the assumption behind the single-gate-job design.

---

## Chunk 2 — Phase 2: E2E against QA

Implemented. Lands **advisory**, not blocking — see "Promotion to blocking" below.

### The account bug this uncovered

`spec52-fixture.ts` never created its `operators` row; it assumed one. That assumption held
only on a developer laptop, where `seed.sql` creates operator
`00000000-0000-0000-0000-000000000001`. `seed.sql` is dev-only, and the sole migration that
ever inserted that operator is `20260209_multi_tenant_rls.sql.bak` — a `.bak`, which
`supabase db push` never applies.

So **any environment built purely from the migration ledger has no such operator**: QA, and
production. The suite would have died on a foreign key at the first `INSERT INTO auth.users`,
before a browser opened.

Fixed with an idempotent `ensureOperator()` at the top of `seed()`. `ON CONFLICT DO NOTHING`
with no conflict target on purpose — on a laptop the id already exists (as
`demo-chile`), in QA neither the id nor the slug does; both must be silent. It is deliberately
**not** removed in teardown: it is shared scaffolding, and on a dev machine the rest of
`seed.sql` hangs off it.

### Tenant isolation is free

Three distinct operators, so E2E data and QA scenario data cannot see each other — the
project's `operator_id`-on-every-query rule doing the work:

| Operator | UUID | Source | In QA? |
|---|---|---|---|
| E2E | `...0000-000000000001` | `ensureOperator()` (new) | yes, now |
| Aureon internal | `...0000-0000000000a1` | `20260616000002` migration | yes |
| QA Test Operator | `...4000-8000-...0001` | `seed-qa.sql` | yes |

### Scope: spec-52 only, for now

`playwright.qa.config.ts` sets `testMatch: /spec52-.*\.spec\.ts$/`. Of the other five specs:

- `auth-pages`, `branding` — screenshot-generation tools (8 and 6 `screenshot` calls), not assertions
- `dispatch-route`, `spec47-pickup-route-end-to-end` — no fixture
- `spec47-consolidated-reception` — already `test.skip(true, 'pending seeded staging fixture')`

That last one has been waiting for exactly this environment. Widen `testMatch` as each grows a
fixture.

### Files

| File | Change |
|---|---|
| `apps/frontend/e2e/support/spec52-fixture.ts` | `ensureOperator()` |
| `apps/frontend/playwright.qa.config.ts` | Create — no `webServer`, QA `baseURL`, `retries: 0` |
| `apps/frontend/package.json` | `e2e`, `e2e:qa` scripts (neither existed) |
| `.github/workflows/deploy.yml` | `e2e-qa` job, section 7b |
| `.gitignore` | Playwright run output |

### Design notes

- **No `webServer`.** QA's frontend already runs under systemd on `:3200`; a `webServer` block
  would try to start a second Next.js on a taken port and hang to timeout.
- **`retries: 0`.** Green-on-retry hides exactly the flakiness that must be understood before
  this gates production.
- **`npx playwright install chromium` without `--with-deps`.** `--with-deps` needs root, and
  this job must not require passwordless sudo. One-time on the VPS if Chromium's system
  libraries are missing: `sudo npx playwright install-deps chromium`.
- **Provisioned-guard.** Mirrors `deploy-qa.sh`: no `/home/aureon/.env.qa` → skip, don't fail.
- **Report artifact**, 14-day retention, with trace and video on failure.

### Promotion to blocking

Deliberately advisory at first: `continue-on-error: true`, and `approve-production` does not
list it in `needs:`. A suite that gates production before its flakiness and runtime are known
just trains you to click through red.

To promote, all three together:

1. add `e2e-qa` to `approve-production`'s `needs:`
2. extend `PROD_JOBS`/assertions in `scripts/check-deploy-gating.mjs` to require that edge
3. drop `continue-on-error: true`

**Unverified until it runs on the VPS:** total suite runtime (per-test timeouts inside the
spec reach 240s; job cap is 30 min), and whether Chromium's system libraries are present.

---

## Risks

| Risk | Mitigation |
|---|---|
| **QA VPS outage blocks production.** Accepted by decision 5. | `docs/runbooks/manual-deployment.md` is the escape hatch. The gate job can also be bypassed by an admin re-running with the environment rule temporarily removed — document, don't automate. |
| **Approval fatigue** — every CSS tweak now waits on a click. | Watch for it. If it bites, the cheapest fix is narrowing `PROD_JOBS` in the guard and dropping the gate from `deploy-vercel` only, *not* disabling the environment rule. |
| **Queued merges pile up** while waiting. | By design — `cancel-in-progress: false`. Each queued run is pinned to its own SHA, so approving them in order is correct. Approve or cancel promptly. **Amended 2026-08-16 — see below: the queue must not include the QA sync.** |
| **GitHub may raise approvals per-job rather than per-run.** Unverified. | The single-gate-job design makes it moot: only one job carries `environment:`. Task 5 Step 4 records the observed behaviour. |
| **The gate is one `needs:` edit from being removed.** | `scripts/check-deploy-gating.sh` runs on every build. |

## Amendment 2026-08-16 — concurrency moved off the workflow

The queueing risk above was accepted for **production** runs. It also queued the
**QA sync**, which was not intended and contradicts `deploy-qa`'s own rule that
"QA is the backstop, so it always runs".

`concurrency: production-deploy` was declared at workflow level, so it covered
every job in the run — `deploy-qa` included — and a run paused at
`approve-production` kept holding the group. Observed the same day this shipped:
the run for `9d2a0f3` sat `pending` with zero jobs started, behind the run for
`3702986` waiting on approval. QA stopped tracking `main` because nobody had
clicked a production button. Since `main` merges continuously and approvals are
occasional, QA drifts arbitrarily far behind — the exact failure the QA-first
ordering exists to prevent.

Fixed by moving concurrency onto the jobs:

- one group per production job (`production-deploy-supabase`, `-vercel`, …) —
  production is still never deployed twice at once, and `worker`/`agents`/`solver`
  keep running in parallel within a run, which a single shared group would have
  serialised
- `deploy-qa` gets its own `qa-deploy` group — two syncs at once would still race
  on the same checkout and build directory on the VPS
- `approve-production` holds no group at all, so waiting for a human costs nothing

`scripts/check-deploy-gating.mjs` now enforces this shape: it fails on any
workflow-level `concurrency`, and on any production job or `deploy-qa` without a
group of its own.

**Known consequence, unchanged from before:** runs are still pinned to their own
`DEPLOY_SHA`, so approving an older queued run after a newer one has deployed
would put older code in production. Approve in order, or cancel the stale ones.

## Out of scope

- Required PR reviews on `main` (`REMEDIATION.md` C2) — still blocked on a second reviewer.
- Database rollback automation — `supabase db push` remains forward-only.
- The stray `virtuous-reflection / production` environment (a Vercel artefact). Unused and
  inert; leave it.
- Vercel Git integration stays disabled — unchanged by this spec, but re-read the warning at
  `.github/workflows/deploy.yml:207` before touching Vercel settings.

---

## Phase 2 addendum — first real E2E runs (2026-08-17)

The `e2e-qa` job ran for the first time. Everything in the harness works; the
**tests themselves are stale**, and by more than one selector.

### Proven working

| | |
|---|---|
| `ensureOperator()` | seeded the tenant — page rendered 3 manifiestos / 3 órdenes / 7 paquetes, exactly the fixture |
| Auth against QA | signed in, reached `/app/pickup` |
| Module gating, tenant isolation | only E2E data visible |
| Chromium on the VPS | launches; `install` without `--with-deps` was sufficient, no sudo needed |
| The `e2e-qa` job itself | ran end-to-end in the pipeline on `c962e4a` after #430 fixed the codeload 429s |
| Advisory wiring | E2E failed, `approve-production` still offered approval — exactly as intended |

### The real problem: the suite encodes a pre-spec-54 journey

spec-54 (#425) rebuilt Recogida. The pickup flow changed shape:

- **Was:** create an empty route → attach manifests from the active-route screen
- **Now:** tick manifests in the table → the route is created *with them attached*

Test 1 was fixed accordingly (tick rows first) and now passes in 10.2s, down from
a 300s timeout. But that fix exposes the next layer: test 2 opens "Agregar
manifiesto" to attach the same three cargas and finds **"Sin manifiestos
disponibles"**, because test 1 already attached them at creation. It then waits
out its timeout.

Tests 3–7 have still never executed.

### What realigning needs

Not a selector sweep — a decision about the journey the suite should assert now.
Options, needing whoever owns spec-54's flow:

1. Test 1 ticks only `LOADS[0]`, leaving 1 and 2 for test 2 to attach. Preserves
   both tests' intent, but assumes an already-attached manifest still appears in
   the pending tab for test 2's scan loop — unverified.
2. Drop test 2's attach block and assert attachment-at-creation instead, which is
   what the product now does.

Option 2 matches the new design; option 1 preserves more coverage. Either way the
suite should be re-derived from the current flow rather than patched selector by
selector.

**`e2e-qa` stays advisory.** It blocks nothing. (Written before the realignment
below; the suite now asserts the current journey — see Resolution.)

### Resolution — suite green (2026-08-17)

All 7 tests pass against QA. **41.6s** total.

Realignment took five runs, each failure landing further along the journey:

| # | Failure | Cause |
|---|---|---|
| 1 | `start-route-button` | spec-54: button only exists once manifests are ticked |
| 2 | "Sin manifiestos disponibles" | spec-54 inverted attach — cargas attach at route creation |
| 3 | `reception-counts` | spec-54 4.5 replaced it with four StatTiles |
| 4 | route code not visible | bare `getByText` on an interpolated heading |
| 5 | `Rita Conductora` not visible | same — name sits inside a three-part text node |

Failures 1–3 were genuine drift: the suite encoded a pre-spec-54 pickup journey.
Failures 4–5 were **the test's own locators**, not product defects — worth stating,
because the driver-name one looked exactly like a regression of the users join that
`20260813000005` exists to prevent. It wasn't. `toContainText` distinguishes
"absent" from "rendered wrong"; `toBeVisible` cannot, which is why the rewritten
assertions use it.

Where a selector had to change, the assertion was strengthened rather than merely
repaired — the counts tile now asserts `expected === 6` instead of mere presence,
since "expected" is precisely what the old RPC alias bug got wrong.

#### Promotion to blocking is now viable

The blocker was never the wiring — it was not knowing the runtime or the failure
rate. **41.6s** is negligible against a ~6min CI run, and the suite is
deterministic across runs (tests 1–4 passed identically in four consecutive runs).

Still recommended: leave advisory until it has run green in the pipeline a few
times unattended. One green run on a hand-driven VPS invocation is not a track
record. The three promotion steps are unchanged.
