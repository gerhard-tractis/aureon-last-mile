# Story 3.2: Build Hero SLA Section with Real-Time Calculation

Status: done

## Story

As a business owner (operations_manager or admin),
I want a prominent Hero SLA section on the dashboard showing real-time SLA fulfillment percentage with trend indicators, progress bar, and drill-down capability,
so that I can instantly assess recent delivery performance at a glance.

## Acceptance Criteria (BDD)

1. **Hero SLA Display** — Large percentage display (4rem font, bold) centered in a prominent card at top of dashboard, showing SLA % from `calculate_sla()` RPC for the **last 7 days** date range
2. **Color-Coded Thresholds** — SLA % is color-coded: green (`#10b981`) for >= 95%, yellow/amber (`#f59e0b`) for 90-94.9%, red (`#ef4444`) for < 90%. When SLA is null (no data), display "N/A" in slate-400
3. **Trend Indicator** — Arrow + delta text comparing current 7-day SLA vs previous 7-day period (e.g., "↑ +2.3% vs semana anterior"). Green for positive, red for negative. Hidden entirely when previous period returns null
4. **Progress Bar** — Full-width bar (max 800px, 32px height, rounded) with Tractis gold gradient fill, percentage text inside with dark text (`slate-800`) for accessibility, slate-200 background
5. **Context Line** — "X de Y entregas cumplidas" from `performance_metrics` aggregate rows summed over 7-day range. Shows "Sin datos para este periodo" when no data
6. **Inline Sub-Metrics** — Below progress bar: FADR % (from `calculate_fadr()` RPC) and failure count/percentage (from `performance_metrics` table `failed_deliveries` / `total_orders`), displayed horizontally
7. **Drill-Down Dialog** — Clicking the hero section opens a shadcn Dialog with placeholder content: "Desglose horario, Rendimiento por comuna/zona, Rendimiento por conductor". Must be keyboard-accessible (Enter/Space to open, Escape to close). Hero card needs `role="button"`, `tabIndex={0}`, `aria-label="Ver analisis detallado de SLA"`
8. **Skeleton Loading** — Show skeleton loaders (not spinners) during initial data fetch, matching the hero section layout dimensions
9. **Responsive** — Desktop: full-width card with 48px padding. Tablet/mobile: reduced padding (24px), percentage scales to 3rem
10. **QueryClientProvider** — Must be added to the app layout since it does not exist yet
11. **RBAC** — Dashboard page only accessible to `operations_manager` and `admin` roles. Redirect other roles to `/app`. Nav item only visible to allowed roles
12. **Error State** — On RPC error, show last cached value (TanStack Query default) + warning banner: "Los datos pueden estar desactualizados" using shadcn `Alert` with `AlertCircle` icon
13. **Auto-Refresh** — All dashboard queries refresh every 30s via TanStack Query `refetchInterval`. Set `refetchOnWindowFocus: false` to avoid double-fetches

## Tasks / Subtasks

