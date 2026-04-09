# Spec 29 — Ops Control "Mission Deck" Redesign

**Status:** in progress

## Context & Problem

The current `/app/operations-control` page (`apps/frontend/src/app/app/operations-control/page.tsx`, ~75 LOC) is a thin placeholder. Operations needs a real, always-on control surface that one person can monitor for the entire shift to keep the full last-mile pipeline flowing — including new stages for **returns to retail** and **future reverse logistics** that don't exist yet in any other module.

This spec defines the **redesign** of that page only. It is **read-only**: monitoring + deep-links to existing modules. It does not modify the underlying domain modules.

## Users & Context

- **Primary user:** ops controller, watching the dashboard for most of their shift on a desktop monitor.
- **Responsibilities they need supported simultaneously:**
  1. Pending pickups at retailers
  2. Reception clean / flowing
  3. Consolidation zone (orders ready for docks)
  4. Docks — routes pending activation
  5. Out for delivery
  6. Returns to retail (failed deliveries per commercial agreements) — **new**
  7. Reverse logistics (customer-cancelled, home pickup) — **future placeholder**
- A **cross-cutting at-risk / late** view that surfaces problems regardless of stage.

## Goals

- One screen the controller can keep open all day.
- Whole pipeline visible at a glance + drill-in for any stage.
- At-risk / late orders never hidden — always pinned.
- Real-time updates (no manual refresh, no polling).
- All copy in **Spanish**.

## Non-Goals

- No write actions in this spec (read-only). Quick actions deferred to a future spec.
- No changes to underlying modules (Pickup, Reception, Dispatch, etc.).
- Reverse logistics is a placeholder card only (no data wiring).
- No mobile/tablet layout in this spec — desktop-first.

---

## Design

### Layout — Hybrid (Strip + Drill-down)

```
┌─────────────────────────────────────────────────────────────────┐
│ Aureon · Control de Operaciones        [LIVE clock]             │
├─────────────────────────────────────────────────────────────────┤
│ [12]  EN RIESGO Y ATRASADAS    inline strip of urgent orders →  │  ← AT-RISK BAR (always visible)
├─────┬─────┬─────┬─────┬─────┬─────┬─────────────────────────────┤
│ 01  │ 02  │ 03  │ 04  │ 05  │ 06  │ 07                          │
│Reco-│Rec- │Cons-│Doc- │Rep- │Dev- │Logística                    │  ← TELEMETRY STRIP (7 stages)
│gida │epci │olid │ks   │arto │oluc │Inversa                      │
│ 23  │ 141 │  87 │  5  │ 312 │  8  │   0                         │
└─────┴─────┴─────┴─────┴─────┴─────┴─────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│ Drill-down panel for the SELECTED stage                         │
│  ┌──────────────────────────────────────┐  [Abrir en X →]      │
│  │ Header · KPIs · Table                │                      │
│  └──────────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

Reference mockup: `.superpowers/brainstorm/957-1775512518/content/mission-control-v1.html`.

### Visual Language — "Mission Deck"

- **Aesthetic:** dark mission-control / Bloomberg-terminal hybrid. The controller stares at this for hours; signal colors reserved for problems.
- **Type:**
  - Display / stage names → **Fraunces** (serif, distinctive, editorial gravitas)
  - Numbers, IDs, timers → **Geist Mono** (tabular figures, font-variant-numeric: tabular-nums)
  - UI labels / body → **Geist Sans**
  - Forbidden: Inter, Roboto, Space Grotesk, generic system fonts
- **Color tokens:**
  - bg `#07090d` · panel `#0e1218` · panel-2 `#11161e`
  - hairlines `#1a2130` / `#222b3d`
  - text `#e6ebf2` · dim `#7a8597` · dimmer `#4b5568`
  - cobalt `#3b82f6` (primary action / selected stage)
  - signal: amber `#f5a524` (warn) · crimson `#ef4444` (critical/late) · mint `#10b981` (healthy/live)
- **Texture:** subtle 32px grid overlay at ~3.5% opacity + faint cobalt/crimson radial glows. No purple gradients.
- **Density:** dense, hairline borders, generous internal padding within cells. Tabular figures everywhere numbers appear.

### Components

#### 1. Top bar
- Brand: "Aureon · Control de Operaciones · Mission Deck"
- Live clock: warehouse code, date, HH:MM:SS, pulsing **EN VIVO** indicator (mint).

#### 2. At-risk command bar (always visible)
- Pinned below top bar, crimson hairline.
- Big tabular count of orders that are late OR at-risk.
- Inline horizontal strip of the **3 most urgent** orders, with **+ N MÁS →** affordance to expand to a full list view.
- Per row (when expanded): **Order ID, Customer, Address/Comuna, Stage, Retailer, Time remaining, Reason flag**.
- "Time remaining" shows `ATRASADO 1h 12m` (crimson) or `2h 04m restantes` (amber).

