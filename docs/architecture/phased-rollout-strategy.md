# Phased Rollout Strategy — Aureon Last Mile

## Context

A previous attempt to roll out the full Aureon platform to the tenant failed because it demanded simultaneous change of processes, layouts, and people's roles. The tenant operates on paper + Excel and has no prior digital logistics experience, so a big-bang cutover overwhelmed their organization.

**This is not a rebuild.** Every module already built stays. The goal is to make every module **independently activatable per tenant** so we can turn them on one at a time, in any order, on the schedule that matches the tenant's capacity to absorb change.

We need:

1. A **per-tenant module activation system** (feature flags scoped to `operator_id`) that hides/shows modules in navigation, blocks route access when disabled, and lets data paths degrade gracefully when an upstream module is off
2. A **rollout order** that delivers concrete business value at each step while requiring the minimum process and role change
3. DispatchTrack / Beetrack to keep running in parallel through every phase — Aureon layers on top, never forces a cutover

---

## Strategy: Module Activation, Not Module Construction

Everything already built (Reception, Pickup, Distribution, Pre-Route, Dispatch, Ops Control, Returns, Admin, Conversations) is kept. We add a thin activation layer that decides — per tenant — which modules are visible and operational. Rollout becomes a configuration change, not a development cycle.

### The Activation Layer (Prerequisite — Build Once, Use Forever)

This is the foundational work that enables phased rollout. Without it, every phase requires a code change. With it, every phase is a config toggle.

**What we build:**