- [x] Task 1: Add QueryClientProvider to app layout (AC: #10)
  - [x]1.1 Create `src/components/Providers.tsx` — client component wrapping children in `QueryClientProvider` with defaults (`staleTime: 30000`, `gcTime: 300000`, `refetchOnWindowFocus: false`)
  - [x]1.2 Wrap children in `src/app/app/layout.tsx` with `<Providers>` (inside `<GlobalProvider>`)
  - [x]1.3 Smoke test: load `/app/admin/users` page and confirm user list still renders (existing `useUsers` hook now has a provider)

- [x] Task 2: Add shadcn `skeleton` component (AC: #8)
  - [x]2.1 Run `npx shadcn@latest add skeleton` — do NOT add `dialog`, it already exists at `src/components/ui/dialog.tsx`
  - [x]2.2 Verify `src/components/ui/skeleton.tsx` created

- [x] Task 3: Add Tractis gold CSS variables (AC: #4)
  - [x]3.1 Add to `src/app/globals.css` in the `:root` block:
    ```css
    --gold-primary: #e6c15c;
    --gold-light: #fef3c7;
    ```
  - [x]3.2 Extend `tailwind.config.ts` colors: `gold: { DEFAULT: 'var(--gold-primary)', light: 'var(--gold-light)' }`

- [x] Task 4: Create dashboard data hooks (AC: #1, #3, #6, #13)
  - [x]4.1 Create `src/hooks/useDashboardMetrics.ts` with these hooks:
    - `useOperatorId()` — calls `supabase.auth.getSession()`, returns `operatorId: string | null`. Caches in state to avoid re-fetching
    - `useSlaMetric(operatorId, startDate, endDate)` — `supabase.rpc('calculate_sla', { p_operator_id, p_start_date, p_end_date })`. queryKey: `['dashboard', operatorId, 'sla', startDate, endDate]`. **enabled: !!operatorId**
    - `useFadrMetric(operatorId, startDate, endDate)` — same pattern, queryKey with `'fadr'`. **enabled: !!operatorId**
    - `usePerformanceMetricsSummary(operatorId, startDate, endDate)` — queries `performance_metrics` table: `.select('total_orders, delivered_orders, failed_deliveries').eq('operator_id', operatorId).gte('metric_date', startDate).lte('metric_date', endDate).is('retailer_name', null)` then sums across rows. Returns `{ totalOrders: number; deliveredOrders: number; failedDeliveries: number } | null`. **enabled: !!operatorId**
    - `useSlaPreviousPeriod(operatorId, startDate, endDate)` — SLA for the 7-day window before the current range, for trend calculation. **enabled: !!operatorId**
    - All hooks: `staleTime: 30000`, `refetchInterval: 30000`
  - [x]4.2 Create `src/hooks/useDashboardDates.ts` — exports `getDashboardDates()`:
    ```typescript
    // Use UTC dates for consistency with PG cron (runs at 2AM UTC)
    // "today" in UTC = the latest date the cron could have populated
    const today = new Date();
    const endDate = today.toISOString().slice(0, 10); // UTC YYYY-MM-DD
    const startDate = subDays(today, 6).toISOString().slice(0, 10); // 7-day range
    const prevEndDate = subDays(today, 7).toISOString().slice(0, 10);
    const prevStartDate = subDays(today, 13).toISOString().slice(0, 10);
    ```
    Use `date-fns` `subDays` (already installed). Note: cron populates `metric_date = CURRENT_DATE - 1` at 2AM UTC. The 7-day range ensures data is always available even if today's row doesn't exist yet

- [x] Task 5: Build HeroSLA component (AC: #1-#9, #12)
  - [x]5.1 Create `src/components/dashboard/HeroSLA.tsx`:
    - Props: `operatorId: string`
    - Calls all hooks from Task 4 internally
    - Large percentage with dynamic Tailwind color class based on thresholds
    - Null SLA: render "N/A" in `text-slate-400`, no progress bar, context shows "Sin datos para este periodo"
    - Trend: `currentSla - previousSla` — hide entirely if previous is null
    - Context line: sum `deliveredOrders` + `totalOrders` from `usePerformanceMetricsSummary`
    - Progress bar: `bg-gradient-to-r from-gold to-gold-light` fill, text in `text-slate-800` (dark for contrast)
    - Inline metrics: FADR from `useFadrMetric`, failures from `usePerformanceMetricsSummary` (`failedDeliveries / totalOrders * 100`)
    - `role="button"` + `tabIndex={0}` + `aria-label` + `onClick`/`onKeyDown` (Enter/Space) opens drill-down
    - Hover: `hover:shadow-lg hover:scale-[1.01]` transition
    - Error state: show `<Alert>` with "Los datos pueden estar desactualizados" when any query `isError`
  - [x]5.2 Create `src/components/dashboard/HeroSLASkeleton.tsx` — skeleton loaders matching hero layout: large rect for percentage, bar for progress, small rects for inline metrics
  - [x]5.3 Create `src/components/dashboard/SLADrillDownDialog.tsx` — shadcn `Dialog` with `DialogContent`, `DialogHeader`, `DialogTitle`. Placeholder bullet list content. Receives `open`/`onOpenChange` props

- [x] Task 6: Create dashboard page with RBAC (AC: #11)
  - [x]6.1 Create `src/app/app/dashboard/page.tsx`:
    - Read role from `session?.user?.app_metadata?.claims?.role`
    - If role not in `['operations_manager', 'admin']` → redirect to `/app` using `router.push('/app')`
    - Show loading skeleton while session resolves
    - Render `<HeroSLA operatorId={operatorId} />` once authenticated
  - [x]6.2 Modify `AppLayout` sidebar navigation:
    - Add `BarChart3` to lucide-react import (not currently imported)
    - Add nav item at position 0 (first item): `{ name: 'Dashboard', href: '/app/dashboard', icon: BarChart3 }`
    - Conditionally render: only show when user role is `operations_manager` or `admin`

- [x] Task 7: Tests (AC: all)
  - [x]7.1 `src/components/dashboard/HeroSLA.test.tsx`:
    - Mock `@/lib/supabase/client` with `vi.mock()` (pattern from ManualOrderForm.test.tsx)
    - Wrap renders in `QueryClientProvider` (use fresh `QueryClient` per test)
    - Test: renders SLA percentage with correct color class for each threshold (green/yellow/red)
    - Test: renders "N/A" when SLA is null
    - Test: shows trend arrow up/down with correct delta
    - Test: hides trend when previous period is null
    - Test: shows skeleton when loading
    - Test: shows error alert when query fails
    - Test: opens dialog on click and keyboard (Enter)
    - Test: renders FADR and failure count in inline metrics
  - [x]7.2 `src/hooks/useDashboardMetrics.test.ts`:
    - Use `renderHook` from `@testing-library/react` + `QueryClientProvider` wrapper
    - Mock `createSPAClient` to return mock Supabase client
    - Verify RPC called with correct function name and params
    - Verify `enabled: false` when operatorId is null
    - Verify query keys match expected structure

## Dev Notes

### CRITICAL: QueryClientProvider Gap

There is **NO** `QueryClientProvider` in the entire app. Despite `@tanstack/react-query` v5.90.21 being installed and hooks (`useUsers`, `useAuditLogs`, `useCreateManualOrder`) using it, no provider wraps the tree. The existing hooks work only because their consuming pages haven't been tested end-to-end — they would crash at runtime without a provider. Task 1 adds it to the `/app` layout (not root layout — only authenticated pages need it).

### Date Range Strategy: 7-Day Window in UTC

The nightly cron (`calculate_daily_metrics`) runs at 2AM UTC, which is 22:00-23:00 Chile local time. It populates `metric_date = CURRENT_DATE - 1` (yesterday in UTC). A single-day "today" query would return empty for the entire business day. Therefore:

- **Current period:** Last 7 days (today minus 6 days through today in UTC)
- **Trend comparison:** Previous 7 days (today minus 13 through today minus 7)
- **Date format:** Always UTC `YYYY-MM-DD` strings from `new Date().toISOString().slice(0, 10)` — matches PostgreSQL `CURRENT_DATE` context
- **Graceful degradation:** If today's row doesn't exist yet, the 7-day sum still includes 6 populated days — never empty during normal operation

### Operator ID Access Pattern

Get from JWT claims — `enabled: !!operatorId` on ALL queries to prevent firing before session loads:
```tsx
const supabase = createSPAClient();
const { data: { session } } = await supabase.auth.getSession();
const operatorId = session?.user?.app_metadata?.claims?.operator_id;
const role = session?.user?.app_metadata?.claims?.role;
```
See: `ManualOrderForm.tsx:54`, `route.ts:179` (users API)

### RBAC: Allowed Roles for Dashboard

Only `operations_manager` and `admin` can access `/app/dashboard`. Read role from `session?.user?.app_metadata?.claims?.role`. Redirect others to `/app`. Also conditionally render the nav item in AppLayout sidebar — hide for `pickup_crew`, `warehouse_staff`, `loading_crew`.

### RPC Function Signatures (from Story 3.1)

```typescript
// Already in src/lib/types.ts — DO NOT recreate
calculate_sla: { Args: { p_operator_id: string; p_start_date: string; p_end_date: string }; Returns: number | null }
calculate_fadr: { Args: { p_operator_id: string; p_start_date: string; p_end_date: string }; Returns: number | null }
get_failure_reasons: { Args: { p_operator_id: string; p_start_date: string; p_end_date: string }; Returns: { reason: string; count: number; percentage: number }[] }
```

Functions query `performance_metrics` table (pre-aggregated). RLS filters by `operator_id`. Functions are `SECURITY INVOKER`.

**WARNING:** `calculate_daily_metrics` also exists in types.ts — it is a cron-only SECURITY DEFINER function. NEVER call it from frontend code.

### Performance Metrics Table — Aggregate Row

The `retailer_name IS NULL` row is the all-retailer aggregate for a given `(operator_id, metric_date)`. Sum `total_orders`, `delivered_orders`, `failed_deliveries` across the 7-day range of aggregate rows.

Return type for `usePerformanceMetricsSummary`:
```typescript
type MetricsSummary = {
  totalOrders: number;
  deliveredOrders: number;
  failedDeliveries: number;
} | null;
// Query: Database['public']['Tables']['performance_metrics']['Row']
// Fields: total_orders, delivered_orders, failed_deliveries
```

### Tractis Gold — Add to CSS Variables + Tailwind

Gold colors are NOT in the current Tailwind config or `globals.css`. Must add:
```css
/* globals.css :root */
--gold-primary: #e6c15c;
--gold-light: #fef3c7;
```
```typescript
// tailwind.config.ts extend colors
gold: { DEFAULT: 'var(--gold-primary)', light: 'var(--gold-light)' }
```
Then use: `bg-gradient-to-r from-gold to-gold-light` for progress bar fill.

### Progress Bar Accessibility

Use `text-slate-800` (dark text) inside the progress bar fill — NOT white text. White on light gold (`#fef3c7`) fails WCAG 4.5:1 contrast. The mockup uses white but the mockup is a static reference, not a11y-validated.

### Supabase Client

Use `createSPAClient()` from `@/lib/supabase/client`. This is the browser client used by all existing hooks.

### Charts Library

Project uses **recharts** (v2.15.0), NOT Chart.js. Epics mention Chart.js but `package.json` has recharts. Not needed for this story (no charts in hero), but use recharts for Story 3.3+ sparklines.

### Existing shadcn Components

Available: `card`, `button`, `input`, `textarea`, `dialog`, `alert`, `alert-dialog`. **Add only:** `skeleton`. Dialog already exists — do NOT re-add it.

### AppLayout Sidebar — Modification Details

Current nav array in AppLayout has 4 items and imports: `Home, User, Menu, X, ChevronDown, LogOut, Key, Files, LucideListTodo` from lucide-react. Must add `BarChart3` to the import. Insert Dashboard as first nav item. Conditionally render based on role — the component needs access to the user's role (from GlobalContext or session).

### Design Tokens (from UX Spec + Mockup)

```
Hero Section Styling:
  - White card, rounded-xl (12px), p-12 (48px), shadow-sm
  - Hover: hover:shadow-lg hover:scale-[1.01] transition-all duration-300
  - Title: text-xl font-semibold text-slate-700 uppercase tracking-wide
  - Percentage: text-[4rem] font-bold leading-none
  - Trend: text-xl font-medium
  - Context: text-2xl text-slate-600
  - Progress bar: h-8 rounded-2xl max-w-[800px] mx-auto
  - Inline metrics: flex justify-center gap-12 text-lg text-slate-700
```

### Spanish UI Text

All user-facing text in Chilean Spanish:
- "CUMPLIMIENTO SLA - ULTIMOS 7 DIAS"
- "↑ +X.X% vs semana anterior" / "↓ -X.X% vs semana anterior"
- "{N} de {M} entregas cumplidas"
- "Sin datos para este periodo" (empty state)
- "Los datos pueden estar desactualizados" (error state)
- "Primera Entrega (FADR): X.X%"
- "Fallos: N (X.X%)"
- Drill-down placeholder: "Desglose horario", "Rendimiento por comuna/zona", "Rendimiento por conductor"

### Date Filter Buttons (NOT in scope)

The mockup shows date selector buttons ("Hoy", "7 dias", "30 dias", etc.) in the top nav. These are NOT part of Story 3.2. The hero always shows last 7 days. Date filtering will be added in a future story.

### Project Structure

```
src/
  components/
    dashboard/              # NEW directory
      HeroSLA.tsx
      HeroSLASkeleton.tsx
      SLADrillDownDialog.tsx
      HeroSLA.test.tsx
    Providers.tsx            # NEW - QueryClientProvider wrapper
  hooks/
    useDashboardMetrics.ts   # NEW - all dashboard data hooks
    useDashboardDates.ts     # NEW - date range utility
    useDashboardMetrics.test.ts  # NEW
  app/
    app/
      dashboard/
        page.tsx             # NEW dashboard route with RBAC guard
      layout.tsx             # MODIFIED - wrap with Providers
    globals.css              # MODIFIED - add gold CSS vars
  tailwind.config.ts         # MODIFIED - add gold colors
```

### Story 3.1 Learnings

- SECURITY INVOKER for user-facing functions; SECURITY DEFINER only for cron
- Code review caught: missing REVOKE on DEFINER function, incomplete metric columns, fragile casts
- Tests use Vitest (377 currently passing) — follow existing patterns in `ManualOrderForm.test.tsx`

### Git Patterns

- Branch: `feat/story-3.2-hero-sla-section`
- Commit: `feat(story-3.2): build hero SLA section with real-time calculation`
- Tests use Vitest + `@testing-library/react`

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 3, Story 3.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — State Management, Caching Strategy]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Design System, Tractis Theme]
- [Source: _bmad-output/planning-artifacts/mockups/business-owner-dashboard-desktop.html — Hero Section CSS/HTML]
- [Source: _bmad-output/implementation-artifacts/3-1-create-performance-metrics-tables-and-calculation-logic.md — DB schema, functions, review fixes]
- [Source: apps/frontend/src/hooks/useOrders.ts — Hook pattern]
- [Source: apps/frontend/src/hooks/useUsers.ts — Query hook pattern with staleTime]
- [Source: apps/frontend/src/components/orders/ManualOrderForm.tsx:54 — operator_id access]
- [Source: apps/frontend/src/components/orders/ManualOrderForm.test.tsx — Test pattern with vi.mock]
- [Source: apps/frontend/src/app/app/layout.tsx — Current layout without QueryClientProvider]
- [Source: apps/frontend/package.json — @tanstack/react-query v5.90.21, recharts v2.15.0, date-fns v4.1.0]

## Senior Developer Review (AI)

**Review Date:** 2026-03-02
**Review Outcome:** Approve (after fixes)

### Action Items
- [x] [HIGH] H1: Move `createSPAClient()` inside `queryFn` to avoid per-render instantiation
- [x] [HIGH] H2: Fix inverted responsive breakpoints (`p-12 md:p-6` → `p-6 md:p-12`)
- [x] [HIGH] H3: Remove duplicate `useOperatorId` from AppLayout — inline session fetch instead
- [x] [MED] M1: Add `DialogDescription` to SLADrillDownDialog for a11y
- [x] [MED] M2: Memoize `getDashboardDates()` with `useMemo`
- [x] [MED] M3: Add test for context line rendering with data
- [ ] [LOW] L1: (Duplicate of M1 — resolved)
- [ ] [LOW] L2: Progress bar text clipping at very low SLA values (deferred)

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Initial test run had 3 failures due to duplicate `getByText` matches (SLA % appears in both hero display and progress bar). Fixed by using `getAllByText` + filtering by CSS class.

### Completion Notes List
- Task 1: Created `Providers.tsx` with `QueryClientProvider` (staleTime 30s, gcTime 5m, refetchOnWindowFocus false). Wrapped in app layout inside GlobalProvider.
- Task 2: Added shadcn skeleton component via CLI.
- Task 3: Added `--gold-primary` and `--gold-light` CSS vars to globals.css, extended tailwind.config.ts with `gold` color.
- Task 4: Created `useDashboardMetrics.ts` with 5 hooks (useOperatorId, useSlaMetric, useFadrMetric, usePerformanceMetricsSummary, useSlaPreviousPeriod). Created `useDashboardDates.ts` with UTC date range utility.
- Task 5: Built HeroSLA component with color-coded thresholds, trend indicator, progress bar with gold gradient, inline sub-metrics (FADR + failures), keyboard-accessible drill-down dialog, skeleton loading state, and error alert.
- Task 6: Created dashboard page at `/app/dashboard` with RBAC guard (operations_manager, admin only). Added BarChart3 nav item to AppLayout sidebar, conditionally rendered by role.
- Task 7: 21 tests across 2 files — 12 HeroSLA component tests (color thresholds, null state, trend, skeleton, error, dialog click/keyboard, inline metrics) + 9 hook tests (RPC params, enabled gating, row summation).

### Change Log
- 2026-03-02: Implemented Story 3.2 — Hero SLA section with real-time calculation, RBAC dashboard page, QueryClientProvider setup. 398 tests passing.
- 2026-03-02: Code review — 6 issues fixed (3H, 3M): inverted responsive breakpoints, duplicate Supabase client instantiation, duplicate useOperatorId calls, missing DialogDescription, unmemoized date calc, missing context line test. 399 tests passing.

### File List
- src/components/Providers.tsx (NEW)
- src/components/dashboard/HeroSLA.tsx (NEW)
- src/components/dashboard/HeroSLASkeleton.tsx (NEW)
- src/components/dashboard/SLADrillDownDialog.tsx (NEW)
- src/components/dashboard/HeroSLA.test.tsx (NEW)
- src/hooks/useDashboardMetrics.ts (NEW)
- src/hooks/useDashboardDates.ts (NEW)
- src/hooks/useDashboardMetrics.test.ts (NEW)
- src/app/app/dashboard/page.tsx (NEW)
- src/components/ui/skeleton.tsx (NEW — shadcn)
- src/app/app/layout.tsx (MODIFIED — added Providers wrapper)
- src/app/globals.css (MODIFIED — added gold CSS vars)
- tailwind.config.ts (MODIFIED — added gold color)
- src/components/AppLayout.tsx (MODIFIED — added Dashboard nav item with RBAC)