##### Default view on page load
The dashboard's **default selected view is the at-risk / late list**, not a stage. On first load (and when no `?stage=` query param is set):
- The telemetry strip is rendered with no active stage highlighted.
- The drill-down panel below renders the **full at-risk list** (same SLA rules and columns as the at-risk bar) instead of a stage table.
- Clicking any stage cell in the strip switches the panel to that stage and updates the URL query.
- Clicking the at-risk bar (or its `+ N MÁS →`) returns to the at-risk view and clears `?stage=`.

##### Pagination
All drill-down tables (including the at-risk list) are limited to **25 rows per page** with pager controls in the panel footer (`◀ Anterior · Página N de M · Siguiente ▶`). Pagination is client-side over the in-memory snapshot since totals per stage are bounded; if a stage exceeds a few hundred rows in the future, switch that panel to server-side pagination without changing the layout.

##### At-risk SLA rules
- **Effective deadline = `rescheduled_delivery_window_end` if present, else `delivery_window_end`.** Same rule applies to the start of the window.
- **Late** = `now > effective_window_end` AND order not delivered.
- **At risk** = `effective_window_end - now <= 6h` AND order not delivered AND not currently late.
- Threshold (6h) is a constant in this spec; if changed it should become a setting in a future spec.
- "Reason flag" — best-effort label inferred from current state: `Sin conductor`, `Atascado en recepción`, `Ruta inactiva`, `Sin asignar`, `Devolución pendiente`. If none applies → blank.

#### 3. Telemetry strip (7 stages)
Always visible. Each stage cell shows:
- Numeric index (01–07) + "STAGE" microlabel
- Stage name (Spanish, Fraunces)
- **Big tabular count** (Geist Mono, 36px)
- Single-line delta / micro-status (e.g., `▲ 4 última hora`, `2 atascados > 4h`, `2 rutas inactivas`)
- Health side-bar (2px left border): mint (healthy) / amber (warn) / crimson (critical)
- Hover → background lift. Click → becomes the active stage (cobalt top border + tinted background) and the drill-down panel below updates.
- Selected stage persists in URL query (`?stage=docks`) so the page is shareable and survives reloads.

##### Spanish stage labels
| # | Key | Label |
|---|---|---|
| 01 | `pickup` | Recogida |
| 02 | `reception` | Recepción |
| 03 | `consolidation` | Consolidación |
| 04 | `docks` | Andenes |
| 05 | `delivery` | Reparto |
| 06 | `returns` | Devoluciones |
| 07 | `reverse` | Logística Inversa |

##### Health rules per stage (initial heuristics)
- **Pickup** — crit if any pickup overdue > 2h; warn if > 30 min.
- **Reception** — crit if any item dwelling > 6h; warn if > 4h.
- **Consolidation** — crit if any order has missed its dock window; warn if oldest > 2h.
- **Docks** — crit if any route idle (no driver / not activated) > 1h; warn > 30 min.
- **Delivery** — crit if any route has no GPS ping > 30 min; warn if any route is behind plan by > 1h.
- **Returns** — crit if any return-to-retail older than its retailer's SLA; warn at 80% of SLA.
- **Reverse** — always neutral (placeholder).

These are starting heuristics, not load-bearing — they can be refined without changing the layout.

#### 4. Drill-down panel (uniform template)
Per selected stage:
- **Header**: stage name (Fraunces 32px) + sub line `Etapa NN · {primary count} · {secondary breakdown}` + `Abrir en {Module} →` button (cobalt outline).
- **KPI strip**: 4 KPIs in a single row, each `LABEL / VALUE / TREND`. KPIs differ per stage (see below).
- **Table**: stage-specific columns. Hover row highlight. Critical/warn rows tinted with a faint crimson/amber wash. Empty state: `Sin elementos en esta etapa`.
- **Footer**: `Última sincronización · HH:MM:SS` + `Tiempo real · Supabase Realtime`.

