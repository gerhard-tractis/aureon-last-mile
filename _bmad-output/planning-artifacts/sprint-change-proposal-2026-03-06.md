# Sprint Change Proposal — Epic 3B: Delivery & Fleet Intelligence
**Date:** 2026-03-06
**Prepared by:** Bob (Scrum Master)
**Status:** Pending Approval

---

## Section 1: Issue Summary

**Trigger:** Customer feedback from Musan operator post-delivery of Epic 3A dashboard.

**Problem statement:** Epics 4 (Pickup Verification) and 5 (Operations Control Center) are too complex as the next step. The customer's immediate need is simpler: track which orders are delivered and which are not, using their existing DispatchTrack (Beetrack) account. The platform currently ingests orders (state = `created`) but has no automated pipeline to update order status based on delivery outcomes. Additionally, the DispatchTrack webhook is already firing to a Supabase Edge Function, but the function discards most data — only storing terminal dispatch events in `delivery_attempts`, and ignoring route, review, dispatch_guide, fleet, and non-terminal events entirely.

**Business goal:** Enable OTIF (On-Time In-Full) tracking per customer, and begin capturing fleet operational data (km driven, idle times) to drive future cost optimization (distance optimization, fleet sizing).

**Evidence:**
- Customer confirmed they want delivery tracking before pickup verification
- DispatchTrack webhook is live and sending events (edge function at `apps/frontend/supabase/functions/beetrack-webhook/index.ts`)
- PR #68 merged: full payload logging enabled to discover all resource types and fields
- Existing `delivery_attempts` table only captures terminal outcomes — no routes, no fleet, no intermediate states

---

## Section 2: Impact Analysis

### Epic Impact

| Epic | Current Status | Change |
|------|---------------|--------|
| Epic 3A | in-progress (sprint-status stale) | **Mark done** — all 8 stories complete, all PRs merged |
| **Epic 3B (NEW)** | — | **Add:** Delivery & Fleet Intelligence |
| Epic 4 | backlog | **Deferred** — stays in backlog, deprioritized |
| Epic 5 | backlog | **Deferred** — stays in backlog, deprioritized |

### Story Impact

**No existing stories modified.** Epic 3B is purely additive.

The existing `delivery_attempts` table and edge function remain functional during the transition. Story 3b-1 will define how `delivery_attempts` is reconciled with the new `dispatches` table (likely deprecated or converted to a view).

### Artifact Conflicts

- **PRD:** No conflict. FR43 (integrate with last-mile routing tools), FR44 (receive delivery status via webhooks), FR5 (OTIF tracking) are all directly fulfilled by this epic. The provider-agnostic design also prepares for FR43's SimpliRoute and Driv.in requirements.
- **Architecture:** New tables (`routes`, `dispatches`, `fleet_vehicles`) added to Supabase PostgreSQL. Edge function enhanced. No architectural pattern changes — same stack, same patterns (RLS, soft deletes, operator_id on all tables).
- **UI/UX:** Story 3b-4 adds an OTIF dashboard widget. Story 3b-6 (optional) adds fleet metrics. Both extend the existing dashboard — no new pages or navigation changes required.
- **Data Model:** Three new tables + provider enum type. `delivery_attempts` reconciliation needed (deprecate or view). No breaking changes to existing tables.

### Technical Impact

- **Edge function:** `beetrack-webhook/index.ts` — major rewrite to populate new tables instead of just `delivery_attempts`
- **Database:** New migration with 3 tables + enum + indexes + RLS policies
- **Dashboard:** New RPC for OTIF calculation, new widget component
- **No infrastructure changes** — same Supabase, same deploy pipeline

---

## Section 3: Recommended Approach

**Option 1 — Direct Adjustment** ✅ Selected

Add Epic 3B to the roadmap. No rollback needed, no scope reduction. Epics 4 and 5 remain in backlog for future implementation.

**Rationale:**
- Zero risk to existing functionality — additive only
- Directly fulfills PRD requirements (FR5, FR43, FR44)
- Customer's #1 priority — immediate value delivery
- Provider-agnostic design future-proofs for SimpliRoute/Driv.in
- Fleet data capture starts early — enables cost optimization analysis even before a fleet dashboard is built
- Low-medium effort: 6 stories, well-scoped

---

## Section 4: Detailed Change Proposals

### Change 1: New Epic 3B — Delivery & Fleet Intelligence

