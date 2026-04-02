# Dashboard Restructure + Route Tracking — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure dashboard into Operaciones (pipeline) + Analítica (business intelligence). Add live route tracking with DispatchTrack API polling every 15 min.

**Architecture:** Three phases executed in order: (1) navigation restructure, (2) OTIF improvements, (3) live route tracking. Each phase is a separate PR.

**Tech Stack:** Next.js 15, TanStack Query, Supabase Edge Functions, DispatchTrack REST API, Vitest + RTL

**DispatchTrack API reference:** https://apidocs-lastmile.dispatchtrack.com/

---

## Phase 1: Navigation Restructure

> Move furniture. Zero new features. Every existing component finds its new home.

### Current structure
```
Dashboard
  ├── Vista General (HeroSLA + failure motives)
  ├── Última Milla (DeliveryTab: OTIF hero, outcome cards, OTIF by retailer, late deliveries, orders table)
  └── Carga de Datos (LoadingTab)
```

### Target structure
```
Operaciones
  ├── Carga (existing LoadingTab)
  ├── Retiro (placeholder — already exists)
  ├── Recepción (placeholder — already exists)
  ├── Distribución (placeholder — already exists)
  ├── Despacho (placeholder — already exists)
  └── Última Milla (outcome cards + orders detail table — operational focus)

Analítica
  ├── OTIF (HeroSLA + OTIF by retailer + late deliveries + failure reasons)
  ├── Unit Economics (placeholder)
  └── CX (placeholder)
```

Vista General removed. Content split between Operaciones > Última Milla and Analítica > OTIF.

### Task 1.1: Create Analítica section with OTIF tab

**Files:**
- Create: `apps/frontend/src/components/analytics/OtifTab.tsx`
- Create: `apps/frontend/src/components/analytics/OtifTab.test.tsx`
- Read: `apps/frontend/src/components/dashboard/DeliveryTab.tsx` (source of components to move)
- Read: `apps/frontend/src/components/dashboard/HeroSLA.tsx` (moves here)

**Step 1: Write failing test**
```typescript
// OtifTab.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OtifTab from './OtifTab';

// Mock child components — we're testing composition, not children
vi.mock('@/components/dashboard/HeroSLA', () => ({ default: () => <div data-testid="hero-sla" /> }));
vi.mock('@/components/dashboard/DateFilterBar', () => ({
  default: (props: any) => <div data-testid="date-filter" />,
  __esModule: true,
}));
vi.mock('@/components/dashboard/OtifByRetailerTable', () => ({ default: () => <div data-testid="otif-retailer" /> }));
vi.mock('@/components/dashboard/LateDeliveriesTable', () => ({ default: () => <div data-testid="late-deliveries" /> }));

function renderWithProvider(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('OtifTab', () => {
  it('renders HeroSLA with date filter', () => {
    renderWithProvider(<OtifTab operatorId="op-1" />);
    expect(screen.getByTestId('hero-sla')).toBeInTheDocument();
    expect(screen.getByTestId('date-filter')).toBeInTheDocument();
  });

  it('renders OTIF by retailer and late deliveries tables', () => {
    renderWithProvider(<OtifTab operatorId="op-1" />);
    expect(screen.getByTestId('otif-retailer')).toBeInTheDocument();
    expect(screen.getByTestId('late-deliveries')).toBeInTheDocument();
  });
});
```

**Step 2: Run test — verify it fails**
```bash
cd apps/frontend && npx vitest run src/components/analytics/OtifTab.test.tsx
```
Expected: FAIL — module not found

**Step 3: Implement OtifTab**
```typescript
// OtifTab.tsx
'use client';

import { useState } from 'react';
import DateFilterBar, { type DatePreset } from '@/components/dashboard/DateFilterBar';
import { useDatePreset } from '@/hooks/useDatePreset';
import HeroSLA from '@/components/dashboard/HeroSLA';
import OtifByRetailerTable from '@/components/dashboard/OtifByRetailerTable';
import LateDeliveriesTable from '@/components/dashboard/LateDeliveriesTable';

interface OtifTabProps {
  operatorId: string;
}

export default function OtifTab({ operatorId }: OtifTabProps) {
  const [preset, setPreset] = useState<DatePreset>('last_7_days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const { startDate, endDate } = useDatePreset(preset, customStart, customEnd);

  return (
    <div className="space-y-6" data-testid="otif-tab">
      <DateFilterBar
        preset={preset}
        customStart={customStart}
        customEnd={customEnd}
        onPresetChange={setPreset}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
      />
      <HeroSLA operatorId={operatorId} startDate={startDate} endDate={endDate} />
      <OtifByRetailerTable operatorId={operatorId} startDate={startDate} endDate={endDate} />
      <LateDeliveriesTable operatorId={operatorId} startDate={startDate} endDate={endDate} />
    </div>
  );
}
```