##### Per-stage tweaks (uniform template, stage-specific columns)
| Stage | Group / sort | KPIs (4) | Table columns |
|---|---|---|---|
| Recogida | by retailer | Pendientes · Vencidas · Próx. ventana · Avg espera | Retailer · # órdenes · Ventana · Espera · Estado |
| Recepción | oldest first / by inbound batch | Total · Sin clasificar · Antigüedad máx · Throughput/h | Lote · Recibido · # ítems · Antigüedad · Estado |
| Consolidación | by destination dock | Listas · Andenes destino · Antigüedad máx · Próx. corte | Andén destino · # órdenes · Listas desde · Estado |
| Andenes | by route | Rutas listas · Avg dwell · Más antigua inactiva · Órdenes en andén | Ruta · Andén · Conductor · Órdenes · Dwell · Estado · Ventana |
| Reparto | by route | Rutas activas · En tiempo · Atrasadas · Entregadas hoy | Ruta · Conductor · Progreso · Entregadas / total · Próx. parada · Estado |
| Devoluciones | by retailer + reason | Pendientes · Por retailer · Antigüedad máx · Próx. corte SLA | Retailer · Pedido · Razón · Antigüedad · SLA · Estado |
| Logística Inversa | — | placeholder | — `Próximamente` empty state |

Each table is **read-only**. The only action affordance is `Abrir en {Module} →` in the header.

##### Deep-link targets
| Stage | Target route |
|---|---|
| Recogida | `/app/pickup` |
| Recepción | `/app/reception` |
| Consolidación | `/app/distribution` |
| Andenes | `/app/dispatch` |
| Reparto | `/app/dispatch?view=routes` |
| Devoluciones | _standby_ — no dedicated module exists yet. Render the deep-link button as **disabled** with tooltip `Próximamente`. Wire later when a returns module ships. |
| Logística Inversa | n/a (placeholder) |

### Data flow

- **Server component** for the page shell (top bar, layout). Fast TTFB.
- **Initial snapshot** fetched on the server for: at-risk list, per-stage counts/health, drill-down for the default selected stage.
- **Client island per panel** subscribes to Supabase Realtime channels:
  - `orders` (any UPDATE/INSERT/DELETE on `operator_id = $current`)
  - `routes`
  - `pickups`
  - `returns`
- Each Realtime event re-derives the affected counters / table rows in memory; full re-fetch only on reconnect.
- **No polling.** The footer's "Última sincronización" timestamp updates from Realtime ack, not a timer.

#### Data hooks (new)
Created under `apps/frontend/src/hooks/ops-control/`:
- `useOpsControlSnapshot()` — initial fetch + Realtime subscription, returns the full dashboard state.
- `useStageBreakdown(stageKey)` — derives the rows for the selected stage.
- `useAtRiskOrders()` — derives the cross-cutting at-risk list with the SLA rules above.

All hooks scope every query by `operator_id` (per `CLAUDE.md` non-negotiable).

### File structure (new)

```
apps/frontend/src/app/app/operations-control/
  page.tsx                       # server shell; replaces existing 75-line placeholder
  page.test.tsx                  # update existing tests
  components/
    TopBar.tsx
    AtRiskBar.tsx
    AtRiskList.tsx               # expanded list view
    TelemetryStrip.tsx
    StageCell.tsx
    DrillDownPanel.tsx           # uniform template
    stage-panels/
      PickupPanel.tsx
      ReceptionPanel.tsx
      ConsolidationPanel.tsx
      DocksPanel.tsx
      DeliveryPanel.tsx
      ReturnsPanel.tsx
      ReversePlaceholderPanel.tsx
  lib/
    sla.ts                       # effective-window + at-risk classifier (pure, unit-tested)
    health.ts                    # per-stage health heuristics (pure, unit-tested)
    labels.es.ts                 # Spanish labels for stages, statuses, reasons

apps/frontend/src/hooks/ops-control/
  useOpsControlSnapshot.ts
  useStageBreakdown.ts
  useAtRiskOrders.ts
```

Each file stays well under 300 LOC (per CLAUDE.md).

### Internationalization

All copy is hard-coded Spanish in `lib/labels.es.ts`. The dashboard does not use any i18n framework (none exists in the project today). Future i18n is out of scope.

### Accessibility

- Color is **never** the only signal: every health state also has a textual delta line and an icon (dot + status word).
- Interactive cells (`StageCell`, table rows) are real `<button>` elements with focus rings.
- Tabular figures and consistent column widths so numbers don't jitter on Realtime updates.

### Testing strategy (TDD per CLAUDE.md)

Pure unit tests first (no DOM, no Supabase):
- `lib/sla.test.ts` — effective deadline picks rescheduled when present; late/at-risk classification; 6h boundary.
- `lib/health.test.ts` — each stage's heuristics, including empty inputs.

Hook tests with mocked Supabase client:
- `useAtRiskOrders` returns correct ordering (most-urgent first), respects `operator_id`, ignores delivered orders.
- `useStageBreakdown` re-derives on Realtime UPDATE.

