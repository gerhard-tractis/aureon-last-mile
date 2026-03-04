# Sprint Change Proposal — 2026-03-03

## Issue Summary

Discovered during Epic 3 retrospective that the BI dashboard (Epic 3) has no live data flowing to it. Three gaps identified:

1. **Data Pipeline Gap** — Epic 2 built data ingestion (orders IN), Epic 3 built dashboard display (OUT), but no story was planned to populate `delivery_attempts` from delivery outcomes. The `calculate_daily_metrics` cron runs nightly but has zero input data.
2. **Beetrack Delivery Status Missing** — DispatchTrack Excel import captures orders at dispatch time but does NOT re-import delivery outcomes (delivered, failed, returned, failure reasons).
3. **Missing Customer-Facing Branding** — Auth page has generic SaaS template content. Dashboard has no customer branding config. Cannot onboard a real customer without professional presentation.

**Impact:** PRD success metric "First customer using BI dashboard daily" is blocked. Dashboard renders empty charts.

---

## Impact Analysis

### Epic Impact
- **Epic 3:** Complete from UI perspective, but business outcome not achieved
- **Epic 4:** Deferred until dashboard is functional with live data
- **Epic 5:** Unaffected in content, shifted in timeline

### Artifact Conflicts
- **PRD:** No text changes needed — requirements already describe this work
- **Architecture:** Minor addition for branding config data model
- **UI/UX:** Auth branding + dashboard branding config (no layout changes)
- **n8n Workflows:** Enhance Beetrack workflow for delivery outcome extraction

---

## Recommended Approach

**Direct Adjustment** — Insert new Epic 3A between Epic 3 and Epic 4.

**Rationale:** Existing work is correct and complete for what was scoped. The gap is missing glue work that was never planned. A focused bridging epic preserves clean epic structure, addresses all issues, and unblocks user onboarding. Low risk — builds on established patterns.

**New epic order:** 1 → 2 → 3 → **3A** → 4 → 5

---

## Epic 3A: Dashboard Data Pipeline & Onboarding Readiness

**Goal:** Connect data ingestion to dashboard visualization and prepare professional branding so the first real customer can be onboarded onto the BI dashboard.

**FRs covered:** FR1-FR7 (completing data flow), FR11 (export with real data), branding (non-functional)

---

### Story 3A.1: Populate delivery_attempts from DispatchTrack Order Status

As an operations manager,
I want delivery outcomes from DispatchTrack to flow into the `delivery_attempts` table,
So that the dashboard metrics calculation has real data.

**Key Work:**
- Enhance existing Beetrack n8n workflow (or add second scheduled workflow) to re-process DispatchTrack Excel reports and extract delivery outcomes
- When `Estado` indicates terminal status (Entregado, Fallido, Devuelto, etc.), create/update `delivery_attempts` row
- Map DispatchTrack failure reasons to `failure_reason` field
- Handle idempotency — same order re-imported shouldn't create duplicate attempts
- `attempt_number` = 1 for first delivery attempt (critical for FADR calculation)

**Dependencies:** Existing Beetrack n8n workflow, `delivery_attempts` table (Story 3.1)

---

### Story 3A.2: End-to-End Data Pipeline Validation & Metrics Calculation

As an operations manager,
I want to verify that data flows correctly from order ingestion through to dashboard display,
So that I can trust the numbers I see.

**Key Work:**
- Validate `calculate_daily_metrics` cron produces correct `performance_metrics` rows from real `delivery_attempts` data
- Verify dashboard queries return and display calculated metrics correctly
- Fix any data type or calculation issues discovered during E2E testing
- Seed or backfill historical data from existing DispatchTrack imports if possible
- Verify all dashboard sections: SLA hero, primary metrics, customer table, failed deliveries, secondary metrics

**Dependencies:** Story 3A.1

---

### Story 3A.3: Tractis Branding on Auth Pages

As the platform operator (Tractis),
I want the auth pages to display Tractis corporate branding,
So that users see a professional, branded login experience.

**Key Work:**
- Add Tractis logo image to auth layout (replace text-only product name)
- Replace generic testimonial content on auth right panel with Tractis/Aureon messaging
- Set `NEXT_PUBLIC_PRODUCTNAME` to "Aureon Last Mile"
- Apply Tractis brand colors (gold `#e6c15c` + slate from existing CSS variables)
- Update favicon and PWA icons with Tractis branding
- Ensure all auth pages affected: login, register, forgot-password, verify-email, 2FA, reset-password

