# ADR-005: CI/CD Deployment Strategy

**Status:** ✅ Accepted
**Date:** 2026-02-10
**Deciders:** Gerhard (Product Owner), Claude Sonnet 4.5 (Dev Agent)
**Related Story:** [Story 1.1 - Task 6](../implementation-artifacts/1-1-clone-and-deploy-razikus-template-skeleton.md#task-6-set-up-cicd-pipeline-ac-9)

---

## Context

### Problem Statement

We needed to implement a CI/CD pipeline for the Aureon Last Mile platform that ensures code quality while managing deployment costs effectively.

### Business Constraints

- **MVP Budget:** Limited funding, every dollar counts
- **Deployment Costs:**
  - Vercel charges per deployment (build minutes + bandwidth)
  - Railway charges per build minute
  - Auto-deploy on every push = 80+ deploys/month
  - Manual deploy when ready = 8-10 deploys/month
  - **Cost difference:** ~90% savings (8 vs 80 deploys/month)

- **Development Velocity:** Single developer initially (AI-accelerated)
- **Deployment Frequency:** MVP phase = 1-2 deploys per week (not multiple per day)
- **Quality Requirements:** PRD requires 70% test coverage, zero tolerance for regressions

### Technical Context

- **Platform:** Next.js 15 frontend (Vercel), potential Node.js backend (Railway)
- **Repository:** Monorepo with `apps/frontend` and `apps/backend` (future)
- **CI Requirements:** Type-check, lint, test (70% coverage), build verification
- **CD Requirements:** Deploy to production when ready

### User Concern

> "I have one issue: Having CD with Vercel makes the cost go to the sky. Every redeploy punches me in the face. I don't know if Railway charges for building or redeploy, I believe it does. Cannot we implement CI/CD without pushing it automatically to Vercel and Railway?"

---

## Decision

**We chose Option A: CI Always, CD Manual (Cost Control)**

### Implementation

**Continuous Integration (CI):** Automatic on every push/PR
- ✅ Runs in GitHub Actions (FREE - 2,000 minutes/month)
- ✅ Type-check (TypeScript strict mode)
- ✅ ESLint (naming conventions, code quality)
- ✅ Vitest tests with 70% coverage enforcement
- ✅ Production build verification
- ✅ Matrix testing (Node 20.x, 22.x)
- ✅ Codecov integration for coverage tracking

**Continuous Deployment (CD):** Manual trigger only
- ❌ No automatic deployment on push to `main`
- ❌ No preview deployments on PRs
- ✅ Deploy manually via Vercel dashboard when ready
- ✅ Deploy manually via CLI: `npx vercel --prod`
- ✅ Full CI validation before manual deploy

### Configuration

**GitHub Actions:**
- `.github/workflows/test.yml` - CI pipeline (runs on every push/PR)
- `.github/workflows/deploy.yml` - Deleted (was auto-deploy)

**Vercel Settings:**
- Auto-deployments: Disabled (or set to ignore `main` branch)
- Preview deployments: Disabled for cost control

**Documentation:**
- [.github/workflows/README.md](../../.github/workflows/README.md) - Complete CI/CD guide

---

## Alternatives Considered

### Option B: Auto-Deploy on Every Merge (Industry Standard)

**Approach:** Automatic deployment on every push to `main`, preview deployments on PRs.

**Pros:**
- ✅ Zero manual intervention (true continuous deployment)
- ✅ Instant feedback (see changes live immediately)
- ✅ Industry best practice (what most teams do)
- ✅ Preview URLs for every PR (great for demos/testing)

**Cons:**
- ❌ **Expensive:** 80+ deploys/month (20 commits/week × 4 weeks + 10 PRs/month)
- ❌ **Wasteful:** Deploy every commit even if next commit is 5 minutes later
- ❌ **Unnecessary:** MVP doesn't need instant production deployments
- ❌ **Preview costs:** Every PR = separate deployment ($$$)

**Cost Estimate:** 80 deploys/month × Vercel pricing = 💸💸💸

**Verdict:** ❌ **Rejected** - Too expensive for MVP budget constraints

---

### Option C: Tag-Based Deployment (Versioned Releases)

**Approach:** Auto-deploy only on Git tags (e.g., `v1.0.0`, `v1.1.0`).

**Pros:**
- ✅ Controlled deployment frequency (deploy when you tag)
- ✅ Semantic versioning built-in
- ✅ Predictable costs (1-2 deploys per week)
- ✅ Professional release process
- ✅ Easy rollback (deploy previous tag)

**Cons:**
- ⚠️ Extra step: Create tag + push tag (not just push)
- ⚠️ Learning curve: Team must adopt tagging workflow
- ⚠️ Tag management: Must clean up old tags, maintain versioning scheme

**Cost Estimate:** 8-10 deploys/month (similar to manual)

**Verdict:** ⏸️ **Deferred** - Good future upgrade path when team grows

---

### Option D: Scheduled Deployments (Daily/Weekly)

**Approach:** Auto-deploy on a fixed schedule (e.g., every Monday 9 AM).

**Pros:**
- ✅ Fixed deployment frequency (predictable costs)
- ✅ Batches changes (deploy multiple commits at once)
- ✅ No manual intervention

**Cons:**
- ❌ **Rigid:** Can't deploy urgent fixes between scheduled times
- ❌ **Delays:** Bug fix on Tuesday waits until next Monday
- ❌ **Poor fit:** MVP needs flexibility, not fixed schedules

**Verdict:** ❌ **Rejected** - Too inflexible for MVP development

---

### Option E: Release Branch Strategy

**Approach:** Two branches: `main` (dev, CI only) and `production` (auto-deploy).

**Pros:**
- ✅ Controlled deployments (merge to `production` when ready)
- ✅ Clear separation (dev vs prod)
- ✅ CI runs on all commits, deploy only on `production` merges

**Cons:**
- ⚠️ Branch management overhead (maintain two branches)
- ⚠️ Merge conflicts (sync `main` → `production`)
- ⚠️ Overkill for single developer

**Verdict:** ⏸️ **Deferred** - Consider when team has 3+ developers

---

## Consequences

### Positive

1. **Cost Savings: ~90% Reduction**
   - **Before:** 80 deploys/month (auto-deploy)
   - **After:** 8 deploys/month (manual)
   - **Savings:** 72 fewer deployments = significant cost reduction
   - **Impact:** More runway for MVP, budget allocated to features instead of infrastructure

2. **Full CI Protection (FREE)**
   - Every commit validated (type-check, lint, test, build)
   - 70% coverage threshold enforced
   - Runs in GitHub Actions (free for public repos, 2,000 min/month for private)
   - Catches bugs before deployment (same safety as auto-deploy)

3. **Deployment Control**
   - Deploy when features are complete (not on every commit)
   - Batch multiple commits into one deployment
   - Test locally before deploying (extra safety layer)
   - No accidental deployments from experimental commits

4. **Flexible Upgrade Path**
   - Easy to switch to tag-based (add workflow, start tagging)
   - Easy to switch to auto-deploy (enable Vercel setting)
   - CI pipeline remains unchanged (already built)

5. **Professional Workflow**
   - CI runs on every commit (industry standard)
   - Manual deployment = conscious decision (not automatic)
   - Forces review before production (quality gate)

### Negative

1. **Manual Step Required**
   - Developer must remember to deploy after merging
   - Extra step: Go to Vercel dashboard → Click "Deploy"
   - **Mitigation:** Document deployment process, add to release checklist

2. **No Preview Deployments**
   - PRs don't get automatic preview URLs
   - Harder to demo features before merge
   - **Mitigation:** Test locally, use `npx vercel` for one-off previews if needed

3. **Potential Delay**
   - Changes merged to `main` not instantly live
   - Could forget to deploy (changes sit in `main` undeployed)
   - **Mitigation:** Post-merge checklist, Slack reminder, or GitHub Action comment

4. **Not "True" Continuous Deployment**
   - Doesn't follow strict CD definition (auto-deploy after CI passes)
   - **Trade-off:** Cost savings > semantic purity

### Neutral

- **Single Developer Impact:** Minimal overhead for solo dev (10 seconds to click deploy)
- **Team Scaling:** Will need to revisit when team reaches 3-5 developers
- **Deployment Frequency:** 1-2x per week is appropriate for MVP phase

---

## Upgrade Path

### When to Switch to Tag-Based Deployment (Option C)

**Criteria:**
- ✅ Team size: 2+ developers
- ✅ Deployment frequency: 2+ per week
- ✅ Need for: Release notes, versioning, rollback simplicity
- ✅ Comfortable with: Git tagging workflow

**Migration Steps:**
1. Create `.github/workflows/deploy-on-tag.yml`:
   ```yaml
   on:
     push:
       tags:
         - 'v*.*.*'
   ```
2. Adopt semantic versioning (v1.0.0, v1.1.0, v1.1.1)
3. Document tagging workflow in README
4. Test: `git tag v1.0.0 && git push origin v1.0.0`

**Estimated Effort:** 1 hour

---

### When to Switch to Auto-Deploy (Option B)

**Criteria:**
- ✅ Funding secured (costs no longer a concern)
- ✅ High deployment frequency: 5+ per week
- ✅ Need for: Instant production updates, preview deployments
- ✅ Willing to accept: Higher infrastructure costs

**Migration Steps:**
1. Enable Vercel auto-deployments in project settings
2. Optionally: Create `.github/workflows/deploy.yml` for smoke tests
3. Update documentation to reflect auto-deploy workflow

**Estimated Effort:** 30 minutes

---

## Validation

### Success Metrics

- ✅ **CI runs on every commit:** 100% coverage (all PRs/pushes trigger CI)
- ✅ **Deployment cost reduction:** 90% savings (8 vs 80 deploys/month)
- ✅ **Quality maintained:** 70% test coverage enforced, zero regressions shipped
- ✅ **Developer experience:** <10 seconds to trigger manual deploy

### Monitoring

- GitHub Actions run history (verify CI runs on every commit)
- Vercel deployment dashboard (track deployment frequency)
- Monthly cost review (compare Vercel/Railway bills)
- Developer feedback (assess manual deploy overhead)

---

## Implementation Status

**Status:** ✅ **IMPLEMENTED** (2026-02-10)

**Completed:**
- ✅ `.github/workflows/test.yml` created (CI pipeline)
- ✅ `.github/workflows/README.md` created (documentation)
- ✅ Vercel auto-deploy disabled (settings configured)
- ✅ All documentation updated (README, architecture.md, epics.md)
- ✅ Story file updated (Task 6.1-6.2 complete)

**Pending:**
- ⏳ Task 6.3: Configure GitHub branch protection (require CI checks)
- ⏳ Task 6.4: Test CI pipeline (create test PR)

---

## References

### Internal Documentation
- [CI/CD Implementation Guide](../../.github/workflows/README.md)
- [Story 1.1 - Task 6](../implementation-artifacts/1-1-clone-and-deploy-razikus-template-skeleton.md#task-6-set-up-cicd-pipeline-ac-9)
- [Architecture Document](../planning-artifacts/architecture.md#cicd)
- [ADR-004: Monorepo Structure](./ADR-004-monorepo-structure.md) - Related infrastructure decision

### External Resources
- [GitHub Actions Pricing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
- [Vercel Pricing](https://vercel.com/pricing)
- [Railway Pricing](https://railway.app/pricing)
- [Martin Fowler: Continuous Delivery](https://martinfowler.com/bliki/ContinuousDelivery.html)

---

## Decision Log

| Date | Event | Notes |
|------|-------|-------|
| 2026-02-10 | Decision made | Option A selected (CI always, CD manual) |
| 2026-02-10 | Implemented | test.yml created, documentation complete |
| TBD | Review | Revisit when team reaches 2+ developers |

---

## Notes

- **Cost optimization is a valid architectural constraint** - This ADR establishes precedent that MVP budget constraints influence infrastructure decisions
- **CI/CD is not all-or-nothing** - Continuous Integration (CI) provides most of the quality benefits; Continuous Deployment (CD) is an optimization, not a requirement
- **Right tool for right phase** - Manual deployment fits MVP phase; auto-deploy fits scale-up phase
- **Future-proof design** - CI pipeline works with all CD strategies (manual, tag-based, auto-deploy)

---

**Related ADRs:**
- [ADR-001: PWA Library Selection](./ADR-001-pwa-library-selection.md) - Also considered cost/benefit trade-offs
- [ADR-004: Monorepo Structure](./ADR-004-monorepo-structure.md) - Infrastructure decision enabling simple CI/CD

---

**This ADR answers the question:** "Why don't we have automatic deployments like other modern projects?"

**Answer:** Cost optimization for MVP. We get full CI protection (free) while controlling deployment costs (90% savings). Easy to upgrade to auto-deploy when funding permits.