Component tests:
- `AtRiskBar` renders count + first 3 + "+ N más" affordance.
- `TelemetryStrip` renders 7 cells, click updates URL query, active state highlights.
- `DrillDownPanel` swaps stage panel based on URL query.
- `page.test.tsx` updated to assert new shell + Spanish labels.

### Out of scope (deferred)

- Write actions (reassign route, mark exception, contact customer).
- Configurable at-risk threshold.
- Mobile / tablet layout.
- Real reverse-logistics data.
- Multi-warehouse switcher (single warehouse assumed for now).
- Sound alerts on new critical events.

---

## Resolved decisions (post-review)

- **Returns deep-link** — no dedicated returns module exists today. The button is rendered **disabled** with a `Próximamente` tooltip; wire it up in a later spec.
- **Returns SLA storage** — confirmed via migration scan: there is **no retailers table with SLA fields** in the current schema. Retailers are referenced ad-hoc by `retailer_id` / `retailer_name` in other tables. We will introduce a small config table to make per-retailer return SLAs explicit.

### New table — `retailer_return_sla_config`

Owned by this spec (read-only from the dashboard, write surface deferred). Migration lives under `packages/database/supabase/migrations/`.

```sql
CREATE TABLE retailer_return_sla_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES operators(id),
  retailer_id     text NOT NULL,                 -- matches the retailer reference used elsewhere
  retailer_name   text NOT NULL,                 -- denormalized for display
  sla_hours       integer NOT NULL CHECK (sla_hours > 0),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,                   -- soft delete only (per CLAUDE.md)
  UNIQUE (operator_id, retailer_id)
);

-- RLS: scope by operator_id (per CLAUDE.md non-negotiable)
ALTER TABLE retailer_return_sla_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY retailer_return_sla_config_isolation ON retailer_return_sla_config
  USING (operator_id = current_setting('app.current_operator_id')::uuid);
```

- The Returns stage's `health.ts` heuristic reads from this table (joined into the orders snapshot). If a retailer has no row, the stage falls back to a global default (`24h`) and surfaces the missing config in the row's reason flag (`SLA no configurado`).
- Admin UI to manage this table is **out of scope** for this spec — it can be edited via Supabase Studio for now and gets a proper admin screen in a follow-up spec.

## Open Questions

_None — all open items above have been resolved._

---

# Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` (if subagents available) or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `/app/operations-control` page with a real-time, read-only Mission Deck that surfaces the full last-mile pipeline + cross-cutting at-risk orders.

**Architecture:** Server component shell + client islands subscribed to Supabase Realtime. Pure libs (`sla`, `health`, `labels.es`) drive classification and copy. Uniform `DrillDownPanel` template hosts 7 stage-specific panels. State (`?stage=`) lives in the URL.

**Tech Stack:** Next.js App Router · React Server Components · TanStack Query · Supabase (Postgres + Realtime + RLS) · TypeScript · Vitest + React Testing Library.

**TDD reminder (per `CLAUDE.md`):** every step writes the failing test first, watches it fail, implements the minimum, watches it pass, commits.

**Branch:** `feat/spec-29-ops-control-mission-deck` (create via `superpowers:using-git-worktrees`).

---

## Phase 0 — Foundations

### Task 0.1: Branch + worktree

- [ ] **Step 1:** Create worktree branched off `main`.
  ```bash
  git fetch origin main
  git worktree add ../Aureon_Last_Mile-spec29 -b feat/spec-29-ops-control-mission-deck origin/main
  cd ../Aureon_Last_Mile-spec29
  ```
- [ ] **Step 2:** Update `docs/specs/spec-29-ops-control-mission-deck.md` `Status:` line from `backlog` → `in progress`. Commit: `chore(spec-29): mark in progress`.

### Task 0.2: Migration — `retailer_return_sla_config`