**Dependencies:** None (independent of data pipeline work)

---

### Story 3A.4: Customer Branding Configuration on Dashboard

As a platform operator,
I want to configure per-customer branding (logo, favicon, colors) for the dashboard,
So that each customer sees their own branding when using the platform.

**Key Work:**
- Add branding config to `operators` table or new `branding_config` table: logo_url, favicon_url, primary_color, secondary_color, company_name
- Create branding provider that loads operator config on login and applies CSS variables dynamically
- Display customer logo in dashboard sidebar header (replace text-only product name)
- Apply customer color theme dynamically (extend existing CSS variable system — already fully variable-driven)
- Fallback to Tractis/Aureon default branding when no customer config exists

**Dependencies:** None (independent of data pipeline work)

---

### Story 3A.5: User Onboarding Verification

As Gerhard (platform operator),
I want to onboard the first real customer (Musan) onto the dashboard with live data and proper branding,
So that Epic 3's business value is realized.

**Key Work:**
- Configure Musan operator branding (logo, colors)
- Verify live data flowing: DispatchTrack → delivery_attempts → performance_metrics → dashboard
- Walk through all dashboard sections with real data: SLA hero, primary metrics, customer table, failed deliveries, secondary metrics
- Verify export (CSV + PDF) produces correct reports with real data
- Document any issues found and fix them
- Confirm PRD success metric achievable: "First customer using BI dashboard daily"

**Dependencies:** Stories 3A.1, 3A.2, 3A.3, 3A.4

---

### Story 3A.6: Operational Alerting — n8n Workflow Failures & Cookie Expiry

As Gerhard (platform operator),
I want to receive immediate, friendly alerts via Slack when n8n workflows fail or when DispatchTrack session cookies expire,
So that data pipeline incidents are caught and resolved within hours, not days.

**Key Work:**

*Slack Setup:*
- Create a dedicated Slack channel (e.g. `#aureon-alerts`) for operational alerts
- Configure a Slack incoming webhook for that channel

*n8n Error Workflow:*
- Create an n8n Error Workflow that triggers on any workflow failure and posts a raw alert to the Slack channel with: workflow name, error message, timestamp, and link to the n8n execution
- Set this as the global error handler in n8n instance settings

*Worker Cookie Expiry Alert:*
- When `beetrack_session_expired` fires in the VPS worker, post a raw alert to the same Slack channel with: connector name, timestamp, and instructions to refresh cookies

*OpenClaw Integration:*
- Install and configure OpenClaw (openclaw.ai) on the VPS connected to the Slack alerts channel
- Configure OpenClaw with context about the Aureon platform so it can interpret raw technical alerts
- OpenClaw reads incoming raw alerts and reformats them into friendly, actionable messages delivered directly to Gerhard via Slack DM

**Acceptance Criteria:**
- When any n8n workflow fails, a friendly alert is delivered to Gerhard within 5 minutes
- When Paris DispatchTrack session expires, a friendly alert arrives immediately with clear instructions on what to do
- OpenClaw reformats raw technical alerts into human-readable messages before delivery to Gerhard
- All alert infrastructure runs on the existing VPS — no new paid services required

**Dependencies:** Story 3A.1 (beetrack_session_expired event exists in worker)

---

## Scope Classification: Moderate

- New epic insertion requiring backlog reorganization
- SM to create detailed story contexts via Create Story workflow
- Architect to review branding config data model
- Dev team to implement
- QA to test E2E data flow and branding

## Handoff Plan

| Role | Responsibility |
|---|---|
| Bob (SM) | Run Sprint Planning to add Epic 3A, then Create Story for each story |
| Winston (Architect) | Review branding config data model for Story 3A.4 |
| Amelia (Dev) | Implement all stories |
| Quinn (QA) | Test E2E data flow and branding |
| Gerhard (Project Lead) | Story 3A.5 acceptance — real user onboarding validation |

## Success Criteria

1. Dashboard displays real metrics from live DispatchTrack data
2. `delivery_attempts` table populated automatically from delivery outcomes
3. `performance_metrics` table populated nightly by cron from real data
4. Auth pages show Tractis branding (logo, colors, professional content)
5. Dashboard shows customer-specific branding (Musan logo, colors)
6. First real user (Musan operator) can log in and use dashboard for operational decisions

---

*Approved by: Gerhard (Project Lead) — 2026-03-03*
*Generated by: Bob (Scrum Master) via Course Correction workflow*
