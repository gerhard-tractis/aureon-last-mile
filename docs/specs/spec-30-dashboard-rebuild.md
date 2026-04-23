# Spec 30 — Dashboard Rebuild (Editorial C-level)

**Status:** completed

## Context & Problem

The current `/app/dashboard/*` implementation tries to be three things at once — a realtime command center, a pipeline-stage operations view, and a strategic analytics report — and fails at all three. Evidence:

- Three partially-implemented pages (`/dashboard`, `/dashboard/operaciones`, `/dashboard/analitica`) with duplicated components (`HeroSLA`, `DailyOrdersChart`, `CommittedOrdersChart` rendered twice each), four independent date filters per page, and two "Próximamente" analytics tabs shipping to production.
- `apps/frontend/src/components/dashboard/` contains **45+ files, ~6,400 LOC**, tightly coupled to individual RPCs, with dead code (`HeroSLA`'s `HeroSparkline` is rendered without data and always returns null).
- Half the pipeline-stage tabs in the current "operaciones" view are disabled placeholders.

Meanwhile, **Spec 29 (Ops Control Mission Deck)** redefines the realtime day-to-day operations surface as a separate, dark, read-only page. That draws a clean line: **Ops Control owns the shift-by-shift monitoring; the Dashboard should own strategic and tactical KPIs for C-level decision making.**

This spec rebuilds `/app/dashboard` from scratch as a single editorial page with that new job-to-be-done.

## Users & Context

- **Primary audience:** C-level — Founder, Operations Manager, Commercial Manager.
- **Cadence:** weekly review, mid-week glance, board/investor preparation. Not live ops monitoring.
- **Device:** **mobile-first** — founders are often reading this on the move. Desktop is important but secondary.
- **Decisions they come to make:**
  - "Are we on track against our strategic north-stars?"
  - "Where is the operation bleeding (which region, which customer, which failure reason)?"
  - "Which tactical metric is driving the strategic number?"
- **Language:** Spanish only. Hard-coded in `labels.es.ts`, mirroring the spec-29 pattern.

## Goals

1. Three strategic north-stars headline the page: **CPO, OTIF, NPS/CSAT** plus **Orders Delivered** as the volume context number.
2. **Editorial "one-page report" IA** — single URL, three vertical chapters, one page-level period filter, drill-downs on demand.
3. **Hybrid refresh strategy:** north-stars pre-aggregated nightly for stable headline numbers; tactical chapters read on-demand for parameterized queries.
4. **Full IA with placeholders** — placeholder chapters for CPO (mixed) and NPS (full) so the target-state shell exists from day 1 and future specs only fill slots. No layout churn.
5. **Mobile-first responsive** — 2×2 hero on phone, 4-up on tablet+, bottom sheet on phone for drills, side sheet on tablet+.
6. **Strong visual contrast with Ops Control** — light editorial executive feel vs. Ops Control's dark Bloomberg-terminal mission deck. Shared brand (Aureon gold + Instrument Serif + Geist) expressed two different moods.
7. **Aggressive cleanup** — delete the entire legacy `components/dashboard/` and `components/analytics/` trees plus their hooks; replace with ~16 focused files under `src/app/app/dashboard/components/`.

## Non-Goals

- **No realtime updates.** That is Ops Control's job. This page is a stable report.
- **No write actions.** Read-only surface, same philosophy as spec-29.
- **No export / PDF / CSV.** Out of scope for v1; becomes a separate future spec.
- **No multi-warehouse switcher.** Single-operator assumption consistent with the rest of the app.
- **No i18n framework.** Spanish only, hard-coded.
- **No print-friendly layout.** Drill-downs are sheets, not inline expansions.
- **No AI / anomaly detection.** Future spec.
- **No per-chapter date filters.** One page-level period controls everything.

---

## Design

### Information Architecture

#### Sitemap

```
/app/dashboard                        ← NEW: editorial three-chapter dashboard
                                        replaces /app/dashboard/operaciones AND /app/dashboard/analitica

/app/dashboard/operaciones            ← 301 → /app/dashboard
/app/dashboard/analitica              ← 301 → /app/dashboard

# State encoded in query string — single URL, deep-linkable, shareable
/app/dashboard?period=2026-03         ← period selector
/app/dashboard?period=2026-Q1         ← quarter
/app/dashboard?period=ytd
/app/dashboard?period=custom&from=<iso>&to=<iso>
/app/dashboard?drill=<key>            ← side/bottom sheet open
```

Role gate: `operations_manager`, `admin` (same as current).

#### Page anatomy

```
┌────────────────────────────────────────────────────────────────────┐
│  PageShell · Sidebar (existing)                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ DashboardHeader                                              │  │
│  │   Aureon · Dashboard ejecutivo                               │  │
│  │   [Mes ▼] [Trimestre] [YTD] [Personalizado]                  │  │
│  │   Marzo 2026 · al cierre de 31/03 23:59                      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌── NorthStarStrip · sticky on desktop ───────────────────────┐  │
│  │  CPO        OTIF        NPS · CSAT     ÓRDENES               │  │
│  │  —          94.2%       —              12,431                │  │
│  │  pronto     ▲ 1.4 MoM   pronto         ▲ 8% YoY              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ── CHAPTER 01 · CPO ─────────────────────────────────────────     │
│     [MIXED: placeholder hero + live tactical]                      │
│       Hero band (placeholder): — + "requires cost model"           │
│       Tactical (live):                                             │
│         · FADR %            (live)                                 │
│         · Avg KM/ruta       (live)                                 │
│         · KM/parada (proxy) (live)                                 │
│         · Órdenes/ruta      (live)                                 │
│         · Gas consumido     (placeholder)                          │
│                                                                    │
│  ── CHAPTER 02 · OTIF ────────────────────────────────────────     │
│     [FULLY LIVE]                                                   │
│       Hero gold band: 94.2% · ▲ vs feb · ▲ vs mar 2025 · meta 95   │
│       Tactical:                                                    │
│         · OTIF por región    (table → cards on mobile)             │
│         · OTIF por cliente   (table → cards on mobile)             │
│         · Razones de retraso (chart; click → drill sheet)          │
│                                                                    │
│  ── CHAPTER 03 · NPS / CSAT ──────────────────────────────────     │
│     [FULLY PLACEHOLDER]                                            │
│       Hero band (placeholder): — + "requires feedback capture"     │
│       Tactical (all placeholders):                                 │
│         · Incidentes por categoría                                 │
│         · Detractores                                              │
│         · Temas                                                    │
│                                                                    │
│  Footer · Datos al 31/03 23:59 · Hybrid · Sincronizado por cron    │
└────────────────────────────────────────────────────────────────────┘
```

### Visual Language — "Magazine Bold"

- **Aesthetic:** editorial executive — FT Weekend / Bloomberg long-read feel. Gold reserved for the hero of each chapter so it carries meaning. Deliberate contrast with Ops Control's dark Bloomberg-terminal mission deck.
- **Type (all from existing brand stack):**
  - Chapter headlines → **Instrument Serif** (italic, `--font-display`), `clamp(2rem, 5vw, 3.5rem)`
  - Numbers, IDs, deltas → **Geist Mono** (`--font-mono`), tabular figures (`font-variant-numeric: tabular-nums`)
  - UI labels / body → **Geist Sans** (`--font-sans`)
- **Color tokens** (all from `globals.css`, already wired for light/dark/custom):
  - Light: `--color-background: #f8fafc` · `--color-surface: #ffffff` · `--color-accent: #ca9a04`
  - Dark: `--color-background: #13110d` · `--color-surface: #1e1a14` · `--color-accent: #e6c15c`
  - Status: fixed across modes (`--color-status-success` etc.)
- **Hero band** (per chapter): `border-l-4 border-accent`, solid `--color-accent-muted` on mobile, gradient `from-accent-muted to-surface` on tablet+. Italic serif chapter title in `--color-accent`. Mono hero number 40-64px responsive. Delta pills below.
- **Placeholder treatment**: identical geometry, desaturated palette (`--color-text-muted` for values, `bg-muted` instead of gold), explanatory line below hero. Must feel intentional, not broken.
- **Density:** generous whitespace. C-level reads slowly; whitespace earns trust.
- **Accents:** gold appears **only** on: (1) live hero band backgrounds, (2) chapter headline italic accents, (3) active period pill, (4) focus rings. Nowhere else.

### Component tree

```
src/app/app/dashboard/
├── page.tsx                             # server shell; role gate; suspense boundaries
├── page.test.tsx
├── components/
│   ├── DashboardHeader.tsx              # title + period selector + "as of" line
│   ├── PeriodSelector.tsx               # Mes/Trim/YTD/Custom + URL sync
│   ├── NorthStarStrip.tsx               # 4-up hero strip
│   ├── NorthStarCard.tsx                # one card; modes: live | placeholder
│   ├── Chapter.tsx                      # uniform chapter shell (annotation, headline)
│   ├── ChapterHeroBand.tsx              # gold gradient block (the brand moment)
│   ├── ChapterPlaceholder.tsx           # placeholder treatment helper
│   ├── DeltaPill.tsx                    # ▲/▼ signed delta with color
│   ├── chapters/
│   │   ├── CpoChapter.tsx               # MIXED (placeholder hero + live tactical)
│   │   ├── OtifChapter.tsx              # FULLY LIVE
│   │   └── NpsChapter.tsx               # FULLY PLACEHOLDER
│   ├── tactical/
│   │   ├── FadrCard.tsx                 # CPO tactical (live)
│   │   ├── RouteKmCard.tsx              # CPO tactical (live)
│   │   ├── KmPerStopCard.tsx            # CPO tactical (live)
│   │   ├── OrdersPerRouteCard.tsx       # CPO tactical (live)
│   │   ├── GasPlaceholderCard.tsx       # CPO tactical (placeholder)
│   │   ├── OtifByRegion.tsx             # table → card list responsive
│   │   ├── OtifByCustomer.tsx           # table → card list responsive
│   │   └── LateReasonsSummary.tsx       # compact summary with drill affordance
│   └── drill/
│       ├── DrillSheet.tsx               # shadcn Sheet · side="right"|"bottom"
│       ├── drillRegistry.ts             # ?drill=<key> → lazy content component
│       └── content/
│           ├── FadrDrill.tsx            # placeholder v1 (lives in CPO placeholder chapter)
│           ├── LateReasonsDrill.tsx     # live (OTIF)
│           ├── RegionDrill.tsx          # live (OTIF)
│           └── CustomerDrill.tsx        # live (OTIF)
└── lib/
    ├── period.ts                        # period parsing + comparison derivation (pure)
    ├── format.ts                        # es-CL formatters (number, percent, delta, currency)
    └── labels.es.ts                     # all Spanish copy in one file

src/hooks/dashboard/                     # reuse folder, new hooks
├── useDashboardPeriod.ts                # URL ↔ period state sync
├── useNorthStars.ts                     # single query; returns current + prior month + prior year
├── useOtifChapter.ts                    # parallel fetch of 3 OTIF tactical RPCs
└── useCpoChapter.ts                     # live route tactics (FADR + KM + orders/route)
```

Every file stays under 300 LOC per `CLAUDE.md`.

### Data Layer

#### New table: `dashboard_monthly_rollup`

Narrow pre-aggregated table. One row per operator per month. Nullable north-star columns so future specs can backfill without a schema migration.

```sql
CREATE TABLE public.dashboard_monthly_rollup (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  period_year         INT NOT NULL CHECK (period_year BETWEEN 2020 AND 2100),
  period_month        INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),

  -- North stars (nullable → placeholder; future specs populate)
  cpo_clp             NUMERIC(12,2),     -- cost per order in CLP
  otif_pct            NUMERIC(5,2),      -- 0..100
  nps_score           NUMERIC(5,2),      -- -100..100
  csat_pct            NUMERIC(5,2),      -- 0..100

  -- Always populated
  total_orders        INT NOT NULL DEFAULT 0,
  delivered_orders    INT NOT NULL DEFAULT 0,
  failed_orders       INT NOT NULL DEFAULT 0,

  -- Provenance
  computed_at         TIMESTAMPTZ NOT NULL,
  source_daily_rows   INT NOT NULL DEFAULT 0,

  -- Standard
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,

  UNIQUE (operator_id, period_year, period_month)
);

ALTER TABLE public.dashboard_monthly_rollup ENABLE ROW LEVEL SECURITY;

CREATE POLICY dashboard_monthly_rollup_tenant_isolation
  ON public.dashboard_monthly_rollup
  FOR ALL
  USING (operator_id = public.get_operator_id())
  WITH CHECK (operator_id = public.get_operator_id());

CREATE INDEX idx_dashboard_rollup_operator_period
  ON public.dashboard_monthly_rollup(operator_id, period_year DESC, period_month DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER set_dashboard_monthly_rollup_updated_at
  BEFORE UPDATE ON public.dashboard_monthly_rollup
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

#### Nightly aggregation function

```sql
CREATE OR REPLACE FUNCTION public.calculate_dashboard_monthly_rollup(p_year INT, p_month INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.dashboard_monthly_rollup (
    operator_id, period_year, period_month,
    otif_pct, total_orders, delivered_orders, failed_orders,
    computed_at, source_daily_rows
  )
  SELECT
    pm.operator_id,
    p_year, p_month,
    ROUND(100.0 * SUM(pm.delivered_orders) / NULLIF(SUM(pm.total_orders), 0), 2),
    SUM(pm.total_orders),
    SUM(pm.delivered_orders),
    SUM(pm.failed_deliveries),
    NOW(),
    COUNT(*)
  FROM public.performance_metrics pm
  WHERE EXTRACT(YEAR FROM pm.metric_date) = p_year
    AND EXTRACT(MONTH FROM pm.metric_date) = p_month
    AND pm.retailer_name IS NULL   -- aggregate row only
    AND pm.deleted_at IS NULL
  GROUP BY pm.operator_id
  ON CONFLICT (operator_id, period_year, period_month)
  DO UPDATE SET
    otif_pct         = EXCLUDED.otif_pct,
    total_orders     = EXCLUDED.total_orders,
    delivered_orders = EXCLUDED.delivered_orders,
    failed_orders    = EXCLUDED.failed_orders,
    computed_at      = EXCLUDED.computed_at,
    source_daily_rows = EXCLUDED.source_daily_rows,
    updated_at       = NOW();
END;
$$;
```

**Reads from the existing `performance_metrics` table** (populated nightly by `calculate_daily_metrics` at 02:00 UTC, per migration `20260224000003_schedule_metrics_cron.sql`).

#### Cron schedule — 02:30 UTC (AFTER the existing daily metrics cron)

```sql
SELECT cron.schedule(
  'dashboard_monthly_rollup',
  '30 2 * * *',
  $$SELECT public.calculate_dashboard_monthly_rollup(
      EXTRACT(YEAR FROM CURRENT_DATE)::INT,
      EXTRACT(MONTH FROM CURRENT_DATE)::INT
    )$$
);
```

#### Backfill script

One-off PL/pgSQL block, idempotent, populates every month from the earliest row in `performance_metrics` through the current month. Runs once on deploy. Safe to re-run because of the `UNIQUE (operator_id, period_year, period_month)` constraint + `ON CONFLICT DO UPDATE`.

#### New RPCs

1. **`get_dashboard_north_stars(p_operator_id UUID, p_year INT, p_month INT)`** — returns 1–3 rows (current + prior_month + prior_year) from `dashboard_monthly_rollup`, graceful nulls for missing periods.
2. **`get_dashboard_otif_by_region(p_operator_id UUID, p_start DATE, p_end DATE)`** — joins `dispatches` + `orders` + `chile_comunas`, grouped by region name.
3. **`get_dashboard_otif_by_customer(p_operator_id UUID, p_start DATE, p_end DATE)`** — joins with `tenant_clients`, returns per-customer OTIF + delta vs. prior period.
4. **`get_dashboard_late_reasons(p_operator_id UUID, p_start DATE, p_end DATE)`** — aggregates `dispatches.failure_reason` + `order_reschedules` reasons into a top-N list with counts and percentages.
5. **`get_dashboard_route_tactics(p_operator_id UUID, p_start DATE, p_end DATE)`** — returns `{fadr_pct, avg_km_per_route, avg_km_per_stop, avg_orders_per_route}` from `delivery_attempts` + `routes` in a single query.

All RPCs: `SECURITY DEFINER` **NO** — they run as the authenticated user to enforce RLS via `operator_id = public.get_operator_id()`.

#### Hooks

```ts
// useDashboardPeriod.ts — URL ↔ period state bidirectional sync
useDashboardPeriod() → {
  period: { preset: 'month'|'quarter'|'ytd'|'custom', year, month, start, end },
  priorMonthPeriod,
  priorYearPeriod,                            // null when <12 months history
  setPreset,
  setCustomRange,
}

// useNorthStars.ts — single query, returns 3 rows (or null for missing)
useNorthStars(operatorId, year, month) → {
  current: NorthStarRow,
  priorMonth: NorthStarRow | null,
  priorYear: NorthStarRow | null,
  isLoading, isError,
}

// useOtifChapter.ts — parallel fetch of 3 tactical RPCs
useOtifChapter(operatorId, startDate, endDate) → {
  byRegion, byCustomer, lateReasons,
  isLoading, isError,
}

// useCpoChapter.ts — live route tactics; hero stays placeholder
useCpoChapter(operatorId, startDate, endDate) → {
  routeTactics: { fadr_pct, avg_km_per_route, avg_km_per_stop, avg_orders_per_route },
  isLoading, isError,
}
```

React Query config:
- `staleTime: 5 * 60 * 1000` (5 min — north-stars change nightly, 5 min is fine)
- `refetchInterval: false` (no polling — this is not realtime)
- `placeholderData: keepPreviousData` (period changes feel instant)

### Responsive System (mobile-first)

Breakpoints (Tailwind defaults):

| Bp | Min | Behavior |
|---|---|---|
| `base` | 0 | 2×2 hero, 1-col chapters, bottom drill sheet, period selector = `<Select>` |
| `sm` | 640 | 4-up hero starts, 1-col chapters still |
| `md` | 768 | 2-col tactical grid, side drill sheet 60%, period pills, NorthStarStrip becomes sticky |
| `lg` | 1024 | 3-col tactical grid, drill sheet 50% |
| `xl` | 1280 | Drill sheet 42%, chapter paddings expand |
| `2xl` | 1536 | `max-w-7xl` container cap — content doesn't stretch infinitely |

Per-component behavior:

| Component | Phone | Tablet | Desktop |
|---|---|---|---|
| DashboardHeader | Stacked: title + period row below | Inline | Inline + "as of" line |
| NorthStarStrip | 2×2, 88px cards | 4-up, 110px, sticky | 4-up, 128px, sticky, full deltas |
| Chapter shell | `py-8 px-4`, h = 32px | `py-10 px-6`, h = 48px | `py-12 px-8`, h = 56px + annotation |
| ChapterHeroBand | Solid `bg-accent-muted` | Gradient | Gradient + `border-l-4` |
| Tactical grid | 1 col | 2 col | 3 col |
| OtifByRegion, OtifByCustomer | **Card list** | Compact table | Full table |
| DrillSheet | `side=bottom` `h-[80vh]` | `side=right` `w-[60vw]` | `w-[50vw]` at lg, `w-[42vw]` at xl |
| PeriodSelector | Single `<Select>` | Pill row | Pill row + inline custom |

### Drill System

#### URL contract

```
?drill=<key>[&drill_params=<base64-json>]
```

- `<key>` values: `fadr`, `late_reasons`, `region`, `customer`
- Back button naturally closes the sheet (via URL pop)
- Refresh survives state
- Shareable

#### Registry

```ts
// src/app/app/dashboard/components/drill/drillRegistry.ts
import { lazy } from 'react';

export type DrillKey = 'fadr' | 'late_reasons' | 'region' | 'customer';

export const drillRegistry: Record<DrillKey, {
  title: string;
  subtitle?: string;
  content: React.LazyExoticComponent<React.ComponentType<{ params?: unknown }>>;
}> = {
  fadr:         { title: 'FADR — Motivos de no entrega', content: lazy(() => import('./content/FadrDrill')) },
  late_reasons: { title: 'Razones de retraso',           content: lazy(() => import('./content/LateReasonsDrill')) },
  region:       { title: 'OTIF por región',              content: lazy(() => import('./content/RegionDrill')) },
  customer:     { title: 'OTIF por cliente',             content: lazy(() => import('./content/CustomerDrill')) },
};
```

#### Sheet component

Uses shadcn `Sheet` (already in the codebase) with a breakpoint-aware `side` prop (`useIsMobile()` hook, already exists). Lazy-loaded content wrapped in a `<Suspense>` fallback. `scroll: false` on router.replace to prevent page jumps on drill open/close.

### Placeholder Pattern

Three variants, same visual language, must feel intentional:

1. **Placeholder North-Star card** (CPO, NPS in the strip): identical card shape, `—` value in `text-muted`, `Próximamente` pill, `bg-accent-muted` wash instead of gold gradient.
2. **Placeholder Chapter** (full NPS chapter): same Chapter shell, desaturated hero band with explanatory line `Requiere <data source>`, tactical grid of ghost cards each showing metric name + `—` + one-line explanation.
3. **Placeholder Tactical card** (Gas inside CPO live chapter): same card shape as siblings, `—` value, `Próximamente` badge, hover tooltip explaining what data collection is needed.

Copy rules: always show (1) the metric name, (2) why it's not live yet, (3) a one-line explanation of what data is needed. No spec numbers in the UI until future specs are assigned.

### Accessibility

- All interactive elements are real `<button>` or `<Link>`.
- Focus rings: `focus-visible:ring-2 focus-visible:ring-accent`.
- Drill sheet inherits shadcn Sheet's Radix Dialog underpinnings (full keyboard, focus trap, ESC to close).
- **Color is never the only signal** — every delta has ▲/▼ glyph + signed number, not just color.
- Tabular figures on every number (`font-variant-numeric: tabular-nums`) prevent digit jitter on period changes.
- YoY `—` placeholder includes `aria-label="YoY no disponible · menos de 12 meses de datos"`.
- All numbers via `Intl.NumberFormat('es-CL')` — thousands separator `.` and decimal `,`.
- Dark mode is first-class — tested in every component test.

### Testing Strategy (TDD per CLAUDE.md)

Layer 1 — pure libs (no DOM, no Supabase):
- `lib/period.test.ts`
- `lib/format.test.ts`
- `lib/labels.es.test.ts`

Layer 2 — hooks (mocked Supabase):
- `useDashboardPeriod.test.ts`
- `useNorthStars.test.ts`
- `useOtifChapter.test.ts`
- `useCpoChapter.test.ts`

Layer 3 — components (React Testing Library + user-event):
- `NorthStarCard.test.tsx`, `NorthStarStrip.test.tsx`
- `Chapter.test.tsx`, `ChapterHeroBand.test.tsx`, `ChapterPlaceholder.test.tsx`
- `DeltaPill.test.tsx`
- `chapters/{Cpo,Otif,Nps}Chapter.test.tsx`
- `tactical/{Fadr,RouteKm,KmPerStop,OrdersPerRoute,GasPlaceholder,OtifByRegion,OtifByCustomer,LateReasonsSummary}Card.test.tsx`
- `drill/DrillSheet.test.tsx`
- `PeriodSelector.test.tsx`, `DashboardHeader.test.tsx`

Layer 4 — page integration:
- `page.test.tsx` — role gate, full assembly, Spanish copy, legacy redirects.

Layer 5 — SQL/RPCs (pgTAP-style assertions):
- `dashboard_monthly_rollup.test.sql` — RLS, unique constraint, upsert behavior, zero-data edge case.
- `dashboard_rpcs.test.sql` — each RPC respects RLS, handles empty data, returns expected shape.

Coverage targets: 100% on pure libs; ≥90% on hooks + components; ≥80% on page integration.

**Not testing:** visual regression snapshots (brittle), recharts internals (trusted dep).

---

## Cleanup & Migration

### Files to delete entirely

```
apps/frontend/src/app/app/dashboard/operaciones/          # whole folder
apps/frontend/src/app/app/dashboard/analitica/            # whole folder
apps/frontend/src/components/dashboard/                   # all 45+ files + tests
apps/frontend/src/components/analytics/                   # all 4 files + tests
apps/frontend/src/hooks/dashboard/                        # whole folder + tests
apps/frontend/src/hooks/useDashboardMetrics.ts(+.test)    # barrel re-export
apps/frontend/src/hooks/useDeliveryMetrics.ts(+.test)
apps/frontend/src/hooks/useLoadingMetrics.ts(+.test)
apps/frontend/src/hooks/useDashboardDates.ts(+.test)
apps/frontend/src/hooks/useDatePreset.ts(+.test)
apps/frontend/src/lib/utils/exportDashboard.ts
```

Total: ~90 files removed, ~6,400 LOC of dead code out. **Verified via grep:** no files outside the above list import from these modules except the single case below.

### Import updates

```diff
// apps/frontend/src/providers/BrandingProvider.tsx
- import { useOperatorId } from '@/hooks/useDashboardMetrics';
+ import { useOperatorId } from '@/hooks/useOperatorId';
```

### RPC deprecation

Old RPCs become dead code the moment the legacy pages are deleted. They are **dropped in a dedicated "end-of-list" migration** in the same PR so rollback stays safe:

```sql
-- <timestamp>_spec30_drop_legacy_dashboard_rpcs.sql
DROP FUNCTION IF EXISTS public.get_otif_metrics(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_otif_by_retailer(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_fadr_metric(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_customer_performance(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_failure_reasons(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_late_deliveries(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_orders_detail(UUID, DATE, DATE, TEXT, TEXT, TEXT, BOOLEAN, INT, INT);
DROP FUNCTION IF EXISTS public.get_pending_orders_summary(UUID);
DROP FUNCTION IF EXISTS public.get_daily_orders_by_client(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_committed_orders_daily(UUID, DATE, DATE);
-- (exact list verified during implementation via `\df public.get_*` against staging)
```

---

## Out of Scope — Future Specs

Each becomes an independently-scheduled future spec. This spec ships placeholders for all of them so the IA slot exists from day 1.

| Future spec | Unlocks | Size |
|---|---|---|
| CPO cost model | CPO north-star hero live | Large — driver/vehicle/warehouse/fuel cost ingestion + allocation logic |
| Fuel & odometer tracking | Gas tactical card in CPO chapter + theft detection | Medium — new tables + entry UI + reconciliation |
| NPS / CSAT collection | NPS north-star hero + NPS chapter topics | Medium — post-delivery SMS/WA survey + storage |
| Feedback topic classification | Detractor-by-topic tactical | Medium — LLM classification over comments |
| Incidents taxonomy | Incidents tactical in NPS chapter | Small — extend `exception_category_enum`, entry UI |
| Dashboard export | PDF / CSV export for QBRs | Small (after CPO/NPS exist) |
| Metric alerts | Threshold-based notifications | Small |
| Multi-warehouse switcher | Warehouse selector | Small |
| Dashboard AI assistant | Natural-language Q&A over metrics | Future |

---

## Acceptance Criteria

- [ ] `/app/dashboard` renders with `DashboardHeader` + `NorthStarStrip` + 3 chapters in order CPO → OTIF → NPS.
- [ ] `/app/dashboard/operaciones` and `/app/dashboard/analitica` 301-redirect to `/app/dashboard`, preserving query params.
- [ ] Period selector (Mes / Trim / YTD / Personalizado) changes URL and all data re-fetches.
- [ ] Month default on first load = current calendar month in `es-CL`.
- [ ] MoM and YoY deltas render on north-star cards; YoY shows `—` with tooltip when <12 months of history.
- [ ] NorthStarStrip is sticky ≥md, not sticky on mobile.
- [ ] OTIF chapter renders live: hero band + `OtifByRegion` + `OtifByCustomer` + `LateReasonsSummary`.
- [ ] CPO chapter renders: placeholder hero + **live** FADR, avg KM/ruta, KM/parada, órdenes/ruta + placeholder Gas card.
- [ ] NPS chapter renders: placeholder hero + 3 placeholder tactical cards with Spanish explanations.
- [ ] DrillSheet opens via `?drill=<key>`, side="right" on ≥md, side="bottom" on <md.
- [ ] Drill sheet survives reload and is closed by the browser back button.
- [ ] All tables become card lists below `md`.
- [ ] All numbers use `Intl.NumberFormat('es-CL')` with tabular figures.
- [ ] Role gated to `operations_manager` and `admin`.
- [ ] Nightly cron `dashboard_monthly_rollup` populates current month at 02:30 UTC.
- [ ] Backfill script populates every available month on first deploy, idempotent.
- [ ] All Vitest + SQL tests pass.
- [ ] ≥90% coverage on new hooks + components; 100% on pure libs.
- [ ] Dark mode renders without visual bugs (tested per component, manual smoke check).
- [ ] Lighthouse desktop: performance ≥90, accessibility ≥95, best-practices ≥95.
- [ ] `/app/dashboard` route initial JS ≤ 80 KB gzipped (drill content lazy).
- [ ] No imports remain from deleted modules anywhere in the codebase (grep verification).
- [ ] CI green, PR merged via auto-merge per `CLAUDE.md`.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Backfill script misaggregates historical months; launch numbers wrong | Script is idempotent; manual spot-check 3 random months vs live `performance_metrics` before cutover. |
| Monthly rollup cron runs before daily metrics cron completes | Schedule: daily at 02:00 UTC, monthly rollup at 02:30 UTC. Monitored via `cron.job_run_details`. |
| On-demand tactical RPCs slow on operators with 100k+ dispatches | Benchmark with synthetic dataset; add composite indexes on `(operator_id, created_at, status)` if needed. |
| Cleanup deletes a file that ops-control page imports | Import audit already performed (grep of `@/components/dashboard/*`, `@/components/analytics/*`, all target hooks) — only `BrandingProvider` has a stray reference, handled. |
| Mobile bottom sheet conflicts with iOS Safari viewport resize | Use shadcn `Sheet` which handles viewport events; regression test at 375×667 verifies no overflow. |
| Dark mode gold gradient reads muddy | Component tests assert dark-mode class presence; manual QA gate on PR approval. |
| User bookmarks break | 301 redirects preserve existing bookmarks for `/operaciones` and `/analitica`. |
| Design drifts from mockups during implementation | Dispatch `vercel:react-best-practices` agent after TSX files are written; spec includes the brainstorm mockup references below. |

---

## Resolved Decisions

These are the locked choices from the brainstorming session (2026-04-08). Future sessions should respect them rather than re-deriving.

| Topic | Decision | Reason |
|---|---|---|
| Audience | C-level (Founder, Ops Manager, Commercial Manager) | Defines cadence, language, and the "editorial" tone. |
| North stars | CPO · OTIF · NPS/CSAT + Orders Delivered | User's explicit KPI tree. CPO/NPS are complex and deferred. |
| Scoping | Full IA with placeholders (Option A) | Ship the shell; future specs fill slots. No layout churn. |
| IA | Three-Chapter Scroll (Approach A) | Editorial one-page report, single URL, anchors, no nav clicks. |
| Time horizon | Period selector (Month/Quarter/YTD/Custom), default month, MoM + YoY comparisons | Executive convention, flexible for board prep. |
| Drill pattern | D2 — Side sheet ≥md, bottom sheet <md | Keeps context visible; one component, two behaviors. |
| Responsive | Mobile-first | C-level are often mobile. Three-chapter scroll is naturally mobile-friendly. |
| Visual style | Magazine Bold (Style 2) | Distinctive, brand-strong, contrasts with Ops Control mission deck. |
| Refresh | Hybrid (C) — pre-aggregated north-stars, on-demand tactical | Trust-anchor headlines + fast exploratory detail. |
| YoY data | Degrades gracefully to `—` with tooltip until 12 months of history exist | Project is new; no choice. |
| Export | Out of scope for v1 | Future spec after CPO/NPS exist. |
| Cleanup aggressiveness | Delete ~90 legacy files in the same PR | Grep audit proves no external consumers. |
| Dark mode | First-class, tested per component | Consistency with the rest of the app. |

---

## Brainstorming artifacts

Visual mockups generated during the session (HTML, gitignored):
`.superpowers/brainstorm/793-1775681948/content/`
- `01-ia-approaches.html` — 3 IA layouts side by side
- `03-drill-pattern.html` — 4 drill interaction patterns
- `04-mobile-first.html` — responsive verification
- `05-visual-style.html` — 3 visual styles

## Open Questions

_None — all open items resolved during the brainstorming session._

---

# Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` (if subagents available) or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/app/dashboard/*` with a single editorial C-level dashboard — three chapters (CPO · OTIF · NPS) headlined by a 4-up north-star strip, hybrid refresh, mobile-first, full placeholder pattern for missing-data metrics.

**Architecture:** Server component shell + client islands with React Query + shadcn Sheet for drills + pre-aggregated monthly rollup table + on-demand tactical RPCs.

**Tech Stack:** Next.js App Router · React Server Components · TanStack Query · Supabase (Postgres + RLS + pg_cron) · TypeScript · Vitest + React Testing Library + shadcn/ui.

**TDD reminder (per `CLAUDE.md`):** every step writes the failing test first, watches it fail, implements the minimum, watches it pass, commits.

**Branch:** `feat/spec-30-dashboard-rebuild` (already created off `origin/main`).

**Worktree (recommended per `superpowers:using-git-worktrees`):** `../Aureon_Last_Mile-spec30`.

---

## Phase 0 — Foundations

### Task 0.1: Mark spec as in progress

- [ ] **Step 1:** Update `docs/specs/spec-30-dashboard-rebuild.md` `Status:` line from `backlog` → `in progress`.
- [ ] **Step 2:** Commit: `chore(spec-30): mark in progress`.

### Task 0.2: Migration — `dashboard_monthly_rollup` table

**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_spec30_dashboard_monthly_rollup.sql`

- [ ] **Step 1:** Pick a timestamp newer than the most recent migration (`ls packages/database/supabase/migrations | tail`).
- [ ] **Step 2:** Write the migration using the schema in the Design section. Include comment header, `IF NOT EXISTS`, RLS policy, composite index, `set_updated_at` trigger.
- [ ] **Step 3:** Apply locally: `pnpm -F @aureon/database migrate` (or the project's actual migrate command — verify in `packages/database/package.json`).
- [ ] **Step 4:** Verify: `psql \d dashboard_monthly_rollup` shows columns + RLS enabled.
- [ ] **Step 5:** Commit: `feat(spec-30): add dashboard_monthly_rollup table`.

### Task 0.3: Migration — aggregation function + cron

**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_spec30_dashboard_rollup_cron.sql`

- [ ] **Step 1:** Write `calculate_dashboard_monthly_rollup(p_year INT, p_month INT)` per the Design section. `LANGUAGE plpgsql` `SECURITY DEFINER`. Reads from `performance_metrics`, upserts into `dashboard_monthly_rollup`.
- [ ] **Step 2:** Wrap `cron.schedule('dashboard_monthly_rollup', '30 2 * * *', ...)` in a `DO $$ ... EXCEPTION WHEN OTHERS THEN RAISE NOTICE $$` block to survive local dev without `pg_cron`.
- [ ] **Step 3:** Apply locally; verify via `SELECT * FROM cron.job WHERE jobname = 'dashboard_monthly_rollup';`.
- [ ] **Step 4:** Commit: `feat(spec-30): add dashboard rollup cron`.

### Task 0.4: Migration — new dashboard RPCs

**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_spec30_dashboard_rpcs.sql`

- [ ] **Step 1:** Write all 5 new RPCs:
  - `get_dashboard_north_stars(UUID, INT, INT)`
  - `get_dashboard_otif_by_region(UUID, DATE, DATE)`
  - `get_dashboard_otif_by_customer(UUID, DATE, DATE)`
  - `get_dashboard_late_reasons(UUID, DATE, DATE)`
  - `get_dashboard_route_tactics(UUID, DATE, DATE)`
- [ ] **Step 2:** Each RPC filters by `operator_id = p_operator_id` (relies on RLS, not `SECURITY DEFINER`).
- [ ] **Step 3:** `GRANT EXECUTE ... TO authenticated`.
- [ ] **Step 4:** Apply locally + smoke-test with `SELECT * FROM get_dashboard_north_stars(...)`.
- [ ] **Step 5:** Commit: `feat(spec-30): add dashboard RPCs`.

### Task 0.5: Backfill script

**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_spec30_dashboard_rollup_backfill.sql`

- [ ] **Step 1:** Write a `DO $$ ... $$` block that loops from the earliest `(year, month)` in `performance_metrics` up to the current month, calling `calculate_dashboard_monthly_rollup(y, m)` for each.
- [ ] **Step 2:** Idempotent by virtue of the `ON CONFLICT DO UPDATE` in the aggregation function.
- [ ] **Step 3:** Apply locally; verify `SELECT * FROM dashboard_monthly_rollup ORDER BY period_year DESC, period_month DESC;` shows historical months.
- [ ] **Step 4:** Commit: `feat(spec-30): backfill dashboard monthly rollup`.

### Task 0.6: Regenerate Supabase types

- [ ] **Step 1:** Run the type-gen command (`pnpm -F @aureon/database generate-types` or equivalent — verify in `package.json`).
- [ ] **Step 2:** Verify `dashboard_monthly_rollup` appears in the generated types.
- [ ] **Step 3:** Commit: `chore(spec-30): regenerate database types`.

---

## Phase 1 — Pure libs (TDD)

### Task 1.1: `lib/period.ts`

**Files:**
- Create: `apps/frontend/src/app/app/dashboard/lib/period.ts`
- Test:   `apps/frontend/src/app/app/dashboard/lib/period.test.ts`

- [ ] **Step 1:** Write failing tests for:
  - `parsePeriodFromSearchParams(sp)` — parses `month|quarter|ytd|custom`, fallback to current month.
  - `getPriorMonthPeriod(period)` — rolls over year when month === 1.
  - `getPriorYearPeriod(period)` — returns `null` if target date < 2020 (no-history boundary).
  - `getPeriodLabel(period)` — returns Spanish `'Marzo 2026'` / `'Q1 2026'` / `'2026 YTD'` / `'01 mar – 31 mar 2026'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Keep pure; no I/O.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): period parsing + derivation lib`.

### Task 1.2: `lib/format.ts`

**Files:**
- Create: `apps/frontend/src/app/app/dashboard/lib/format.ts`
- Test:   `apps/frontend/src/app/app/dashboard/lib/format.test.ts`

- [ ] **Step 1:** Write failing tests for:
  - `formatNumber(12431)` → `'12.431'` (es-CL).
  - `formatPercent(94.2)` → `'94,2%'`, `null` → `'—'`.
  - `formatDelta(+1.4)` → `'▲ 1,4'`, `-2.1` → `'▼ 2,1'`, `0` → `'0,0'`, `null` → `'—'`.
  - `formatCurrency(125000, 'CLP')` → `'$ 125.000'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement using `Intl.NumberFormat('es-CL', ...)`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): es-CL formatters lib`.

### Task 1.3: `lib/labels.es.ts`

**Files:**
- Create: `apps/frontend/src/app/app/dashboard/lib/labels.es.ts`
- Test:   `apps/frontend/src/app/app/dashboard/lib/labels.es.test.ts`

- [ ] **Step 1:** Write failing test asserting `CHAPTER_LABELS`, `NORTH_STAR_LABELS`, `TACTICAL_LABELS`, `DRILL_LABELS`, `PERIOD_PRESET_LABELS`, `PLACEHOLDER_COPY` exist with expected Spanish strings.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with const exports. No English leakage.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): Spanish labels for dashboard`.

---

## Phase 2 — Hooks (TDD)

### Task 2.1: `useDashboardPeriod`

**Files:**
- Create: `apps/frontend/src/hooks/dashboard/useDashboardPeriod.ts`
- Test:   `apps/frontend/src/hooks/dashboard/useDashboardPeriod.test.ts`

- [ ] **Step 1:** Write failing tests (mock `useSearchParams` + `useRouter`):
  - Reads period from URL on mount.
  - `setPreset('quarter')` updates URL via `router.replace` (not `push`) with `scroll: false`.
  - `setCustomRange({start, end})` validates `end > start`, writes to URL.
  - Derives `priorMonthPeriod` and `priorYearPeriod`; the latter returns `null` when insufficient history.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): useDashboardPeriod hook`.

### Task 2.2: `useNorthStars`

**Files:**
- Create: `apps/frontend/src/hooks/dashboard/useNorthStars.ts`
- Test:   `apps/frontend/src/hooks/dashboard/useNorthStars.test.ts`

- [ ] **Step 1:** Write failing tests (mock Supabase client):
  - Calls `get_dashboard_north_stars` with `{p_operator_id, p_year, p_month}`.
  - Returns `{current, priorMonth, priorYear}` on success.
  - `priorYear === null` when RPC returns <3 rows.
  - `isError` on RPC failure.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with TanStack Query; `staleTime: 5 min`; `placeholderData: keepPreviousData`; `enabled: !!operatorId`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): useNorthStars hook`.

### Task 2.3: `useOtifChapter`

**Files:**
- Create: `apps/frontend/src/hooks/dashboard/useOtifChapter.ts`
- Test:   `apps/frontend/src/hooks/dashboard/useOtifChapter.test.ts`

- [ ] **Step 1:** Write failing tests: parallel fetch of 3 RPCs (`byRegion`, `byCustomer`, `lateReasons`); per-query isLoading/isError; `keepPreviousData` across period changes.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement using 3 `useQuery` calls returning a combined object.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): useOtifChapter hook`.

### Task 2.4: `useCpoChapter`

**Files:**
- Create: `apps/frontend/src/hooks/dashboard/useCpoChapter.ts`
- Test:   `apps/frontend/src/hooks/dashboard/useCpoChapter.test.ts`

- [ ] **Step 1:** Write failing tests: calls `get_dashboard_route_tactics`; returns `routeTactics: {fadr_pct, avg_km_per_route, avg_km_per_stop, avg_orders_per_route}`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): useCpoChapter hook`.

---

## Phase 3 — Shell components (TDD)

### Task 3.1: `DeltaPill`

**Files:**
- Create: `apps/frontend/src/app/app/dashboard/components/DeltaPill.tsx`
- Test:   `apps/frontend/src/app/app/dashboard/components/DeltaPill.test.tsx`

- [ ] **Step 1:** Write failing tests: positive → ▲ + green class; negative → ▼ + red; zero → `0,0` neutral; null → `—` with `aria-label`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement using `formatDelta` from lib.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): DeltaPill component`.

### Task 3.2: `NorthStarCard`

**Files:**
- Create: `apps/frontend/src/app/app/dashboard/components/NorthStarCard.tsx`
- Test:   `apps/frontend/src/app/app/dashboard/components/NorthStarCard.test.tsx`

- [ ] **Step 1:** Write failing tests: live mode renders value + MoM + YoY; placeholder mode renders `—` + `Próximamente`; YoY null → tooltip label.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; accepts `{mode, label, value, moMDelta, yoYDelta, placeholderHint}`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): NorthStarCard component`.

### Task 3.3: `NorthStarStrip`

**Files:**
- Create: `apps/frontend/src/app/app/dashboard/components/NorthStarStrip.tsx`
- Test:   `apps/frontend/src/app/app/dashboard/components/NorthStarStrip.test.tsx`

- [ ] **Step 1:** Write failing tests: renders 4 cards in order CPO → OTIF → NPS → Orders; responsive grid classes present (`grid-cols-2 md:grid-cols-4`); sticky classes present only `md:sticky`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; consumes `useNorthStars`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): NorthStarStrip component`.

### Task 3.4: `Chapter` + `ChapterHeroBand` + `ChapterPlaceholder`

**Files:**
- Create: `Chapter.tsx`, `ChapterHeroBand.tsx`, `ChapterPlaceholder.tsx` + tests

- [ ] **Step 1:** Write failing tests: `Chapter` renders annotation (`CAPÍTULO 0N`) + italic serif headline with `var(--font-display)`; `ChapterHeroBand` renders hero value + deltas + left border + accent bg; `ChapterPlaceholder` renders muted hero + explanatory line.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement all three.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): Chapter shell components`.

### Task 3.5: `PeriodSelector`

**Files:**
- Create: `PeriodSelector.tsx` + test

- [ ] **Step 1:** Write failing tests: pill-row on ≥md, `<Select>` on <md (`useIsMobile` mock); clicking a preset calls `setPreset`; custom preset opens date inputs.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; consumes `useDashboardPeriod`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): PeriodSelector component`.

### Task 3.6: `DashboardHeader`

**Files:**
- Create: `DashboardHeader.tsx` + test

- [ ] **Step 1:** Write failing tests: renders title + `PeriodSelector` + "as of" line with formatted period label.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): DashboardHeader component`.

---

## Phase 4 — Tactical components (TDD)

### Task 4.1: CPO tactical cards (5 cards)

**Files:**
- Create: `tactical/FadrCard.tsx`, `tactical/RouteKmCard.tsx`, `tactical/KmPerStopCard.tsx`, `tactical/OrdersPerRouteCard.tsx`, `tactical/GasPlaceholderCard.tsx` + tests

- [ ] **Step 1:** Write failing tests per card: renders label + mono value + secondary description; `GasPlaceholderCard` shows `—` + `Próximamente` + hover tooltip.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; 4 cards consume `useCpoChapter.routeTactics`, 1 is static placeholder.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): CPO tactical cards`.

### Task 4.2: `OtifByRegion`

**Files:**
- Create: `tactical/OtifByRegion.tsx` + test

- [ ] **Step 1:** Write failing tests: renders as table at ≥md (uses `DataTable` primitive); renders as card list at <md; row with `total < 5` shows "muestra insuficiente" pill; clicking a row sets `?drill=region&drill_params=<base64>`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; consumes `useOtifChapter.byRegion`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): OtifByRegion tactical`.

### Task 4.3: `OtifByCustomer`

**Files:**
- Create: `tactical/OtifByCustomer.tsx` + test

- [ ] **Step 1:** Write failing tests: same responsive pattern as `OtifByRegion`; columns: Cliente / Pedidos / OTIF / Δ vs período anterior; row click → `?drill=customer`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): OtifByCustomer tactical`.

### Task 4.4: `LateReasonsSummary`

**Files:**
- Create: `tactical/LateReasonsSummary.tsx` + test

- [ ] **Step 1:** Write failing tests: renders top-5 reasons as a compact horizontal bar strip with mono counts; "Ver todas →" button sets `?drill=late_reasons`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; consumes `useOtifChapter.lateReasons`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): LateReasonsSummary tactical`.

---

## Phase 5 — Chapters (TDD)

### Task 5.1: `CpoChapter`

**Files:**
- Create: `chapters/CpoChapter.tsx` + test

- [ ] **Step 1:** Write failing tests: renders `Chapter` shell with annotation "CAPÍTULO 01"; hero band is placeholder; 5 tactical cards render (4 live + 1 placeholder).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): CpoChapter`.

### Task 5.2: `OtifChapter`

**Files:**
- Create: `chapters/OtifChapter.tsx` + test

- [ ] **Step 1:** Write failing tests: live hero band with MoM + YoY from `useNorthStars.current.otif_pct`; renders 3 tactical components.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): OtifChapter`.

### Task 5.3: `NpsChapter`

**Files:**
- Create: `chapters/NpsChapter.tsx` + test

- [ ] **Step 1:** Write failing tests: placeholder hero with `Requiere captura de feedback post-entrega`; 3 placeholder tactical cards (Incidentes / Detractores / Temas); explanation line at bottom.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): NpsChapter`.

---

## Phase 6 — Drill system (TDD)

### Task 6.1: `drillRegistry` + content stubs

**Files:**
- Create: `drill/drillRegistry.ts`
- Create: `drill/content/FadrDrill.tsx`, `LateReasonsDrill.tsx`, `RegionDrill.tsx`, `CustomerDrill.tsx`
- Test:   `drill/drillRegistry.test.ts`

- [ ] **Step 1:** Write failing tests: `drillRegistry` exposes all 4 keys with titles in Spanish; each entry has a lazy content component.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement registry + thin content stubs (real data wiring happens in test 6.3+).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): drill registry`.

### Task 6.2: `DrillSheet`

**Files:**
- Create: `drill/DrillSheet.tsx` + test

- [ ] **Step 1:** Write failing tests: opens when `?drill=<valid_key>`; closed state when `?drill` absent; `side="bottom"` on mobile, `side="right"` on desktop; ESC closes; back button closes.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement using shadcn `Sheet` + `useSearchParams` + `useRouter` + `useIsMobile` + `<Suspense>` around lazy content.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): DrillSheet`.

### Task 6.3: Live drill content — `LateReasonsDrill`

**Files:**
- Update: `drill/content/LateReasonsDrill.tsx` + test

- [ ] **Step 1:** Write failing tests: renders paginated table from `get_dashboard_late_reasons`; respects current period from URL.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with a dedicated hook `useLateReasonsDrill`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): LateReasonsDrill live`.

### Task 6.4: Live drill content — `RegionDrill`, `CustomerDrill`

- [ ] **Step 1-5:** Repeat pattern for both: failing test → implement → commit.

### Task 6.5: Placeholder drill content — `FadrDrill`

- [ ] **Step 1:** Write failing test: renders a placeholder message referencing the pending CPO cost model work.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement as a static placeholder component (live data wiring deferred to the CPO spec).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): FadrDrill placeholder`.

---

## Phase 7 — Page integration

### Task 7.1: `page.tsx`

**Files:**
- Create: `apps/frontend/src/app/app/dashboard/page.tsx`
- Create: `apps/frontend/src/app/app/dashboard/page.test.tsx`

- [ ] **Step 1:** Write failing integration tests: role gate rejects `driver`; renders `DashboardHeader` + `NorthStarStrip` + 3 chapters + `DrillSheet`; Spanish copy present.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the page. Wrap body in `<Suspense fallback={<DashboardSkeleton />}>`. Use `PageShell` for layout.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): dashboard page integration`.

### Task 7.2: Legacy redirects

**Files:**
- Update: `apps/frontend/next.config.ts` (add `redirects`)
- OR create: `apps/frontend/src/app/app/dashboard/operaciones/page.tsx` with `redirect()` call
- Test:   extend `page.test.tsx`

- [ ] **Step 1:** Write failing test that navigating to `/app/dashboard/operaciones?tab=pickup` lands on `/app/dashboard?tab=pickup` (or just `/app/dashboard`) with 301.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add Next.js `redirects()` entries in `next.config.ts` mapping `/app/dashboard/operaciones` and `/app/dashboard/analitica` → `/app/dashboard`, permanent.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(spec-30): legacy dashboard redirects`.

---

## Phase 8 — Cleanup

Before each delete, run `grep -r "from '@/components/dashboard/<FileName>'" apps/frontend/src` (and analogous for analytics/hooks) to confirm zero external imports. If any found, refactor the consumer first.

### Task 8.1: Update `BrandingProvider` import

- [ ] **Step 1:** Change import to `@/hooks/useOperatorId`.
- [ ] **Step 2:** Verify tests still pass (`pnpm -F frontend test BrandingProvider`).
- [ ] **Step 3:** Commit: `refactor(spec-30): BrandingProvider uses useOperatorId directly`.

### Task 8.2: Delete legacy pages

- [ ] **Step 1:** `git rm -r apps/frontend/src/app/app/dashboard/operaciones apps/frontend/src/app/app/dashboard/analitica`.
- [ ] **Step 2:** Verify build succeeds.
- [ ] **Step 3:** Commit: `chore(spec-30): remove legacy dashboard pages`.

### Task 8.3: Delete legacy `components/dashboard/`

- [ ] **Step 1:** Final grep audit (no external imports).
- [ ] **Step 2:** `git rm -r apps/frontend/src/components/dashboard`.
- [ ] **Step 3:** Run `pnpm -F frontend build` and `pnpm -F frontend test` — both must pass.
- [ ] **Step 4:** Commit: `chore(spec-30): remove legacy components/dashboard`.

### Task 8.4: Delete legacy `components/analytics/`

- [ ] **Step 1-4:** Same pattern.
- [ ] **Step 5:** Commit: `chore(spec-30): remove legacy components/analytics`.

### Task 8.5: Delete legacy hooks

- [ ] **Step 1:** `git rm` the folder and individual hook files listed in the Cleanup section.
- [ ] **Step 2:** Build + test.
- [ ] **Step 3:** Commit: `chore(spec-30): remove legacy dashboard hooks`.

### Task 8.6: Delete `exportDashboard` util

- [ ] **Step 1:** `git rm apps/frontend/src/lib/utils/exportDashboard.ts`.
- [ ] **Step 2:** Build + test.
- [ ] **Step 3:** Commit: `chore(spec-30): remove exportDashboard util`.

### Task 8.7: Drop legacy RPCs (migration)

**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_spec30_drop_legacy_dashboard_rpcs.sql`

- [ ] **Step 1:** Confirm the exact signatures via `\df public.get_*` against local dev DB.
- [ ] **Step 2:** Write `DROP FUNCTION IF EXISTS ... ;` for each legacy RPC (see Design section for the list).
- [ ] **Step 3:** Apply locally. Verify with `\df public.get_dashboard_*` (new RPCs remain) and that all legacy `get_*` dashboard names are gone.
- [ ] **Step 4:** Commit: `chore(spec-30): drop legacy dashboard RPCs`.

---

## Phase 9 — Polish & verification

### Task 9.1: Dark mode smoke tests

- [ ] **Step 1:** Add one dark-mode assertion per chapter component: mount with `document.documentElement.classList.add('dark')`; assert expected class on the hero band.
- [ ] **Step 2:** Run full test suite — all green.
- [ ] **Step 3:** Commit: `test(spec-30): dark-mode smoke assertions per chapter`.

### Task 9.2: Mobile responsiveness E2E

- [ ] **Step 1:** Add a Playwright test `e2e/dashboard-mobile.spec.ts` that loads `/app/dashboard` at 375×667 and asserts: no horizontal scroll, hero strip is 2×2, drill opens as bottom sheet on click.
- [ ] **Step 2:** Run → PASS.
- [ ] **Step 3:** Commit: `test(spec-30): mobile e2e smoke`.

### Task 9.3: Lighthouse audit

- [ ] **Step 1:** Build + `pnpm -F frontend start`, run Lighthouse on `/app/dashboard` desktop. Record perf / a11y / best-practices.
- [ ] **Step 2:** If any score <target, address (most likely: unused JS → confirm lazy loading; image LCP → ensure no unnecessary images on the page).
- [ ] **Step 3:** Commit final improvements if needed.

### Task 9.4: Bundle size verification

- [ ] **Step 1:** Run `pnpm -F frontend build` and inspect the `.next/` output for `/app/dashboard` route initial JS.
- [ ] **Step 2:** Verify ≤ 80 KB gzipped. If larger, move heavy imports behind `dynamic()` or verify Suspense boundaries are splitting correctly.
- [ ] **Step 3:** Commit bundle fixes if needed.

### Task 9.5: Final grep audit

- [ ] **Step 1:** Run `grep -r "@/components/dashboard\|@/components/analytics\|useDashboardMetrics\|useDeliveryMetrics\|useLoadingMetrics\|useDatePreset\|exportDashboard" apps/frontend/src` — should return zero hits.
- [ ] **Step 2:** If anything found, refactor and commit.

---

## Phase 10 — PR & merge

- [ ] **Step 1:** Push branch to origin.
- [ ] **Step 2:** `gh pr create` with a summary that lists the locked decisions + the acceptance criteria checklist. Per `CLAUDE.md`, use a feature branch + PR.
- [ ] **Step 3:** `gh pr merge --auto --squash` — mandatory auto-merge.
- [ ] **Step 4:** Poll CI (`gh pr checks <N>`) until all checks green.
- [ ] **Step 5:** Verify PR merged: `gh pr view <N> --json state,mergedAt`.
- [ ] **Step 6:** Clean up the worktree: `git worktree remove ../Aureon_Last_Mile-spec30`.
- [ ] **Step 7:** Update `Status:` line to `completed` ONLY after user confirms the feature is done (per `docs/specs/CLAUDE.md` rule: "Never self-declare completed").

---

## Post-merge verification

- [ ] Navigate to `/app/dashboard` in preview → all 3 chapters render.
- [ ] Change period → URL updates, data re-fetches.
- [ ] Click a tactical row → drill opens, URL updates.
- [ ] Resize to mobile → bottom sheet behavior.
- [ ] Toggle dark mode → no visual bugs.
- [ ] Spot-check 3 random `dashboard_monthly_rollup` rows vs. the equivalent `SELECT SUM(...) FROM performance_metrics` — numbers match.

---

*Plan authored 2026-04-08 via `superpowers:brainstorming` session. Visual mockups archived at `.superpowers/brainstorm/793-1775681948/content/`.*