**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_spec29_retailer_return_sla_config.sql`

- [ ] **Step 1:** Pick a timestamp newer than the most recent migration (`ls packages/database/supabase/migrations | tail`) and create the file.
- [ ] **Step 2:** Write the migration. Mirror the conventions in `20260330000001_spec24_customer_communication.sql` (comment header, RLS, `updated_at` trigger, `IF NOT EXISTS`).
  ```sql
  -- =============================================================================
  -- Migration: <timestamp>_spec29_retailer_return_sla_config.sql
  -- Description: Spec-29 — per-retailer return-to-retail SLA configuration.
  --   Read by the Ops Control Mission Deck "Devoluciones" stage.
  -- =============================================================================

  CREATE TABLE IF NOT EXISTS public.retailer_return_sla_config (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id   UUID NOT NULL REFERENCES public.operators(id),
    retailer_id   TEXT NOT NULL,
    retailer_name TEXT NOT NULL,
    sla_hours     INTEGER NOT NULL CHECK (sla_hours > 0),
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    UNIQUE (operator_id, retailer_id)
  );

  CREATE INDEX IF NOT EXISTS idx_rrsc_operator ON public.retailer_return_sla_config(operator_id) WHERE deleted_at IS NULL;

  ALTER TABLE public.retailer_return_sla_config ENABLE ROW LEVEL SECURITY;

  CREATE POLICY rrsc_tenant_isolation ON public.retailer_return_sla_config
    USING (operator_id = (current_setting('app.current_operator_id', true))::uuid);

  -- updated_at trigger (reuse existing helper if present, else inline)
  CREATE TRIGGER trg_rrsc_updated_at
    BEFORE UPDATE ON public.retailer_return_sla_config
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  ```
- [ ] **Step 3:** Apply locally: `pnpm -F @aureon/database migrate` (or the project's actual migrate command — confirm in `packages/database/package.json`).
- [ ] **Step 4:** Verify: psql `\d retailer_return_sla_config` shows the columns + RLS enabled.
- [ ] **Step 5:** Commit: `feat(spec-29): add retailer_return_sla_config table`.

### Task 0.3: Regenerate Supabase types

- [ ] **Step 1:** Run the project's type-gen command (`pnpm -F @aureon/database generate-types` or equivalent).
- [ ] **Step 2:** Verify the new table appears in `packages/database/src/types/database.ts` (or wherever generated types live).
- [ ] **Step 3:** Commit: `chore(spec-29): regenerate database types`.

---

## Phase 1 — Pure libs (TDD)

These are the brain of the dashboard. Tests first, no DOM, no Supabase.

### Task 1.1: `labels.es.ts`

**Files:**
- Create: `apps/frontend/src/app/app/operations-control/lib/labels.es.ts`
- Test:   `apps/frontend/src/app/app/operations-control/lib/labels.es.test.ts`

- [ ] **Step 1:** Write failing test.
  ```ts
  import { describe, it, expect } from 'vitest';
  import { STAGE_LABELS, STAGE_KEYS, REASON_LABELS } from './labels.es';

  describe('labels.es', () => {
    it('exposes the 7 stages in order', () => {
      expect(STAGE_KEYS).toEqual([
        'pickup','reception','consolidation','docks','delivery','returns','reverse',
      ]);
    });
    it('returns Spanish labels', () => {
      expect(STAGE_LABELS.docks).toBe('Andenes');
      expect(STAGE_LABELS.reverse).toBe('Logística Inversa');
    });
    it('exposes reason flags', () => {
      expect(REASON_LABELS.no_driver).toBe('Sin conductor');
    });
  });
  ```
- [ ] **Step 2:** Run: `pnpm -F frontend test labels.es` → FAIL.
- [ ] **Step 3:** Implement the file with the exact labels from the spec table. Export `STAGE_KEYS`, `STAGE_LABELS`, `REASON_LABELS`, `STATUS_LABELS`.
- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit: `feat(spec-29): Spanish labels for ops control`.

### Task 1.2: `sla.ts` — effective deadline + at-risk classifier

**Files:**
- Create: `apps/frontend/src/app/app/operations-control/lib/sla.ts`
- Test:   `apps/frontend/src/app/app/operations-control/lib/sla.test.ts`

- [ ] **Step 1:** Write failing tests for `effectiveWindow(order, now)` and `classifyRisk(order, now)`. Cover:
  - Original window when no reschedule fields.
  - Reschedule **date only** overrides date but keeps original window times.
  - Reschedule **window** overrides both ends.
  - `late` when `now > end`.
  - `at_risk` when `end - now <= 6h` and not delivered.
  - `ok` otherwise.
  - Delivered orders → `none` regardless of time.
  - Boundary: exactly 6h remaining → `at_risk`.
  - Boundary: exactly 0 remaining → `late`.

  ```ts
  import { describe, it, expect } from 'vitest';
  import { effectiveWindow, classifyRisk, AT_RISK_HOURS } from './sla';

  const baseOrder = {
    id: 'o1',
    delivery_date: '2026-04-06',
    delivery_window_start: '14:00',
    delivery_window_end: '18:00',
    rescheduled_delivery_date: null,
    rescheduled_window_start: null,
    rescheduled_window_end: null,
    delivered_at: null,
  };

  it('uses original window when no reschedule', () => {
    const w = effectiveWindow(baseOrder);
    expect(w.endISO).toBe('2026-04-06T18:00:00');
  });

  it('reschedule overrides original window', () => {
    const w = effectiveWindow({ ...baseOrder,
      rescheduled_delivery_date: '2026-04-07',
      rescheduled_window_start: '09:00',
      rescheduled_window_end: '13:00' });
    expect(w.endISO).toBe('2026-04-07T13:00:00');
  });

  it('classifies LATE when now > end', () => {
    expect(classifyRisk(baseOrder, new Date('2026-04-06T19:00:00')).status).toBe('late');
  });

  it('classifies AT_RISK at exactly 6h boundary', () => {
    expect(classifyRisk(baseOrder, new Date('2026-04-06T12:00:00')).status).toBe('at_risk');
  });

  it('classifies OK when more than 6h remain', () => {
    expect(classifyRisk(baseOrder, new Date('2026-04-06T11:59:00')).status).toBe('ok');
  });

  it('delivered orders are never at risk', () => {
    expect(classifyRisk({ ...baseOrder, delivered_at: '2026-04-06T15:00:00' }, new Date('2026-04-06T19:00:00')).status).toBe('none');
  });

  it('AT_RISK_HOURS is 6', () => { expect(AT_RISK_HOURS).toBe(6); });
  ```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `sla.ts`. Pure functions, no Date global writes, no Supabase imports. Export `AT_RISK_HOURS = 6`, `effectiveWindow(order)`, `classifyRisk(order, now)`. Return `{ status: 'late'|'at_risk'|'ok'|'none', minutesRemaining: number, label: string }` where `label` is Spanish (`"ATRASADO 1h 12m"` / `"2h 04m restantes"`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-29): SLA classifier with reschedule precedence`.