**Step 4: Run test — verify it passes**
```bash
cd apps/frontend && npx vitest run src/components/analytics/OtifTab.test.tsx
```

**Step 5: Commit**
```bash
git add apps/frontend/src/components/analytics/
git commit -m "feat: add OtifTab component for Analítica section"
```

### Task 1.2: Update HeroSLA to accept date props

**Files:**
- Modify: `apps/frontend/src/components/dashboard/HeroSLA.tsx`
- Modify: `apps/frontend/src/components/dashboard/HeroSLA.test.tsx`

**Step 1: Write failing test**

Add test to existing HeroSLA.test.tsx:
```typescript
it('uses provided startDate/endDate props instead of hardcoded dates', () => {
  mockOtifQuery.data = makeOtif(95, 100);
  renderWithProvider(<HeroSLA operatorId="op-123" startDate="2026-01-01" endDate="2026-01-07" />);
  expect(screen.getByText('95.0%')).toBeInTheDocument();
});
```

**Step 2: Run test — verify it fails** (HeroSLA doesn't accept startDate/endDate props yet)

**Step 3: Update HeroSLA interface**

Change the component to accept optional `startDate`/`endDate` props. When provided, use them instead of `getDashboardDates()`. When not provided, fall back to current behavior.

```typescript
interface HeroSLAProps {
  operatorId: string;
  startDate?: string;
  endDate?: string;
}

export default function HeroSLA({ operatorId, startDate: startDateProp, endDate: endDateProp }: HeroSLAProps) {
  const defaults = useMemo(() => getDashboardDates(), []);
  const startDate = startDateProp ?? defaults.startDate;
  const endDate = endDateProp ?? defaults.endDate;
  const prevStartDate = defaults.prevStartDate; // trend always uses default period
  const prevEndDate = defaults.prevEndDate;
  // ... rest unchanged
}
```

**Step 4: Run all HeroSLA tests — verify they pass**
```bash
cd apps/frontend && npx vitest run src/components/dashboard/HeroSLA.test.tsx
```

**Step 5: Commit**
```bash
git add apps/frontend/src/components/dashboard/HeroSLA.tsx apps/frontend/src/components/dashboard/HeroSLA.test.tsx
git commit -m "feat: HeroSLA accepts optional startDate/endDate props"
```

### Task 1.3: Add Analítica navigation to dashboard

**Files:**
- Read: dashboard page/layout files to understand current tab navigation
- Modify: the tab navigation component to add Analítica section with OTIF/Unit Economics/CX tabs
- Create: placeholder components for Unit Economics and CX

**Note:** Read the actual dashboard page layout first. The tab structure may be in `apps/frontend/src/app/dashboard/page.tsx` or a layout file. Adapt this task to the actual file structure.

**Step 1: Write failing test**

Test that the Analítica section appears in navigation with OTIF, Unit Economics, CX tabs.

**Step 2: Implement**

Add Analítica as a top-level section in the dashboard navigation. Wire OtifTab to the OTIF subtab. Add placeholder content for Unit Economics and CX.

**Step 3: Run tests — verify all pass**

**Step 4: Commit**
```bash
git commit -m "feat: add Analítica section with OTIF, Unit Economics, CX tabs"
```

### Task 1.4: Move operational components to Última Milla tab

**Files:**
- Modify: the Última Milla tab content (currently DeliveryTab.tsx)
- Remove: OTIF hero card, OTIF by retailer, late deliveries from DeliveryTab (they moved to OtifTab)
- Keep: outcome strip (delivered/failed/en ruta/pendientes), orders detail table, date filter

**Step 1: Write failing test**

Test that DeliveryTab no longer renders OtifHeroCard but still renders outcome strip and orders table.

**Step 2: Update DeliveryTab** — remove OtifHeroCard, OtifByRetailerTable, LateDeliveriesTable. Keep OutcomeCards + OrdersDetailTable + DateFilterBar.

**Step 3: Run all tests**
```bash
cd apps/frontend && npx vitest run
```

**Step 4: Commit**
```bash
git commit -m "refactor: slim DeliveryTab to operational focus (outcomes + orders)"
```

### Task 1.5: Remove Vista General tab

**Files:**
- Remove or archive Vista General tab component
- Update navigation to no longer show Vista General
- Update any tests referencing Vista General

**Step 1: Write failing test** — test that Vista General no longer appears in navigation

**Step 2: Remove the tab and component references

**Step 3: Run all tests**

**Step 4: Commit**
```bash
git commit -m "refactor: remove Vista General tab (content moved to Analítica > OTIF)"
```

### Task 1.6: Push Phase 1 PR

```bash
git push origin feat/dashboard-restructure
gh pr create --title "feat: restructure dashboard into Operaciones + Analítica" --body "$(cat <<'EOF'
## Summary
- Adds Analítica section with OTIF tab (HeroSLA + date filters + retailer breakdown + late deliveries)
- Slims Última Milla to operational focus (outcomes + orders detail)
- Removes Vista General (content absorbed into Analítica > OTIF)
- Adds Unit Economics and CX placeholder tabs

## What moves where
- HeroSLA → Analítica > OTIF (now with date filter)
- OTIF by retailer → Analítica > OTIF
- Late deliveries → Analítica > OTIF
- Outcome cards → stays in Operaciones > Última Milla
- Orders detail → stays in Operaciones > Última Milla

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```

---

## Phase 2: OTIF Frontend Improvements

> Merge Vista General's polish with Última Milla's depth. Better visual hierarchy.

### Task 2.1: Improve OTIF tab visual hierarchy

**Files:**
- Modify: `apps/frontend/src/components/analytics/OtifTab.tsx`
- Modify: `apps/frontend/src/components/analytics/OtifTab.test.tsx`

**Step 1:** Read existing HeroSLA and failure reasons components from Vista General. Identify visual elements worth keeping (cards, layout, colors).

**Step 2: Write failing tests** for the improved layout — e.g. failure reasons section renders inside OtifTab.

**Step 3: Implement** — add failure reasons chart/section below the existing components. Ensure all sub-components respect the shared date filter.

**Step 4: Run tests, commit**

### Task 2.2: Ensure all OTIF components use shared date filter

**Files:**
- Verify: HeroSLA, OtifByRetailerTable, LateDeliveriesTable, failure reasons all accept startDate/endDate
- Modify any that still use hardcoded dates

**Step 1: Write failing tests** for each component receiving date props

**Step 2: Update components** to accept and use date filter props

**Step 3: Run all tests, commit**

### Task 2.3: Push Phase 2 PR

---

## Phase 3: Live Route Tracking

> DispatchTrack API polling → updated ETAs in DB → route progress UI in Operaciones > Última Milla

### Task 3.1: Create route polling Edge Function

**Files:**
- Create: `apps/frontend/supabase/functions/dispatchtrack-route-poll/index.ts`

**Data flow:**
```
Every 15 min (cron/n8n trigger)
  → Edge Function calls GET /api/external/v1/routes/:route_id for each active route
  → Updates dispatches.estimated_at in DB
  → Updates route.status if changed
```

**Step 1:** Query DB for today's active routes (`status = 'in_progress'`, `route_date = today`)

**Step 2:** For each route, call `GET https://transportesmusan.dispatchtrack.com/api/external/v1/routes/:route_id` with `X-AUTH-TOKEN` header

**Step 3:** For each dispatch in response, upsert:
- `estimated_at` (updated ETA)
- `status` (current status)
- `position` (stop sequence)
- `arrived_at` (if newly arrived)
- `completed_at` (if newly completed — use `arrived_at` as fallback)

**Step 4:** Commit
```bash
git commit -m "feat: add dispatchtrack-route-poll Edge Function for ETA updates"
```

### Task 3.2: Create Supabase RPC for active routes with dispatches

**Files:**
- Create: migration `get_active_routes_with_dispatches.sql`

**Step 1: Write the RPC**
```sql
CREATE OR REPLACE FUNCTION get_active_routes_with_dispatches(
  p_operator_id UUID,
  p_route_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB AS $$
  SELECT jsonb_agg(route_data)
  FROM (
    SELECT jsonb_build_object(
      'id', r.id,
      'external_route_id', r.external_route_id,
      'driver_name', r.driver_name,
      'vehicle_id', r.vehicle_id,
      'status', r.status,
      'start_time', r.start_time,
      'total_stops', (SELECT COUNT(*) FROM dispatches d WHERE d.route_id = r.id AND d.deleted_at IS NULL),
      'completed_stops', (SELECT COUNT(*) FROM dispatches d WHERE d.route_id = r.id AND d.status IN ('delivered', 'failed', 'partial') AND d.deleted_at IS NULL),
      'dispatches', (
        SELECT jsonb_agg(jsonb_build_object(
          'id', d.id,
          'external_dispatch_id', d.external_dispatch_id,
          'order_id', d.order_id,
          'status', d.status,
          'planned_sequence', d.planned_sequence,
          'estimated_at', d.estimated_at,
          'arrived_at', d.arrived_at,
          'completed_at', d.completed_at,
          'latitude', d.latitude,
          'longitude', d.longitude,
          'failure_reason', d.failure_reason
        ) ORDER BY d.planned_sequence)
        FROM dispatches d
        WHERE d.route_id = r.id AND d.deleted_at IS NULL
      )
    ) AS route_data
    FROM routes r
    WHERE r.operator_id = p_operator_id
      AND r.route_date = p_route_date
      AND r.deleted_at IS NULL
    ORDER BY r.start_time
  ) sub;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```

**Step 2: Commit**

### Task 3.3: Create useActiveRoutes hook

**Files:**
- Create: `apps/frontend/src/hooks/useActiveRoutes.ts`
- Create: `apps/frontend/src/hooks/useActiveRoutes.test.ts`

**Step 1: Write failing test**
```typescript
describe('useActiveRoutes', () => {
  it('returns active routes for today', async () => {
    // Mock supabase.rpc('get_active_routes_with_dispatches')
    // Verify it returns { data, isLoading, isError }
  });
});
```

**Step 2: Implement hook** using TanStack Query with `staleTime: 60_000` (1 min — data refreshes every 15 min from API, no need to refetch more often).

**Step 3: Run tests, commit**

### Task 3.4: Create RouteProgressCard component

**Files:**
- Create: `apps/frontend/src/components/dashboard/RouteProgressCard.tsx`
- Create: `apps/frontend/src/components/dashboard/RouteProgressCard.test.tsx`

**Displays per route:**
- Driver name + vehicle
- Progress bar: X of Y stops completed
- Next stop: address + ETA
- Status badges (on track / delayed / completed)
- Click to expand: full stop list with statuses

**Step 1: Write failing tests** — renders driver name, progress, next stop ETA

**Step 2: Implement component** (keep under 300 lines — extract sub-components if needed)

**Step 3: Run tests, commit**

### Task 3.5: Create ActiveRoutesSection component

**Files:**
- Create: `apps/frontend/src/components/dashboard/ActiveRoutesSection.tsx`
- Create: `apps/frontend/src/components/dashboard/ActiveRoutesSection.test.tsx`

**Composes:** `useActiveRoutes` hook + `RouteProgressCard` list + empty state + loading skeleton

**Step 1: Write failing tests**

**Step 2: Implement**

**Step 3: Run tests, commit**

### Task 3.6: Wire ActiveRoutesSection into Última Milla tab

**Files:**
- Modify: `apps/frontend/src/components/dashboard/DeliveryTab.tsx`

Add `<ActiveRoutesSection>` at the top of the Última Milla tab, above outcome cards.

**Step 1: Write failing test** — ActiveRoutesSection renders inside DeliveryTab

**Step 2: Implement**

**Step 3: Run all tests, commit**

### Task 3.7: Set up 15-minute polling trigger

**Options (choose based on current infra):**
- **n8n Schedule Trigger** → calls the Edge Function every 15 min
- **Supabase pg_cron** → calls the RPC directly
- **n8n HTTP Request node** → simplest if n8n is already handling scheduled tasks

**Step 1:** Implement the trigger

**Step 2:** Test with a manual invocation first

**Step 3: Commit**

### Task 3.8: Push Phase 3 PR

```bash
git push origin feat/live-route-tracking
gh pr create --title "feat: live route tracking with DispatchTrack API polling" --body "$(cat <<'EOF'
## Summary
- Polls DispatchTrack API every 15 min for active route ETAs
- New RPC: get_active_routes_with_dispatches
- Route progress cards in Operaciones > Última Milla
- Shows: driver, progress (X/Y stops), next stop ETA, status

## API budget
- ~20 routes × 32 polls/day = 640 req/day (64% of 1,000 limit)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```

---

## Update docs/sprint-status.yaml

After each phase merges, add the corresponding story entries to sprint-status.yaml.
