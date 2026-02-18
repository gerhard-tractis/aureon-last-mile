# Sprint Change Proposal — Epic 2 Scope Expansion

**Date:** 2026-02-18
**Triggered by:** Story 2.3 (pre-implementation scope review)
**Proposed by:** Gerhard (Product Owner) + Bob (Scrum Master)
**Status:** Pending Approval

---

## Section 1: Issue Summary

### Problem Statement

Story 2.3 ("Implement Email Manifest Parsing — n8n Workflow") was scoped as a narrow email parser on Railway. Before implementation began, a new product brief (`tractis-automation-worker-spec.md`) was produced that redefines the scope to a **multi-tenant automation worker** running on a dedicated VPS.

### Why the Change

The original story only addressed one data ingestion path (email/CSV). Real-world tenant needs require:

1. **Browser scraping** — Paris/Cencosud delivers orders via Beetrack portal (no API, no email). Must authenticate and extract data.
2. **Typed connector framework** — Each retail client uses a different delivery method (CSV email, browser portal, API). Need a pluggable system, not one-off integrations.
3. **Dedicated infrastructure** — Browser automation requires persistent Playwright/Chromium and more control than Railway provides. A VPS (Hostinger KVM 2, São Paulo, $6.99/mo) is cheaper and more capable.
4. **First real tenant** — Transportes Musan with two retail clients (Easy + Paris) provides concrete requirements instead of hypothetical ones.

### Supporting Evidence

- **PRD alignment:** FR8 (email parsing), FR10 (retailer APIs/polling), FR47 (graceful degradation) — new spec fulfills all three; old story only addressed FR8.
- **PRD explicitly mentions:** "integrations with Beetrack, SimpliRoute, Driv.in" — browser connector directly addresses this.
- **Architecture doc:** Already planned n8n for email import, API polling, and webhook receiving — new spec implements all three connector types.
- **Cost benefit:** VPS at $6.99/mo + Groq at ~$1/mo vs Railway at $5-20/mo. Comparable cost, much more capability.

---

## Section 2: Impact Analysis

### Epic Impact

**Epic 2 (Order Data Ingestion) — MODIFIED**

| Aspect | Before | After |
|--------|--------|-------|
| Stories | 4 (2.1-2.4) | 8 (2.1-2.8) |
| Infrastructure | Railway (n8n only) | Hostinger VPS (n8n + OpenClaw + Playwright) |
| Connector types | Email/CSV only | CSV/Email + Browser + API (typed framework) |
| First tenant | Generic (Aureon operators) | Transportes Musan (Easy + Paris) |
| Estimated duration | ~2 weeks | ~4 weeks |

**Epics 1, 3, 4, 5 — NO CHANGES**
- Epic 1: Complete (retrospective done). No reopening needed.
- Epic 3 (BI Dashboard): Unaffected — reads from same `orders` table.
- Epic 4 (Pickup Verification): Unaffected — reads from same `orders`/`packages` tables.
- Epic 5 (Operations Management): Unaffected.

### Story Impact

**Stories retained (no changes):**
- **2.1** — Create orders + packages tables (`review`) ✅
- **2.2** — CSV/Excel upload UI (`ready-for-dev`) ✅

**Story rewritten:**
- **2.3** — OLD: Email manifest parsing (n8n on Railway) → NEW: VPS infrastructure + n8n setup (Hostinger)

**Story replaced:**
- **2.4** — OLD: Manual order entry form → NEW: Automation worker database schema

**New stories added:**
- **2.5** — Easy CSV/Email connector (n8n workflow on VPS)
- **2.6** — Paris/Beetrack browser connector (OpenClaw + Playwright + Groq)
- **2.7** — Job queue orchestration + monitoring + alerting
- **2.8** — Manual order entry form (moved from old 2.4)

### Artifact Conflicts

| Artifact | Impact | Changes Needed |
|----------|--------|---------------|
| **PRD** | Low | Minor: update tech approach from "Python script/serverless" to "n8n on VPS" |
| **Architecture** | **High** | n8n moves Railway→VPS; add OpenClaw/Playwright/Groq components; add `apps/worker/` structure; update data model; remove Redis/BullMQ |
| **UI/UX** | None | Worker is backend-only, no UI changes |
| **Deployment Runbook** | **Medium** | New VPS section; Railway n8n section becomes obsolete |
| **CI/CD** | **Medium** | New GitHub Actions workflow for VPS deployment via SSH |
| **Monitoring** | Low | Extend Sentry + BetterStack to cover VPS processes |

### Technical Impact

**New app directory:**
```
apps/
├── frontend/     # Next.js SaaS → Vercel (unchanged)
├── mobile/       # React Native → App stores (unchanged)
├── worker/       # Automation worker → VPS (NEW)
```