### Task 1.3: `health.ts` — per-stage heuristics

**Files:**
- Create: `apps/frontend/src/app/app/operations-control/lib/health.ts`
- Test:   `apps/frontend/src/app/app/operations-control/lib/health.test.ts`

- [ ] **Step 1:** Write failing tests for `computeStageHealth(stageKey, items, now, config?)`. One small test per heuristic in the spec table:
  - Pickup crit when any pickup overdue > 2h; warn > 30m; ok otherwise.
  - Reception crit > 6h dwell, warn > 4h.
  - Consolidation crit on missed dock window, warn > 2h oldest.
  - Docks crit on idle > 1h, warn > 30m.
  - Delivery crit on no GPS ping > 30m, warn > 1h behind plan.
  - Returns crit when older than retailer SLA; warn at 80% of SLA; uses `retailer_return_sla_config`; falls back to 24h default + flags `sla_no_config` reason.
  - Reverse always `neutral`.
  - Empty input → `ok` (or `neutral` for reverse).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `health.ts`. Output shape: `{ status: 'ok'|'warn'|'crit'|'neutral', delta: string, reasonsByOrder: Map<string, ReasonKey> }`. Pure, deterministic.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-29): per-stage health heuristics`.

---

## Phase 2 — Data hooks

### Task 2.1: `useOpsControlSnapshot`

**Files:**
- Create: `apps/frontend/src/hooks/ops-control/useOpsControlSnapshot.ts`
- Test:   `apps/frontend/src/hooks/ops-control/useOpsControlSnapshot.test.ts`

**Behavior:**
- Initial fetch via TanStack Query: orders + routes + pickups + returns + retailer SLA config, all scoped by `operator_id`.
- Returns `{ snapshot, isLoading, error, lastSyncAt }` where `snapshot` contains the in-memory data needed by every panel.
- Subscribes to Supabase Realtime channels (`orders`, `routes`, `pickups`, `returns`) on mount; merges INSERT/UPDATE/DELETE events into the in-memory snapshot **without re-fetching**.
- On reconnect: triggers a single refetch.
- Cleanup on unmount.

- [ ] **Step 1:** Write failing tests with a mocked Supabase client (follow the pattern in `apps/frontend/src/hooks/dashboard/useOrdersMetrics.ts`). Cover:
  - Initial fetch is scoped by `operator_id`.
  - Realtime UPDATE merges into snapshot without re-fetching.
  - Realtime reconnect triggers exactly one refetch.
  - Hook returns stable references when nothing changes.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement using `createSPAClient()` + `supabase.channel(...).on('postgres_changes', ...)`. Use a `useRef` for the live snapshot and `useState` for a version counter so React re-renders cheaply.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-29): useOpsControlSnapshot with Realtime`.

### Task 2.2: `useStageBreakdown(stageKey)`

**Files:**
- Create: `apps/frontend/src/hooks/ops-control/useStageBreakdown.ts`
- Test:   `apps/frontend/src/hooks/ops-control/useStageBreakdown.test.ts`