**Stories:**

#### 3b-1: Schema Design — Routes, Dispatches, Fleet Vehicles
Design and create provider-agnostic tables based on real DispatchTrack payload analysis. Create Supabase migration. Reconcile with existing `delivery_attempts`.

**Blocked until:** PR #68 payload logging is deployed and we have real samples from all DispatchTrack resource types.

**Tables (draft — finalized after payload analysis):**

`routes`:
- `id`, `operator_id`, `provider` (enum: dispatchtrack, simpliroute, drivin), `external_route_id`
- `route_date`, `driver_name`, `vehicle_id` (FK to fleet_vehicles)
- `status`, `planned_stops`, `completed_stops`
- `start_time`, `end_time`, `total_km`, `idle_time`
- `raw_data` (JSONB), `created_at`, `updated_at`, `deleted_at`

`dispatches`:
- `id`, `operator_id`, `route_id` (FK), `order_id` (FK to orders), `provider`
- `external_dispatch_id`, `status` (enum), `substatus`
- `planned_sequence`, `arrived_at`, `completed_at`
- `failure_reason`, `driver_notes`
- `raw_data` (JSONB), `created_at`, `updated_at`, `deleted_at`

`fleet_vehicles`:
- `id`, `operator_id`, `provider`, `external_vehicle_id`
- `plate_number`, `vehicle_type`, `driver_name`
- `raw_data` (JSONB), `created_at`, `updated_at`, `deleted_at`

#### 3b-2: Ingest All DispatchTrack Events
Update the Supabase Edge Function to populate `routes`, `dispatches`, and `fleet_vehicles` from ALL webhook resource types (dispatch, route, review, dispatch_guide). Stop discarding non-terminal events.

#### 3b-3: Simple Order Status Update
Update `orders.status` from terminal dispatch events: `created → delivered` or `created → failed_delivery`. No intermediate states — just terminal outcomes.

#### 3b-4: OTIF Metrics, Pending Orders & Dashboard Widget
Calculate OTIF (delivered on or before `delivery_date` / total committed) from `dispatches` table. Include pending orders metrics: orders still in `created` state past their `delivery_date` (overdue) and orders due today/tomorrow (urgent). This gives operations a clear view of what needs immediate attention. Expose via Supabase RPC. Add widgets to existing dashboard.

#### 3b-5: Intermediate Order States
Implement non-terminal order status transitions (created → in_route → out_for_delivery → delivered/failed). Uses non-terminal dispatch events ingested in 3b-2.

#### 3b-6 (optional): Fleet Dashboard
Fleet utilization view: km driven per vehicle, idle time, routes per day, cost-per-delivery estimates. Foundation for distance optimization and fleet sizing decisions.

### Change 2: Update sprint-status.yaml

- Mark Epic 3A as `done` (all stories done)
- Update all 3A story statuses to `done`
- Add Epic 3B with all stories in `backlog`

### Change 3: Update Memory — Future Epics

Replace the "Epic 6: DispatchTrack Route Intelligence" memory note — that vision is now captured as Epic 3B.

---

## Section 5: Implementation Handoff

**Scope classification: Minor** — Direct implementation by development team.

| Responsibility | Owner |
|---|---|
| Analyze DispatchTrack payloads from logs | Dev agent (after PR #68 deploys) |
| Design and implement schema (3b-1) | Dev agent |
| Update edge function (3b-2) | Dev agent |
| Order status updates (3b-3) | Dev agent |
| OTIF metrics + widget (3b-4) | Dev agent |
| Intermediate states (3b-5) | Dev agent |
| Fleet dashboard (3b-6) | Dev agent (optional, based on priority) |
| Create story files via SM workflow | SM (Bob) |
| Deploy edge function to Supabase | Automated (CI/CD pipeline on merge to main) |

**Success criteria:**
1. All DispatchTrack webhook events stored in `routes`, `dispatches`, `fleet_vehicles` tables
2. Orders automatically transition from `created` to `delivered`/`failed_delivery`
3. OTIF metric visible on dashboard per customer
4. Zero data loss — every webhook event persisted
5. Provider-agnostic — schema supports future SimpliRoute/Driv.in integration

**Dependencies:**
- PR #68 must be deployed and payload samples collected before 3b-1 can be finalized

---

*Prepared by Bob — Scrum Master | Aureon Last Mile | 2026-03-06*