**Database changes (extend existing, don't replace):**
- **Extend `orders` table:** Add columns `external_load_id`, `recipient_region`, `service_type`, `total_weight_kg`, `total_volume_m3`, `status`, `status_detail`, `source_file`, `tenant_client_id` (FK)
- **New table:** `tenant_clients` (connector type, config, per-operator retail client mapping)
- **New table:** `jobs` (job queue with status, priority, retry logic)
- **New table:** `raw_files` (audit trail for all received files)
- **Existing `operators` table = tenants** (no new tenants table — reuse operators)

**Contract layer:** Supabase is the only communication channel between VPS worker and Vercel SaaS. They never talk directly.

---

## Section 3: Recommended Approach

### Selected Path: Direct Adjustment (Option 1)

**Rationale:**
1. The automation worker IS order data ingestion — it belongs in Epic 2.
2. Everything built so far (Stories 2.1, 2.2) is reused as-is.
3. MVP (Epics 3-4) is not threatened — Epic 2 is pre-MVP infrastructure.
4. Risk is managed by sequencing simpler pieces first (CSV connector before browser scraping).

**Trade-offs considered:**
- Epic 2 doubles in size (~4 weeks vs ~2 weeks). Acceptable because the work delivers more value and aligns better with the PRD.
- Browser scraping (Story 2.6) is highest-risk due to new tech (OpenClaw + Groq). Mitigated by making it independent — if it slips, CSV upload + email connector still work.
- Manual entry form (old 2.4) gets deferred to 2.8. Acceptable — automation reduces the need for manual entry.

---

## Section 4: Detailed Change Proposals

### Epic 2 — New Story Breakdown

```
Story: 2.3 (REWRITTEN)
Section: Entire story

OLD:
  Title: Implement Email Manifest Parsing (n8n Workflow)
  Scope: n8n on Railway, email polling, CSV parsing, POST to API

NEW:
  Title: Set Up VPS Infrastructure and n8n
  Scope: Provision Hostinger VPS (São Paulo), install Node.js/n8n/Playwright,
         configure systemd services, set up apps/worker/ directory structure,
         configure n8n basic auth, verify connectivity to Supabase

Rationale: Infrastructure must exist before any connector can run.
           Railway replaced by VPS for Playwright support and cost efficiency.
```

```
Story: 2.4 (REPLACED)
Section: Entire story

OLD:
  Title: Build Manual Order Entry Form (Fallback)
  Scope: Web form for single order entry at /orders/new

NEW:
  Title: Create Automation Worker Database Schema
  Scope: New tables (tenant_clients, jobs, raw_files), extend orders table
         with new columns, RLS policies, seed Musan tenant data,
         connector_config JSONB structure for csv_email/browser/api types

Rationale: Database schema is required before any connector can write data.
           Manual form deferred to 2.8 (lower priority with automation in place).
```

```
Story: 2.5 (NEW)
Title: Implement Easy CSV/Email Connector
Scope: n8n workflow on VPS — IMAP trigger for Musan email, filter Easy sender,
       extract CSV attachment, parse with column mapping, upsert to orders table
       via Supabase service role, store raw file in Supabase Storage,
       log job execution, handle cumulative CSV logic (UPSERT on conflict)

Rationale: Lowest-risk connector. Proves VPS + n8n + Supabase pipeline works.
           Reuses Story 2.2 validation logic where applicable.
```

```
Story: 2.6 (NEW)
Title: Implement Paris/Beetrack Browser Connector
Scope: OpenClaw + Playwright + Groq (Llama 4 Scout) on VPS,
       authenticate to Beetrack portal, navigate to orders section,
       extract today's orders (handle pagination), map to orders schema,
       upsert to Supabase, store raw extraction as JSON in Storage,
       screenshot on failure for debugging, credential encryption

Rationale: Highest-risk story (new tech stack). Sequenced after CSV connector
           so VPS infrastructure is proven. Independent — doesn't block other stories.
```

```
Story: 2.7 (NEW)
Title: Implement Job Queue Orchestration and Monitoring
Scope: Worker loop (poll jobs table every 30s, FOR UPDATE SKIP LOCKED),
       job lifecycle (pending→running→completed/failed), retry logic (max 3),
       scheduled job creation (cron for browser connectors),
       health checks (systemd watchdog), alerts via n8n (failed jobs,
       no completions in window, disk usage), Sentry integration for errors,
       deploy.sh script, GitHub Actions workflow for VPS deployment

Rationale: Ties everything together. Ensures reliability and observability.
           Includes CI/CD for VPS which is needed for ongoing maintenance.
```

```
Story: 2.8 (MOVED from old 2.4)
Title: Build Manual Order Entry Form (Fallback)
Scope: (Same as original Story 2.4 — no changes to requirements)
       Web form at /orders/new for single order entry,
       react-hook-form + Zod validation, comuna autocomplete,
       duplicate check, imported_via = 'MANUAL'

Rationale: Deferred to end of epic. With automation worker handling
           Easy and Paris, manual entry becomes a rare fallback.
```

### Architecture Document Updates

```
Artifact: architecture.md
Section: Infrastructure — Backend + Workers

OLD:
  Backend + Workers: Railway (Node.js/Express + n8n)
  - aureon-api (Next.js API routes)
  - n8n (integration workflows)
  - redis (caching + BullMQ)

NEW:
  Frontend + API: Vercel (Next.js — unchanged)
  Automation Worker: Hostinger VPS (São Paulo, KVM 2)
  - n8n (workflow orchestration, IMAP listener, CSV processing) — 24/7 daemon
  - OpenClaw + Playwright (browser automation) — on-demand per job
  - Worker process (job queue orchestrator) — 24/7 daemon
  - Node.js 20+ runtime
  - No Redis needed — Supabase jobs table serves as job queue

Rationale: VPS provides persistent Playwright/Chromium for browser scraping,
           lower cost ($6.99/mo), and full control. Redis removed — Supabase
           FOR UPDATE SKIP LOCKED is simpler and eliminates a dependency.
```

```
Artifact: architecture.md
Section: New — External Services (Automation Worker)

ADD:
  | Service | Purpose | Cost |
  |---------|---------|------|
  | Groq API | LLM inference for browser agent (Llama 4 Scout) | ~$1/month |
  | Hostinger VPS | KVM 2: 2 vCPU, 8GB RAM, 100GB NVMe, São Paulo | $6.99/month |

Rationale: New infrastructure components not in original architecture.
```

```
Artifact: architecture.md
Section: Application Structure

OLD:
  apps/
  ├── frontend/    # Next.js → Vercel
  ├── mobile/      # React Native → App stores

NEW:
  apps/
  ├── frontend/    # Next.js SaaS → Vercel (UI + API routes)
  ├── mobile/      # React Native → App stores
  ├── worker/      # Automation worker → VPS (Hostinger)

Rationale: Worker is a separate deployment unit with its own runtime,
           process model, and dependencies. Supabase is the contract
           layer — worker and frontend never communicate directly.
```

### Deployment Runbook Updates

```
Artifact: deployment-runbook.md
Section: Railway / n8n Setup

OLD:
  Required for: Story 2.3+ (n8n email manifest parsing)
  [Railway deployment instructions for n8n]

NEW:
  OBSOLETE — n8n now deploys to Hostinger VPS (see VPS section below)

  NEW SECTION: VPS Deployment (Hostinger)
  Required for: Stories 2.3-2.7 (automation worker)
  - VPS provisioning and setup script
  - systemd service configuration (n8n + worker)
  - Environment variables
  - SSH deployment via GitHub Actions
  - Monitoring integration

Rationale: n8n moves from Railway to VPS to support Playwright browser automation.
```

### Sprint Status Updates

```
Artifact: sprint-status.yaml
Section: development_status (Epic 2)

OLD:
  2-3-implement-email-manifest-parsing-n8n-workflow: backlog
  2-4-build-manual-order-entry-form-fallback: backlog

NEW:
  2-3-set-up-vps-infrastructure-and-n8n: backlog
  2-4-create-automation-worker-database-schema: backlog
  2-5-implement-easy-csv-email-connector: backlog
  2-6-implement-paris-beetrack-browser-connector: backlog
  2-7-implement-job-queue-orchestration-and-monitoring: backlog
  2-8-build-manual-order-entry-form-fallback: backlog

Rationale: Reflects new story breakdown. Old stories replaced/moved.
```

---

## Section 5: Implementation Handoff

### Change Scope Classification: **Moderate**

This requires backlog reorganization (new stories, changed sequence) plus architecture doc updates, but no fundamental replan of the product vision.

### Handoff Plan

| Role | Responsibility |
|------|---------------|
| **SM (Bob)** | Update sprint-status.yaml, delete old story 2.3 file, create new story files for 2.3-2.8 via Create Story workflow |
| **Dev Team** | Implement stories in sequence: 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 → 2.8 |
| **Architecture (deferred)** | Update architecture.md as subtask within Story 2.3 (VPS setup) |
| **Gerhard (PO)** | Review each new story as created, provide Musan-specific details (Easy CSV format, Beetrack credentials, email addresses) |

### Success Criteria

1. Sprint-status.yaml reflects new story breakdown
2. Old Story 2.3 file replaced with new VPS infrastructure story
3. Stories 2.4-2.8 created via Create Story workflow with full context
4. Architecture doc updated during Story 2.3 implementation
5. Deployment runbook updated with VPS section during Story 2.3
6. Transportes Musan (Easy + Paris) data flowing into Supabase by end of Epic 2

### Open Items Requiring Gerhard's Input (Before Story Creation)

1. **Easy CSV sample:** Need actual CSV from Musan to confirm column names and encoding
2. **Beetrack credentials:** Confirm Musan has active Paris/Beetrack access
3. **Email address:** Which IMAP inbox for Musan's Easy emails?
4. **Notification channel:** Where should worker alerts go? (Email, Telegram, Slack?)
5. **Data retention:** How long to keep raw files in Supabase Storage?
6. **OpenClaw version:** Verify latest stable version before Story 2.6

---

*Generated by Course Correction workflow — 2026-02-18*