- [ ] **Step 1:** Tests: returns rows for the requested stage, applies stage-specific grouping/sort (per spec table), respects pagination (`page`, `pageSize=25`), recomputes when snapshot version bumps.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement as a derived selector over `useOpsControlSnapshot()`. No Supabase calls of its own.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-29): useStageBreakdown selector`.

### Task 2.3: `useAtRiskOrders`

**Files:**
- Create: `apps/frontend/src/hooks/ops-control/useAtRiskOrders.ts`
- Test:   `apps/frontend/src/hooks/ops-control/useAtRiskOrders.test.ts`

- [ ] **Step 1:** Tests: filters out delivered orders, applies `classifyRisk` from `sla.ts`, sorts most-urgent-first (late before at-risk; within each, smallest `minutesRemaining` first), applies pagination (25), exposes `total`, ignores other operators' orders.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement as another derived selector over the snapshot.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-29): useAtRiskOrders selector`.

---

## Phase 3 — Atomic components

Each task = test + implement + commit. All copy in Spanish via `labels.es.ts`. Use Fraunces / Geist Mono / Geist Sans CSS variables (introduce them in `globals.css` if not already present — Task 3.0).

### Task 3.0: Type tokens + global font wiring

**Files:**
- Modify: `apps/frontend/src/app/globals.css` (add `--font-display`, `--font-mono`, `--font-sans` if missing)
- Modify: `apps/frontend/src/app/layout.tsx` (load Fraunces, Geist, Geist Mono via `next/font/google` if not already loaded)

- [ ] **Step 1:** Check whether Fraunces / Geist / Geist Mono are already loaded. If yes, skip. If no, add via `next/font/google` and expose as CSS variables on `<html>`.
- [ ] **Step 2:** Smoke test: `pnpm -F frontend dev` → page renders without font errors.
- [ ] **Step 3:** Commit: `feat(spec-29): wire Fraunces + Geist fonts`.

### Task 3.1: `TopBar`

**Files:**
- Create: `apps/frontend/src/app/app/operations-control/components/TopBar.tsx`
- Test: `...TopBar.test.tsx`

- [ ] **Step 1:** Test renders brand text, warehouse code, formatted date, ticking clock (use fake timers), pulsing **EN VIVO** dot.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Commit: `feat(spec-29): TopBar component`.

### Task 3.2: `AtRiskBar`

- [ ] Test: renders count + first 3 most-urgent items inline + `+ N MÁS →` affordance when total > 3. Click on bar fires `onSelect()`.
- [ ] Implement, commit: `feat(spec-29): AtRiskBar component`.

### Task 3.3: `AtRiskList`

- [ ] Test: renders the full at-risk list with the 7 columns from the spec, paginated 25/page, `Anterior / Siguiente` work, empty state shows `Sin órdenes en riesgo`.
- [ ] Implement, commit.

### Task 3.4: `StageCell`

- [ ] Test: renders index, Spanish name, big count, delta, dot color reflects health, `aria-pressed` for selected, click fires `onSelect(stageKey)`. Real `<button>`.
- [ ] Implement, commit.

### Task 3.5: `TelemetryStrip`

- [ ] Test: renders 7 `StageCell`s in spec order, only one cell can be active, click bubbles up `onStageChange(stageKey)`.
- [ ] Implement, commit.

### Task 3.6: `DrillDownPanel` (uniform template)

- [ ] Test: renders header (title + sub), `Abrir en X →` button (disabled when `deepLink === null` with `Próximamente` tooltip), 4 KPI slots, table slot, footer with last sync + `Tiempo real · Supabase Realtime`. Pagination controls inside the footer.
- [ ] Implement as a layout component with named slots (`header`, `kpis`, `table`, `pagination`).
- [ ] Commit.

---

## Phase 4 — Stage panels (7)

Each stage panel is a thin adapter around `DrillDownPanel` + `useStageBreakdown(stageKey)`. Same TDD loop for each: test the columns + KPIs + grouping match the spec table, then implement, then commit.

### Task 4.1 — `PickupPanel.tsx` (group by retailer)
### Task 4.2 — `ReceptionPanel.tsx` (oldest first)
### Task 4.3 — `ConsolidationPanel.tsx` (group by destination dock)
### Task 4.4 — `DocksPanel.tsx` (table of routes, idle highlighted)
### Task 4.5 — `DeliveryPanel.tsx` (group by route + progress bar)
### Task 4.6 — `ReturnsPanel.tsx` (group by retailer + reason; reads `retailer_return_sla_config`)
### Task 4.7 — `ReversePlaceholderPanel.tsx` (renders `Próximamente` empty state only)

Each task:
- [ ] Test → fail → implement → pass → commit (`feat(spec-29): <stage> drill-down panel`).

---

## Phase 5 — Page integration

### Task 5.1: URL state hook

**Files:**
- Create: `apps/frontend/src/app/app/operations-control/lib/useStageQuery.ts` (+ test)