- A `operator_enabled_modules` table (or equivalent on the `operators` / tenants table) keyed by `operator_id` with one boolean column per module: `pickup_enabled`, `reception_enabled`, `distribution_enabled`, `pre_route_enabled`, `dispatch_enabled`, `ops_control_enabled`, `returns_enabled`, `late_order_alerts_enabled`, etc.
- A **single source of truth** server helper (e.g. `apps/frontend/src/lib/modules/enabled.ts`) that returns the active set for the current operator. Used by:
  - Navigation/sidebar rendering — hide menu items for disabled modules
  - Server-side route guards in `apps/frontend/src/app/app/<module>/layout.tsx` — return 404 / redirect if module is disabled
  - API route handlers — refuse mutations against disabled modules
  - Ops Control snapshot RPC — degrade pipeline columns to "not tracked" when an upstream module is disabled (so the dashboard doesn't show empty/false zeros)
- An **Admin UI** at `apps/frontend/src/app/app/admin/modules` (super-admin only) to flip per-tenant toggles. Each flip is audit-logged.
- A **migration** to seed defaults. For the current tenant, only the Phase 1 set is enabled at first switch-on.

**Why this is the right shape:**

- One-time investment, permanent benefit — every future tenant rollout uses the same toggles
- Code stays single-trunk; no per-tenant branches or environments
- Reversible — if a phase goes badly, we flip the toggle off and revert without code changes

**Estimated scope:** small. The hard work (the modules themselves) is done. This is plumbing.

---

### Phase 0 — Build the Activation Layer

**Deliverables:**

- DB migration adding `operator_enabled_modules` (or columns on `operators`)
- `lib/modules/enabled.ts` helper + server-side hook
- Navigation gated by enabled set
- Per-module layout-level guard
- API route guard middleware
- Admin UI to flip toggles
- All existing modules audit-tested with all toggles `false` and only their own toggle `true`

**Exit criterion:** with all module toggles off for the test tenant, the app shows nothing but Admin + a "no modules enabled" landing. Flipping each toggle individually exposes only that module and nothing else.

---

### Ops Control Architecture: Named Presets Auto-Selected by Enabled Modules

Ops Control is **not** one component with conditional sections. It is a shell that picks one of several deliberately-designed **presets** based on the operator's `enabled_modules` set. The preset is chosen server-side; the ops manager never picks it. As more modules activate, the preset upgrades — a visible, intentional change paired with each phase's training session.

Defined presets:

- **Visibility preset** — selected when only `ops_control_enabled` + `late_order_alerts_enabled` are on. The Phase 1 screen (detailed below).
- **Warehouse preset** — selected when Pickup / Reception / Distribution are also on. Adds intake + sorting pipeline view to the Visibility preset.
- **Full Operations preset** — selected when Dispatch + Returns are also on. Full 8-stage pipeline, alerts, and (eventually) write actions.

Preset selection logic lives in `apps/frontend/src/lib/ops-control/select-preset.ts` (new). Each preset is its own page/component under `apps/frontend/src/app/app/operations-control/presets/<name>/`. The existing dashboard becomes the Full Operations preset.

---

### Phase 1 — Enable: Order Lifecycle Visibility + Late-Order Alerting (Visibility Preset)

**Enabled modules for tenant:** `ops_control_enabled = true`, `late_order_alerts_enabled = true`. Everything else off → preset selector returns **Visibility preset**.

**Tenant value:** Direct prevention of indemnization payments to load generators. Today the tenant cannot answer "which orders are currently in our hands?" or "which ones are at risk of breaching the commercial-agreement deadline?" — late returns trigger penalties they can't preempt.

**What changes for the tenant:** Nothing in warehouse, dispatch, or driver workflows. Pickup continues on paper; dispatching continues through DispatchTrack as today. **Only the ops manager gets a new tool.**

**Visibility preset layout (top to bottom):**

1. **KPI row** — three large tiles:
   - Total orders **in hand of the transport**
   - **Late** orders (past commercial-agreement deadline)
   - **At-risk** orders (approaching deadline within configurable window)
2. **Breakdown tables row** — three side-by-side tables, each summarising in-hand orders by:
   - Transport Tenant (load generator)
   - Region
   - Comuna
   Clicking a row in any breakdown applies it as a **filter chip** to the order table below.
3. **Order detail table** — every in-hand order, filterable by the breakdown chips plus columns for: order ID, transport tenant, region, comuna, commercial deadline, SLA countdown, late/at-risk/on-time status. Sortable; rows drill into order detail.

**How this works with everything else off:**

- Order lifecycle is reconstructed from **ingest events** (Paris / Easy → DB) and **DispatchTrack webhook events** (delivered / failed / partial). No Pickup, Reception, Distribution, or Dispatch input is required to compute "in hand."
- The Visibility preset queries its own RPC (e.g., `get_ops_control_visibility_snapshot`) that returns only the KPIs, breakdowns, and order rows it needs — it does not call the existing full-pipeline snapshot RPC.
- Late-order alerts compare each in-hand order against its commercial-agreement deadline and fire via the existing agent suite (`apps/agents`).

**Critical files:**

- `apps/frontend/src/app/app/operations-control/presets/visibility/` — new page + components (KPI row, breakdown tables, filterable order table)
- `apps/frontend/src/lib/ops-control/select-preset.ts` — new preset selector
- `apps/frontend/src/app/app/operations-control/page.tsx` — refactor to delegate to selected preset
- `apps/frontend/src/lib/types.ts` — add Visibility-preset types alongside existing Ops Control types
- `packages/database/supabase/migrations/**` — new `get_ops_control_visibility_snapshot` RPC; source commercial deadline from `clients` / agreement tables
- `apps/agents/**` — late-order alert agent
- `packages/database/supabase/functions/beetrack-webhook/index.ts` — confirm it correctly transitions orders to "completed" so they drop off "in hand"

**Exit criterion (per user direction):** soft. Give the tenant time to get accustomed to the dashboard and alerts. Move to Phase 2 when the ops manager is using Ops Control daily and acknowledging alerts. Log dashboard sessions + alert acknowledgements as a qualitative signal.

**Risks & mitigations:**

| Risk | Mitigation |
|------|------------|
| Alerts fire incorrectly → ops manager loses trust | Run alerts to our team only for 1 week, tune thresholds against historical data, then enable for tenant |
| Ops Control RPC lacks commercial-deadline data | Extend RPC and source SLA from `clients` / agreement tables before enabling the toggle |
| DispatchTrack misses webhook events → "in hand" set is wrong | Add a nightly reconciliation job comparing DispatchTrack API state against our DB |

---

### Phase 2 — Enable: Pickup (All Tenant Warehouses)

**Toggle change:** `pickup_enabled = true`. Phase 1 toggles stay on.

**Tenant value:** Faster, more accurate load review when packages arrive at the tenant warehouse from the load generator. Replaces manual paper-counting with OCR-driven verification.

**Scope decision (per user):** all tenant warehouses simultaneously, not piloted on one site.

**Honest risk flag:** big-bang at the warehouse-staff level resembles part of the previous failure shape. The user has accepted this risk; the plan mitigates rather than challenges it.

**Mitigations:**

| Risk | Mitigation |
|------|------------|
| Big-bang to all warehouses repeats prior failure | (a) Mandatory on-site training per warehouse before flip; (b) keep paper process in parallel for 2 weeks (dual-key); (c) named tenant-side champion per site |
| OCR misreads cause more friction than paper | Manual override always available; track override rate as a quality signal |
| Warehouse staff revert to paper after launch | Pickup-completion rate visible in Ops Control (already live from Phase 1); ops manager becomes the enforcement vector |
| Pickup data flows into Ops Control but downstream modules are still off | Ops Control snapshot RPC must include a "picked up but not yet received" lifecycle stage that doesn't depend on Reception being enabled |

**Exit criterion:** ≥80 % of incoming loads processed through Pickup module within 2–3 weeks of toggle flip, sustained 1 week. If lower, **flip the toggle back off**, fix adoption blockers, retry. This is the rollback the activation layer makes cheap.

---

### Phases 3+ — Future Toggle Flips, Order TBD

Likely sequence, decided after Phase 2 results:

1. `reception_enabled` — hub intake (next downstream from Pickup)
2. `distribution_enabled` — dock assignment
3. `pre_route_enabled` + `dispatch_enabled` — route building (cutover from DispatchTrack to Aureon Dispatch becomes possible here)
4. `returns_enabled` — specs 43 / 44a / 44b
5. Ops Control writes — promote dashboard from read-only to actionable controls

Each phase re-uses the same playbook: confirm Ops Control + already-enabled modules degrade correctly with the new module **off**, flip toggle on with training + parallel paper period, watch adoption metric, roll back via toggle if needed.

---

## Cross-Cutting Principles

- **DispatchTrack stays live** through all phases until / unless we explicitly retire it. Aureon never replaces it without an overlap window.
- **Every phase = a toggle flip + training, not a code release** (after Phase 0 is built).
- **One process change per phase**, never two.
- **Per-phase on-site training** before flip, with a named tenant-side owner.
- **Rollback = flip the toggle off.** No code revert, no data migration, no downtime.

---

## Critical Files / Existing Assets to Reuse

- `apps/frontend/src/app/app/**` — all existing module routes stay; we wrap layouts with the guard
- `apps/frontend/src/lib/types.ts` — Ops Control types (memory: `project_ops_control_rpc.md`)
- `packages/database/supabase/functions/beetrack-webhook/index.ts` — already stores raw DT events
- `apps/agents/**` — existing agent infrastructure for WhatsApp / email alerts (memory: `project_agent_suite.md`)
- `packages/database/supabase/migrations/**` — add module-activation migration; extend Ops Control snapshot RPC
- `apps/frontend/src/app/app/admin/**` — extend existing admin module (memory inventory: spec-33 complete) with the toggle UI

---

## Verification

**Phase 0 (activation layer):**

1. Seed a test operator with all module toggles off; log in → only Admin visible, no module routes accessible (direct URL returns 404)
2. Flip `ops_control_enabled` on → Ops Control appears in nav, route accessible, no other module changes
3. Flip on each module individually in isolation; confirm no leakage between modules
4. Confirm API routes refuse mutations against disabled modules

**Phase 1:**

1. With only `ops_control_enabled` + `late_order_alerts_enabled` on, log in as ops manager → preset selector resolves to **Visibility preset**; KPI row, 3 breakdowns, and order table render. No pipeline columns visible anywhere.
2. Click a row in the per-Region breakdown → filter chip applied to the order table; only matching rows remain. Add a per-Transport-Tenant chip → both filters compose.
3. Ingest a test order; confirm it appears in the Visibility preset "in hand" KPI and order table within 1 minute.
4. Fast-forward an order past its SLA deadline; confirm it shifts into the Late KPI and a late-order alert fires through the agent pipeline.
5. Simulate a DispatchTrack `delivered` webhook; confirm the order drops off "in hand."
6. Run the Visibility preset against a 30-day historical window; cross-check late-order count against the tenant's indemnization invoices from the same period.
7. Flip `pickup_enabled` on for a separate test operator → preset selector returns **Warehouse preset** instead. Confirm Visibility tenant is unaffected.

**Phase 2:**

1. Scan a real manifest at a tenant warehouse using Pickup; confirm OCR extracts data and verification completes
2. Confirm Pickup completions appear in Phase 1's Ops Control as a new lifecycle stage
3. Track Pickup-completion rate vs. total inbound loads across all warehouses for first 14 days

---

## Spec Map (Authoritative)

Canonical breakdown of this strategy into specs. Each spec gets its own brainstorming → writing-plans → worktree → TDD → review → merge cycle. Plan lives inside the same spec file per `docs/specs/CLAUDE.md`. **Keep this table up to date as specs progress.**

| Spec | Scope | Status | Depends on |
|---|---|---|---|
| **spec-45** | Activation primitive: `operator_enabled_modules` + `operator_module_audit` tables, `SECURITY DEFINER` RPCs, `super_admin` role, internal `aureon-internal` operator, helper API (`getEnabledModulesForCurrentUser`, `isModuleEnabled`, `requireModuleEnabled`, `withModule`), Admin UI tab (operator picker, module grid, toggle dialog with mandatory reason, audit drawer), seed existing tenant with `ops_control` + `late_order_alerts` only | backlog | — |
| **spec-46** | Wire activation guards into every existing module layout (`pickup/layout.tsx`, `reception/layout.tsx`, `distribution/layout.tsx`, `dispatch/layout.tsx`, `conversations/layout.tsx`, `operations-control/layout.tsx`) + filter the sidebar nav by the enabled set. `returns` route does not yet exist — its guard ships with spec-44b. `pre_route` and `late_order_alerts` have no module routes so no guard is needed. | in progress | spec-45 |
| **spec-47** | Ops Control preset architecture: preset selector at `lib/ops-control/select-preset.ts`, refactor existing dashboard into the "Full Operations preset" shell; introduces `presets/` directory structure | backlog | spec-45, spec-46 |
| **spec-48** | Visibility preset: KPI row (in-hand, late, at-risk), 3 breakdown tables (Transport Tenant, Region, Comuna) acting as filter chips, filterable order detail table, `get_ops_control_visibility_snapshot` RPC | backlog | spec-47 |
| **spec-49** | Late-order alerts agent: SLA-deadline sourcing from `clients` / commercial-agreement tables, agent that fires WhatsApp/email when at-risk or breached | backlog | spec-45 |
| **spec-50** | DispatchTrack reconciliation job: nightly cross-check against DT API to ensure "in-hand" set stays correct; alerts ops team on drift | backlog | — |

**Not a code spec:** Phase 2 (Pickup activation across all warehouses). Once specs 45–46 are merged, Phase 2 is a config flip (super-admin enables `pickup` for the tenant) + a training runbook doc + dual-key paper period. No code change required.

### Sequencing

1. spec-45 ships first, alone.
2. After spec-45 merges, three tracks can run in parallel worktrees: spec-46 (guard wiring), spec-49 (alerts), spec-50 (reconciliation).
3. spec-47 waits on spec-46.
4. spec-48 waits on spec-47.
5. Phase 1 is "live" for the tenant once specs 45 + 46 + 47 + 48 + 49 are merged.
6. Phase 2 starts when the tenant is ready (per Phase 1 exit criterion above).

---

## Honest Bottom Line

The right move is **not** to rebuild or trim — it's to add a thin per-tenant activation layer so the modules we already have can be turned on one at a time, plus an Ops Control preset selector so the dashboard the ops manager sees is purpose-designed for the currently-enabled module set rather than a stripped-down version of the full pipeline. Phase 0 (the activation layer + preset selector) is small, one-time work that turns every subsequent rollout phase into a config flip + training session instead of a release. Phase 1 (Visibility preset + late-order alerts) delivers a financially measurable result with zero behavior change in the warehouse or dispatch. Phase 2 (Pickup at all warehouses) is the first real process change and carries the biggest residual risk; the activation layer makes "flip the toggle back off" a real rollback option if adoption stalls.