- [ ] Test: `?stage=docks` parses to `'docks'`; missing param → `null` (default = at-risk); `setStage('reception')` updates URL via `useRouter().replace(...)` without scrolling.
- [ ] Implement, commit.

### Task 5.2: Replace `page.tsx`

**Files:**
- Modify: `apps/frontend/src/app/app/operations-control/page.tsx` (replace 75-LOC placeholder)
- Modify: `apps/frontend/src/app/app/operations-control/page.test.tsx` (rewrite for new shell)

- [ ] **Step 1:** Update existing tests to assert: TopBar present, AtRiskBar present, TelemetryStrip with 7 cells in Spanish, default panel = AtRiskList (no `?stage=`), clicking a stage cell mounts the corresponding panel.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement as a server component shell that:
  - Reads `operator_id` from session (existing pattern in nearby pages).
  - Fetches the initial snapshot server-side and passes it as `initialData` into a client `<MissionDeck>` island.
  - The client island wires `useOpsControlSnapshot` (with `initialData`), `useStageQuery`, the at-risk vs stage panel switch.
- [ ] **Step 4:** Run → PASS. Visual smoke test in `pnpm -F frontend dev`.
- [ ] **Step 5:** Commit: `feat(spec-29): wire Mission Deck page shell`.

### Task 5.3: Realtime end-to-end smoke

- [ ] **Step 1:** Manually update an order in Supabase Studio (change `delivery_window_end`). Confirm dashboard updates within ~1s with no full refetch (Network panel shows only the WS frame).
- [ ] **Step 2:** Manually mark a route idle. Confirm Docks stage health flips to crit + the delta line updates.
- [ ] **Step 3:** Note any drift, fix, commit. (No commit if nothing to fix.)

---

## Phase 6 — Polish, a11y, verification

### Task 6.1: Accessibility pass
- [ ] Run axe (existing project setup or `@axe-core/playwright`) on `/app/operations-control`. Zero serious/critical violations. Fix as needed. Commit.

### Task 6.2: Visual polish review
- [ ] Compare against the reference mockup (`.superpowers/brainstorm/957-1775512518/content/mission-control-v1.html`). Match grid overlay opacity, signal-color side-bars, KPI strip rhythm. Commit any tweaks: `style(spec-29): match mission-deck reference`.

### Task 6.3: Verification before completion (per `superpowers:verification-before-completion`)
- [ ] **Lint:** `pnpm -F frontend lint` → 0 errors.
- [ ] **Typecheck:** `pnpm -F frontend typecheck` → 0 errors.
- [ ] **Tests:** `pnpm -F frontend test` → all green.
- [ ] **Coverage:** new files ≥ 80% line coverage.
- [ ] **File-size budget:** every new file < 300 LOC (per `CLAUDE.md`). Run `wc -l apps/frontend/src/app/app/operations-control/**/*.tsx` → confirm.
- [ ] **Manual QA checklist:**
  - [ ] Default load shows at-risk list, no stage active.
  - [ ] Clicking each of the 7 stage cells loads the matching panel.
  - [ ] URL reflects `?stage=...` and survives reload.
  - [ ] Pagination works (25 rows/page) on at-risk list and on a populated stage.
  - [ ] Devoluciones deep-link button is **disabled** with `Próximamente` tooltip.
  - [ ] All copy is Spanish.
  - [ ] Realtime: editing an order in Studio updates the dashboard live.

### Task 6.4: PR + auto-merge (per `CLAUDE.md`)
- [ ] **Step 1:** Push branch.
- [ ] **Step 2:** `gh pr create --base main --title "feat(spec-29): Ops Control Mission Deck" --body "Implements docs/specs/spec-29-ops-control-mission-deck.md"`
- [ ] **Step 3:** `gh pr merge --auto --squash` (mandatory per project rules).
- [ ] **Step 4:** Poll `gh pr checks <N>` and `gh pr view <N> --json state,mergedAt` until merged before reporting completion.
- [ ] **Step 5:** Update spec `Status:` line — leave at `in progress`. Only the user marks it `completed`.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Realtime payloads don't include enough columns to derive stage state | Subscribe with `*` and re-query the affected row by id if needed. Fall back to a debounced refetch (1s) only on unrecognized events. |
| Snapshot grows too large for in-memory pagination | Spec acknowledges this — switch the offending panel to server-side pagination later without changing layout. |
| Fonts not yet loaded in the project | Task 3.0 handles wiring; check first to avoid double-loading. |
| `operators` / `current_setting('app.current_operator_id')` pattern differs from existing code | Mirror whatever the most recent migration does — do not invent a new RLS pattern. |
