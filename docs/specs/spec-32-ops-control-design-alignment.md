# Spec 32 — Ops Control Design Alignment

**Status:** completed

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild all spec-29 Mission Deck UI components to match the app's existing design system — Tailwind utility classes, shadcn/ui components, PageShell layout, responsive breakpoints, and mode-aware semantic tokens.

**Architecture:** The spec-29 data layer (hooks, health heuristics, SLA classifier, labels) is solid and stays untouched. Only the presentation layer changes. Every component is rewritten from inline `style={{}}` objects to Tailwind classes + shadcn/ui primitives. The page wraps in `PageShell` like every other route. Dead `--md-*` CSS tokens are removed.

**Tech Stack:** Next.js App Router, Tailwind CSS, shadcn/ui (Card, Button, Badge, Skeleton), existing design tokens (`bg-surface`, `text-text`, `border-border`, etc.), Vitest + RTL.

---

## Scope

**What changes (UI only — 14 component files + page + CSS cleanup):**

| File | Action | Reason |
|------|--------|--------|
| `page.tsx` | Rewrite | Restore `PageShell` wrapper, add `useIsMobile()` gate |
| `MissionDeck.tsx` | Rewrite | Remove inline styles, use Tailwind layout |
| `TopBar.tsx` | Delete | Replaced by PageShell breadcrumbs + actions slot |
| `TelemetryStrip.tsx` | Rewrite | Tailwind flex, `rounded-md`, `border`, responsive |
| `StageCell.tsx` | Rewrite | Follow PipelineCard pattern (Tailwind classes) |
| `AtRiskBar.tsx` | Rewrite | Follow UrgentOrdersBanner pattern (soft bg + border) |
| `AtRiskList.tsx` | Rewrite | Tailwind table classes, app's pagination pattern |
| `DrillDownPanel.tsx` | Rewrite | shadcn Card + CardHeader/Content/Footer |
| `PickupPanel.tsx` | Rewrite | Tailwind table, remove CSSProperties constants |
| `ReceptionPanel.tsx` | Rewrite | Same as PickupPanel |
| `ConsolidationPanel.tsx` | Rewrite | Same as PickupPanel |
| `DocksPanel.tsx` | Rewrite | Same as PickupPanel |
| `DeliveryPanel.tsx` | Rewrite | Same as PickupPanel |
| `ReturnsPanel.tsx` | Rewrite | Same as PickupPanel |
| `ReversePlaceholderPanel.tsx` | Rewrite | Tailwind, remove inline styles |
| `globals.css` | Edit | Remove `--md-*` palette block (lines ~175-188) |

**What stays untouched (data layer):**

- `lib/health.ts` + `lib/health.test.ts` — pure logic, no UI
- `lib/sla.ts` + `lib/sla.test.ts` — pure logic, no UI
- `lib/labels.es.ts` + `lib/labels.es.test.ts` — string constants
- `lib/useStageQuery.ts` + test — URL state hook
- `hooks/ops-control/useOpsControlSnapshot.ts` — data fetching
- `hooks/ops-control/useStageBreakdown.ts` — derived selector
- `hooks/ops-control/useAtRiskOrders.ts` — filtering/pagination

**Existing components to reuse (from `@/components/operations-control/`):**

- `RealtimeStatusIndicator` — already follows design system, use in PageShell actions
- `UrgentOrdersBanner` — reference pattern for AtRiskBar
- `PipelineCard` — reference pattern for StageCell
- Mobile components (`MobileOCC`, etc.) — wire back into page via `useIsMobile()`

---

## Design Rules (derived from app audit)

These are the patterns every other page follows. The Mission Deck must match.

### Layout
- Wrap in `<PageShell title="..." breadcrumbs={...} actions={...}>`
- PageShell provides: `p-4 lg:p-6` padding, breadcrumbs, `text-xl font-bold` title, `<Separator>`
- Content inside PageShell uses `space-y-4` or `space-y-6` vertical rhythm

### Cards/Panels
- Use shadcn `<Card>` with `<CardHeader>`, `<CardContent>`, `<CardFooter>`
- Card defaults: `rounded-lg border bg-card shadow-sm`
- Override with semantic tokens: `bg-surface border-border`

### Tables
- Header: `text-xs text-text-muted uppercase tracking-wide font-medium`
- Header cells: `px-3 py-2` (or `px-4 py-2`)
- Body cells: `px-3 py-2 text-sm`
- Row border: `border-b border-border`
- Row hover: `hover:bg-surface-raised`
- Monospace data: `font-mono tabular-nums`

### Buttons
- Use shadcn `<Button>` with variants: `default`, `outline`, `ghost`
- Pagination: `<Button variant="outline" size="sm">`
- Disabled: handled by the component automatically

### Spacing (Tailwind scale only)
- `p-3` (12px), `p-4` (16px), `p-6` (24px)
- `gap-2` (8px), `gap-3` (12px), `gap-4` (16px)
- `space-y-4`, `space-y-6`
- Responsive: `p-4 sm:p-6`, `gap-3 sm:gap-4`

### Typography (Tailwind scale only)
- `text-xs` (0.75rem), `text-sm` (0.875rem), `text-base` (1rem), `text-lg` (1.125rem), `text-xl` (1.25rem)
- Display font (`font-display`): page titles only
- Sans (`font-sans`): all UI labels, descriptions
- Mono (`font-mono`): numbers, order IDs, timestamps

### Colors (Tailwind semantic classes only — never inline CSS vars)
- Text: `text-text`, `text-text-secondary`, `text-text-muted`
- Backgrounds: `bg-background`, `bg-surface`, `bg-surface-raised`
- Borders: `border-border`, `border-border-subtle`
- Status: `text-status-error`, `bg-status-error-bg`, `border-status-error-border` (same for warning, success, info)
- Accent: `text-accent`, `bg-accent`, `bg-accent/5`

### Border Radius
- `rounded-md` for small elements (pills, buttons, cells)
- `rounded-lg` for cards/panels
- Never raw pixel values

### Status Indicators
- Use `*-bg` + `*-border` + text color (soft style), not solid backgrounds
- Example: `bg-status-error-bg border border-status-error-border text-status-error`

---

## File Structure

```
apps/frontend/src/app/app/operations-control/
  page.tsx                          — PageShell + useIsMobile gate (REWRITE)
  components/
    OpsControlDesktop.tsx           — NEW: desktop layout (replaces MissionDeck.tsx)
    MissionDeck.tsx                 — DELETE after OpsControlDesktop works
    TopBar.tsx                      — DELETE (replaced by PageShell)
    TopBar.test.tsx                 — DELETE
    StageStrip.tsx                  — NEW: replaces TelemetryStrip + StageCell
    TelemetryStrip.tsx              — DELETE after StageStrip works
    StageCell.tsx                   — DELETE after StageStrip works
    AtRiskBanner.tsx                — NEW: replaces AtRiskBar (follows UrgentOrdersBanner pattern)
    AtRiskBar.tsx                   — DELETE after AtRiskBanner works
    AtRiskTable.tsx                 — NEW: replaces AtRiskList (Tailwind table)
    AtRiskList.tsx                  — DELETE after AtRiskTable works
    StagePanel.tsx                  — NEW: replaces DrillDownPanel (shadcn Card)
    DrillDownPanel.tsx              — DELETE after StagePanel works
    stage-panels/
      PickupPanel.tsx               — REWRITE (Tailwind table, use StagePanel)
      ReceptionPanel.tsx            — REWRITE
      ConsolidationPanel.tsx        — REWRITE
      DocksPanel.tsx                — REWRITE
      DeliveryPanel.tsx             — REWRITE
      ReturnsPanel.tsx              — REWRITE
      ReversePlaceholderPanel.tsx   — REWRITE
  lib/
    (all untouched)
```

---

## Implementation Plan

**Parallelization:** Tasks 2, 3, 4, and 5 are independent new component creations with zero cross-dependencies. They can (and should) run as 4 parallel subagents via `superpowers:dispatching-parallel-agents`. Task 1 must complete first (provides the scaffold). Task 6 depends on Task 5 (needs StagePanel). Tasks 7 and 8 are sequential cleanup.

### Task 1: Page shell + desktop layout scaffold

**Files:**
- Rewrite: `apps/frontend/src/app/app/operations-control/page.tsx`
- Create: `apps/frontend/src/app/app/operations-control/components/OpsControlDesktop.tsx`
- Modify: `apps/frontend/src/app/app/operations-control/page.test.tsx`

- [ ] **Step 1.1: Write page.tsx with PageShell + isMobile gate**

```tsx
// page.tsx
'use client';

import { Suspense } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useIsMobile } from '@/hooks/useIsMobile';
import { PageShell } from '@/components/PageShell';
import { RealtimeStatusIndicator } from '@/components/operations-control/RealtimeStatusIndicator';
import { useRealtimeStatus } from '@/hooks/useRealtimeStatus';
import { MobileOCC } from '@/components/operations-control/mobile/MobileOCC';
import { OpsControlDesktop } from './components/OpsControlDesktop';

export default function OpsControlPage() {
  const { operatorId } = useOperatorId();
  const realtimeStatus = useRealtimeStatus();
  const isMobile = useIsMobile();

  if (!operatorId) {
    return <div className="p-4 text-text-muted">Cargando...</div>;
  }

  if (isMobile) {
    return <MobileOCC operatorId={operatorId} />;
  }

  return (
    <PageShell
      title="Control de Operaciones"
      breadcrumbs={[
        { label: 'Operaciones', href: '/app/dashboard' },
        { label: 'Control de Operaciones' },
      ]}
      actions={<RealtimeStatusIndicator status={realtimeStatus} />}
    >
      {/* Suspense required: OpsControlDesktop uses useSearchParams via useStageQuery */}
      <Suspense fallback={null}>
        <OpsControlDesktop operatorId={operatorId} />
      </Suspense>
    </PageShell>
  );
}
```

- [ ] **Step 1.2: Write OpsControlDesktop scaffold**

```tsx
// components/OpsControlDesktop.tsx
'use client';

import { useState } from 'react';
import { useOpsControlSnapshot } from '@/hooks/ops-control/useOpsControlSnapshot';
import { useAtRiskOrders } from '@/hooks/ops-control/useAtRiskOrders';
import { useStageQuery } from '../lib/useStageQuery';
import { computeStageHealth } from '../lib/health';
import { STAGE_KEYS } from '../lib/labels.es';
import type { OpsSnapshot } from '@/hooks/ops-control/useOpsControlSnapshot';
import type { StageKey } from '../lib/labels.es';
import { Skeleton } from '@/components/ui/skeleton';

// Stage panels (imported individually)
import { PickupPanel } from './stage-panels/PickupPanel';
import { ReceptionPanel } from './stage-panels/ReceptionPanel';
import { ConsolidationPanel } from './stage-panels/ConsolidationPanel';
import { DocksPanel } from './stage-panels/DocksPanel';
import { DeliveryPanel } from './stage-panels/DeliveryPanel';
import { ReturnsPanel } from './stage-panels/ReturnsPanel';
import { ReversePlaceholderPanel } from './stage-panels/ReversePlaceholderPanel';

function getItemsForStage(key: StageKey, snapshot: OpsSnapshot): Record<string, unknown>[] {
  switch (key) {
    case 'pickup':        return snapshot.pickups as Record<string, unknown>[];
    case 'reception':     return snapshot.orders.filter((o) => o['stage'] === 'reception') as Record<string, unknown>[];
    case 'consolidation': return snapshot.orders.filter((o) => o['stage'] === 'consolidation') as Record<string, unknown>[];
    case 'docks':         return snapshot.routes.filter((r) => r['stage'] === 'docks') as Record<string, unknown>[];
    case 'delivery':      return snapshot.routes.filter((r) => r['stage'] === 'delivery' || r['status'] === 'active') as Record<string, unknown>[];
    case 'returns':       return snapshot.returns as Record<string, unknown>[];
    case 'reverse':       return [];
  }
}

interface OpsControlDesktopProps {
  operatorId: string;
}

export function OpsControlDesktop({ operatorId }: OpsControlDesktopProps) {
  const { snapshot, isLoading, lastSyncAt } = useOpsControlSnapshot(operatorId);
  const { activeStage, setStage } = useStageQuery();
  const [atRiskPage, setAtRiskPage] = useState(1);
  const { orders: atRiskOrders, total: atRiskTotal, pageCount: atRiskPageCount } =
    useAtRiskOrders(operatorId, new Date(), atRiskPage);

  if (isLoading && !snapshot) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-md" />
        <div className="grid grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-md" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  const now = new Date();
  const stages = STAGE_KEYS.map((key) => {
    const items = snapshot ? getItemsForStage(key, snapshot) : [];
    const health = computeStageHealth(key, items, now);
    return { key, count: items.length, delta: health.delta, health: health.status };
  });

  const renderPanel = () => {
    if (!activeStage) {
      return (
        <AtRiskTable
          orders={atRiskOrders}
          total={atRiskTotal}
          page={atRiskPage}
          pageCount={Math.max(atRiskPageCount, 1)}
          onPageChange={setAtRiskPage}
        />
      );
    }
    const props = { operatorId, lastSyncAt };
    switch (activeStage) {
      case 'pickup':        return <PickupPanel {...props} />;
      case 'reception':     return <ReceptionPanel {...props} />;
      case 'consolidation': return <ConsolidationPanel {...props} />;
      case 'docks':         return <DocksPanel {...props} />;
      case 'delivery':      return <DeliveryPanel {...props} />;
      case 'returns':       return <ReturnsPanel {...props} />;
      case 'reverse':       return <ReversePlaceholderPanel {...props} />;
    }
  };

  return (
    <div className="space-y-4">
      {/* At-risk banner — only when there are at-risk orders */}
      {atRiskTotal > 0 && (
        <AtRiskBanner
          orders={atRiskOrders.slice(0, 3)}
          total={atRiskTotal}
          onViewAll={() => setStage(null)}
        />
      )}

      {/* Pipeline stage strip */}
      <StageStrip
        stages={stages}
        activeStage={activeStage}
        onStageChange={setStage}
      />

      {/* Drill-down panel */}
      {renderPanel()}
    </div>
  );
}
```

Note: `AtRiskBanner`, `AtRiskTable`, `StageStrip` will be created in subsequent tasks — use temporary `TODO` imports or create empty stubs initially.

- [ ] **Step 1.3: Update page.test.tsx**

```tsx
// page.test.tsx
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock hooks
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: vi.fn(() => ({ operatorId: 'op-1' })),
}));
vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(() => false),
}));
vi.mock('@/hooks/useRealtimeStatus', () => ({
  useRealtimeStatus: vi.fn(() => 'live'),
}));
vi.mock('@/components/PageShell', () => ({
  PageShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="page-shell"><h1>{title}</h1>{children}</div>
  ),
}));
vi.mock('@/components/operations-control/RealtimeStatusIndicator', () => ({
  RealtimeStatusIndicator: ({ status }: { status: string }) => (
    <span data-testid="realtime-indicator">{status}</span>
  ),
}));
vi.mock('@/components/operations-control/mobile/MobileOCC', () => ({
  MobileOCC: () => <div data-testid="mobile-occ" />,
}));
vi.mock('./components/OpsControlDesktop', () => ({
  OpsControlDesktop: () => <div data-testid="ops-desktop" />,
}));

import OpsControlPage from './page';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useOperatorId } from '@/hooks/useOperatorId';

describe('OpsControlPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders PageShell with title on desktop', () => {
    render(<OpsControlPage />);
    expect(screen.getByTestId('page-shell')).toBeInTheDocument();
    expect(screen.getByText('Control de Operaciones')).toBeInTheDocument();
    expect(screen.getByTestId('ops-desktop')).toBeInTheDocument();
  });

  it('renders RealtimeStatusIndicator in actions', () => {
    render(<OpsControlPage />);
    expect(screen.getByTestId('realtime-indicator')).toBeInTheDocument();
  });

  it('renders MobileOCC on mobile', () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(<OpsControlPage />);
    expect(screen.getByTestId('mobile-occ')).toBeInTheDocument();
    expect(screen.queryByTestId('page-shell')).not.toBeInTheDocument();
  });

  it('renders loading when no operatorId', () => {
    vi.mocked(useOperatorId).mockReturnValue({ operatorId: null } as any);
    render(<OpsControlPage />);
    expect(screen.getByText('Cargando...')).toBeInTheDocument();
  });
});
```

- [ ] **Step 1.4: Run tests**

```bash
cd apps/frontend && npx vitest run src/app/app/operations-control/page.test.tsx
```

- [ ] **Step 1.5: Commit**

```bash
git add apps/frontend/src/app/app/operations-control/page.tsx \
       apps/frontend/src/app/app/operations-control/page.test.tsx \
       apps/frontend/src/app/app/operations-control/components/OpsControlDesktop.tsx
git commit -m "refactor(spec-32): restore PageShell + desktop layout scaffold"
```

---

### Task 2: StageStrip (replaces TelemetryStrip + StageCell)

**Files:**
- Create: `apps/frontend/src/app/app/operations-control/components/StageStrip.tsx`
- Create: `apps/frontend/src/app/app/operations-control/components/StageStrip.test.tsx`

**Design reference:** Follow `PipelineCard` pattern from `@/components/operations-control/PipelineCard.tsx`.

- [ ] **Step 2.1: Write the failing test**

```tsx
// StageStrip.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StageStrip } from './StageStrip';

const STAGES = [
  { key: 'pickup' as const, count: 5, delta: '+2', health: 'ok' as const },
  { key: 'reception' as const, count: 3, delta: '0', health: 'warn' as const },
  { key: 'consolidation' as const, count: 0, delta: '—', health: 'neutral' as const },
  { key: 'docks' as const, count: 2, delta: '-1', health: 'crit' as const },
  { key: 'delivery' as const, count: 8, delta: '+3', health: 'ok' as const },
  { key: 'returns' as const, count: 1, delta: '0', health: 'warn' as const },
  { key: 'reverse' as const, count: 0, delta: '—', health: 'neutral' as const },
];

describe('StageStrip', () => {
  it('renders 7 stage buttons', () => {
    render(<StageStrip stages={STAGES} activeStage={null} onStageChange={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(7);
  });

  it('shows count for each stage', () => {
    render(<StageStrip stages={STAGES} activeStage={null} onStageChange={() => {}} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('marks selected stage with aria-pressed', () => {
    render(<StageStrip stages={STAGES} activeStage="pickup" onStageChange={() => {}} />);
    const pickup = screen.getAllByRole('button')[0];
    expect(pickup).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onStageChange when clicked', async () => {
    const fn = vi.fn();
    render(<StageStrip stages={STAGES} activeStage={null} onStageChange={fn} />);
    await userEvent.click(screen.getAllByRole('button')[0]);
    expect(fn).toHaveBeenCalledWith('pickup');
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
cd apps/frontend && npx vitest run src/app/app/operations-control/components/StageStrip.test.tsx
```

- [ ] **Step 2.3: Implement StageStrip**

```tsx
// StageStrip.tsx
'use client';

import type { HealthStatus } from '../lib/health';
import type { StageKey } from '../lib/labels.es';
import { STAGE_LABELS } from '../lib/labels.es';
import { cn } from '@/lib/utils';

interface StageData {
  key: StageKey;
  count: number;
  delta: string;
  health: HealthStatus;
}

interface StageStripProps {
  stages: StageData[];
  activeStage: StageKey | null;
  onStageChange: (key: StageKey) => void;
}

const HEALTH_BORDER: Record<HealthStatus, string> = {
  ok:      'border-l-status-success',
  warn:    'border-l-status-warning',
  crit:    'border-l-status-error',
  neutral: 'border-l-border',
};

const HEALTH_BG: Record<HealthStatus, string> = {
  ok:      'bg-status-success-bg',
  warn:    'bg-status-warning-bg',
  crit:    'bg-status-error-bg',
  neutral: 'bg-transparent',
};

const ORDERED_KEYS: StageKey[] = [
  'pickup', 'reception', 'consolidation', 'docks',
  'delivery', 'returns', 'reverse',
];

export function StageStrip({ stages, activeStage, onStageChange }: StageStripProps) {
  const stageMap = new Map(stages.map((s) => [s.key, s]));

  return (
    <div className="flex w-full rounded-md border border-border bg-surface overflow-hidden">
      {ORDERED_KEYS.map((key, i) => {
        const stage = stageMap.get(key) ?? { key, count: 0, delta: '—', health: 'neutral' as HealthStatus };
        const isSelected = activeStage === key;

        return (
          <button
            key={key}
            type="button"
            aria-pressed={isSelected}
            data-health={stage.health}
            onClick={() => onStageChange(key)}
            className={cn(
              'flex flex-1 flex-col gap-1 border-l-[3px] p-3 text-left transition-colors min-w-0',
              'hover:bg-surface-raised cursor-pointer',
              isSelected
                ? 'border-l-status-info bg-status-info-bg'
                : HEALTH_BORDER[stage.health],
              !isSelected && HEALTH_BG[stage.health],
            )}
          >
            {/* Index + stage label */}
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-xs text-text-muted tabular-nums">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className={cn(
                'text-xs truncate',
                isSelected ? 'text-status-info font-medium' : 'text-text-secondary',
              )}>
                {STAGE_LABELS[key]}
              </span>
            </div>

            {/* Count */}
            <span className="font-mono text-xl font-semibold tabular-nums text-text leading-none">
              {stage.count}
            </span>

            {/* Delta */}
            <span className="font-mono text-xs text-text-muted tabular-nums">
              {stage.delta}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

Key design decisions:
- Uses `border-l-[3px]` + Tailwind status border classes (not inline `borderLeft`)
- Uses `bg-status-*-bg` for health backgrounds (mode-aware, not hardcoded `rgba`)
- Uses `text-xl font-semibold` for count (matches metric cards, not `1.6rem`)
- Uses `p-3` not `12px 14px`
- Uses `hover:bg-surface-raised` for hover (matches table rows)
- Uses `font-sans` implicitly (default, not display font for labels)
- All responsive via Tailwind classes

- [ ] **Step 2.4: Run test to verify it passes**

```bash
cd apps/frontend && npx vitest run src/app/app/operations-control/components/StageStrip.test.tsx
```

- [ ] **Step 2.5: Commit**

```bash
git add apps/frontend/src/app/app/operations-control/components/StageStrip.tsx \
       apps/frontend/src/app/app/operations-control/components/StageStrip.test.tsx
git commit -m "feat(spec-32): StageStrip — Tailwind pipeline stage selector"
```

---

### Task 3: AtRiskBanner (replaces AtRiskBar)

**Files:**
- Create: `apps/frontend/src/app/app/operations-control/components/AtRiskBanner.tsx`
- Create: `apps/frontend/src/app/app/operations-control/components/AtRiskBanner.test.tsx`

**Design reference:** Follow `UrgentOrdersBanner` pattern — soft background + colored border + text, not solid red.

- [ ] **Step 3.1: Write the failing test**

```tsx
// AtRiskBanner.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AtRiskBanner } from './AtRiskBanner';

const ORDERS = [
  { id: 'ORD-001', customer: 'A', address: '123 St', stage: 'delivery', retailer: 'R1', status: 'late' as const, label: '-2h', minutesRemaining: -120, reasonFlag: 'sla_breach' },
  { id: 'ORD-002', customer: 'B', address: '456 St', stage: 'pickup', retailer: 'R2', status: 'at_risk' as const, label: '45m', minutesRemaining: 45, reasonFlag: 'approaching_sla' },
  { id: 'ORD-003', customer: 'C', address: '789 St', stage: 'docks', retailer: 'R3', status: 'at_risk' as const, label: '1h', minutesRemaining: 60, reasonFlag: 'approaching_sla' },
];

describe('AtRiskBanner', () => {
  it('renders total count and role=alert', () => {
    render(<AtRiskBanner orders={ORDERS} total={5} onViewAll={() => {}} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows up to 3 inline order IDs', () => {
    render(<AtRiskBanner orders={ORDERS} total={5} onViewAll={() => {}} />);
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('ORD-002')).toBeInTheDocument();
    expect(screen.getByText('ORD-003')).toBeInTheDocument();
  });

  it('shows overflow count', () => {
    render(<AtRiskBanner orders={ORDERS} total={5} onViewAll={() => {}} />);
    expect(screen.getByText(/\+ 2 más/i)).toBeInTheDocument();
  });

  it('calls onViewAll when clicked', async () => {
    const fn = vi.fn();
    render(<AtRiskBanner orders={ORDERS} total={5} onViewAll={fn} />);
    await userEvent.click(screen.getByRole('button', { name: /ver todas/i }));
    expect(fn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

- [ ] **Step 3.3: Implement AtRiskBanner**

```tsx
// AtRiskBanner.tsx
'use client';

import type { AtRiskOrder } from '@/hooks/ops-control/useAtRiskOrders';
import { Button } from '@/components/ui/button';

interface AtRiskBannerProps {
  orders: AtRiskOrder[];
  total: number;
  onViewAll: () => void;
}

export function AtRiskBanner({ orders, total, onViewAll }: AtRiskBannerProps) {
  const overflow = total - orders.length;

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 px-4 py-3 rounded-md border
                 bg-status-error-bg border-status-error-border text-status-error text-sm"
    >
      <div className="flex items-center gap-3">
        {/* Count */}
        <span className="font-mono text-lg font-bold tabular-nums">{total}</span>
        <span className="font-medium">órdenes en riesgo</span>

        {/* Inline IDs */}
        <span className="flex items-center gap-1.5">
          {orders.map((o) => (
            <span
              key={o.id}
              className="px-1.5 py-0.5 rounded-sm bg-status-error/10 font-mono text-xs tabular-nums"
            >
              {o.id}
            </span>
          ))}
        </span>

        {/* Overflow */}
        {overflow > 0 && (
          <span className="text-xs font-medium">+ {overflow} más</span>
        )}
      </div>

      <Button variant="outline" size="sm" onClick={onViewAll} className="border-status-error text-status-error hover:bg-status-error-bg">
        Ver todas
      </Button>
    </div>
  );
}
```

- [ ] **Step 3.4: Run test to verify it passes**

- [ ] **Step 3.5: Commit**

```bash
git add apps/frontend/src/app/app/operations-control/components/AtRiskBanner.tsx \
       apps/frontend/src/app/app/operations-control/components/AtRiskBanner.test.tsx
git commit -m "feat(spec-32): AtRiskBanner — soft error-bg style matching UrgentOrdersBanner"
```

---

### Task 4: AtRiskTable (replaces AtRiskList)

**Files:**
- Create: `apps/frontend/src/app/app/operations-control/components/AtRiskTable.tsx`
- Create: `apps/frontend/src/app/app/operations-control/components/AtRiskTable.test.tsx`

- [ ] **Step 4.1: Write the failing test**

```tsx
// AtRiskTable.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AtRiskTable } from './AtRiskTable';

const ORDERS = [
  { id: 'ORD-001', customer: 'Alice', address: 'Av. Providencia 123', stage: 'delivery', retailer: 'Falabella', status: 'late' as const, label: '-2h', minutesRemaining: -120, reasonFlag: 'sla_breach' },
  { id: 'ORD-002', customer: 'Bob', address: 'Los Leones 456', stage: 'pickup', retailer: 'Ripley', status: 'at_risk' as const, label: '45m', minutesRemaining: 45, reasonFlag: 'approaching_sla' },
];

describe('AtRiskTable', () => {
  it('renders Spanish column headers', () => {
    render(<AtRiskTable orders={ORDERS} total={2} page={1} pageCount={1} onPageChange={() => {}} />);
    expect(screen.getByText('Pedido')).toBeInTheDocument();
    expect(screen.getByText('Cliente')).toBeInTheDocument();
    expect(screen.getByText('Dirección')).toBeInTheDocument();
    expect(screen.getByText('Etapa')).toBeInTheDocument();
  });

  it('renders order rows', () => {
    render(<AtRiskTable orders={ORDERS} total={2} page={1} pageCount={1} onPageChange={() => {}} />);
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('-2h')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    render(<AtRiskTable orders={[]} total={0} page={1} pageCount={1} onPageChange={() => {}} />);
    expect(screen.getByText('Sin órdenes en riesgo')).toBeInTheDocument();
  });

  it('shows pagination when pageCount > 1', () => {
    render(<AtRiskTable orders={ORDERS} total={50} page={2} pageCount={3} onPageChange={() => {}} />);
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument();
  });

  it('hides pagination when pageCount = 1', () => {
    render(<AtRiskTable orders={ORDERS} total={2} page={1} pageCount={1} onPageChange={() => {}} />);
    expect(screen.queryByText(/Página/)).not.toBeInTheDocument();
  });

  it('calls onPageChange for next/prev', async () => {
    const fn = vi.fn();
    render(<AtRiskTable orders={ORDERS} total={50} page={2} pageCount={3} onPageChange={fn} />);
    await userEvent.click(screen.getByRole('button', { name: /anterior/i }));
    expect(fn).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    expect(fn).toHaveBeenCalledWith(3);
  });

  it('disables prev on first page', () => {
    render(<AtRiskTable orders={ORDERS} total={50} page={1} pageCount={3} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /anterior/i })).toBeDisabled();
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

- [ ] **Step 4.3: Implement AtRiskTable**

```tsx
// AtRiskTable.tsx
'use client';

import type { AtRiskOrder } from '@/hooks/ops-control/useAtRiskOrders';
import { STATUS_LABELS } from '../lib/labels.es';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface AtRiskTableProps {
  orders: AtRiskOrder[];
  total: number;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}

export function AtRiskTable({ orders, page, pageCount, onPageChange }: AtRiskTableProps) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs text-text-muted uppercase tracking-wide font-medium">Pedido</th>
              <th className="px-3 py-2 text-left text-xs text-text-muted uppercase tracking-wide font-medium">Cliente</th>
              <th className="px-3 py-2 text-left text-xs text-text-muted uppercase tracking-wide font-medium">Dirección</th>
              <th className="px-3 py-2 text-left text-xs text-text-muted uppercase tracking-wide font-medium">Etapa</th>
              <th className="px-3 py-2 text-left text-xs text-text-muted uppercase tracking-wide font-medium">Retailer</th>
              <th className="px-3 py-2 text-left text-xs text-text-muted uppercase tracking-wide font-medium">Tiempo</th>
              <th className="px-3 py-2 text-left text-xs text-text-muted uppercase tracking-wide font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-text-muted">
                  Sin órdenes en riesgo
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} className="border-b border-border hover:bg-surface-raised transition-colors">
                  <td className="px-3 py-2 font-mono tabular-nums text-status-info font-semibold">{order.id}</td>
                  <td className="px-3 py-2">{order.customer}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate">{order.address}</td>
                  <td className="px-3 py-2">{order.stage}</td>
                  <td className="px-3 py-2">{order.retailer}</td>
                  <td className={`px-3 py-2 font-mono tabular-nums ${order.status === 'late' ? 'text-status-error' : 'text-status-warning'}`}>
                    {order.label}
                  </td>
                  <td className="px-3 py-2">{STATUS_LABELS[order.status] ?? order.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center gap-3 px-3 py-2 border-t border-border text-xs text-text-secondary">
          <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
            Anterior
          </Button>
          <span>Página {page} de {pageCount}</span>
          <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}>
            Siguiente
          </Button>
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 4.4: Run test to verify it passes**

- [ ] **Step 4.5: Commit**

```bash
git add apps/frontend/src/app/app/operations-control/components/AtRiskTable.tsx \
       apps/frontend/src/app/app/operations-control/components/AtRiskTable.test.tsx
git commit -m "feat(spec-32): AtRiskTable — Tailwind table with shadcn Card + Button"
```

---

### Task 5: StagePanel (replaces DrillDownPanel)

**Files:**
- Create: `apps/frontend/src/app/app/operations-control/components/StagePanel.tsx`
- Create: `apps/frontend/src/app/app/operations-control/components/StagePanel.test.tsx`

- [ ] **Step 5.1: Write the failing test**

```tsx
// StagePanel.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StagePanel } from './StagePanel';

const KPIS = [
  { label: 'Pendientes', value: '12' },
  { label: 'Vencidas', value: '3' },
  { label: 'Próx. ventana', value: '14:30' },
  { label: 'Avg espera', value: '8m' },
];

describe('StagePanel', () => {
  it('renders title and subtitle', () => {
    render(
      <StagePanel title="Recogida" subtitle="Pickups agrupados" deepLink="/app/pickup" kpis={KPIS} page={1} pageCount={1} onPageChange={() => {}} lastSyncAt={null}>
        <div>content</div>
      </StagePanel>
    );
    expect(screen.getByText('Recogida')).toBeInTheDocument();
    expect(screen.getByText('Pickups agrupados')).toBeInTheDocument();
  });

  it('renders 4 KPI values', () => {
    render(
      <StagePanel title="T" subtitle="S" deepLink={null} kpis={KPIS} page={1} pageCount={1} onPageChange={() => {}} lastSyncAt={null}>
        <div />
      </StagePanel>
    );
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('14:30')).toBeInTheDocument();
    expect(screen.getByText('8m')).toBeInTheDocument();
  });

  it('renders deep link when provided', () => {
    render(
      <StagePanel title="T" subtitle="S" deepLink="/app/pickup" deepLinkLabel="Abrir Recogida" kpis={KPIS} page={1} pageCount={1} onPageChange={() => {}} lastSyncAt={null}>
        <div />
      </StagePanel>
    );
    const link = screen.getByText(/Abrir Recogida/);
    expect(link.closest('a')).toHaveAttribute('href', '/app/pickup');
  });

  it('renders Próximamente button when deepLink is null', () => {
    render(
      <StagePanel title="T" subtitle="S" deepLink={null} kpis={KPIS} page={1} pageCount={1} onPageChange={() => {}} lastSyncAt={null}>
        <div />
      </StagePanel>
    );
    expect(screen.getByRole('button', { name: /próximamente/i })).toBeDisabled();
  });

  it('renders children in content area', () => {
    render(
      <StagePanel title="T" subtitle="S" deepLink={null} kpis={KPIS} page={1} pageCount={1} onPageChange={() => {}} lastSyncAt={null}>
        <div data-testid="table-slot">Table here</div>
      </StagePanel>
    );
    expect(screen.getByTestId('table-slot')).toBeInTheDocument();
  });

  it('renders pagination and calls onPageChange', async () => {
    const fn = vi.fn();
    render(
      <StagePanel title="T" subtitle="S" deepLink={null} kpis={KPIS} page={2} pageCount={3} onPageChange={fn} lastSyncAt={null}>
        <div />
      </StagePanel>
    );
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /anterior/i }));
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('shows sync time when lastSyncAt provided', () => {
    const syncDate = new Date('2026-04-09T14:30:00');
    render(
      <StagePanel title="T" subtitle="S" deepLink={null} kpis={KPIS} page={1} pageCount={1} onPageChange={() => {}} lastSyncAt={syncDate}>
        <div />
      </StagePanel>
    );
    expect(screen.getByText(/Tiempo real/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

- [ ] **Step 5.3: Implement StagePanel**

```tsx
// StagePanel.tsx
'use client';

import type { ReactNode } from 'react';
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export interface KpiSlot {
  label: string;
  value: string;
  trend?: string;
}

interface StagePanelProps {
  title: string;
  subtitle: string;
  deepLink: string | null;
  deepLinkLabel?: string;
  kpis: KpiSlot[];
  children: ReactNode;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  lastSyncAt: Date | null;
}

export function StagePanel({
  title, subtitle, deepLink, deepLinkLabel = 'Abrir',
  kpis, children, page, pageCount, onPageChange, lastSyncAt,
}: StagePanelProps) {
  return (
    <Card>
      {/* Header */}
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          <p className="text-sm text-text-secondary">{subtitle}</p>
        </div>
        {deepLink !== null ? (
          <Button variant="outline" size="sm" asChild>
            <a href={deepLink}>{deepLinkLabel} &rarr;</a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>Próximamente</Button>
        )}
      </CardHeader>

      {/* KPI strip */}
      <div className="grid grid-cols-4 border-y border-border">
        {kpis.slice(0, 4).map((kpi) => (
          <div key={kpi.label} className="p-4 border-r border-border last:border-r-0">
            <span className="text-xs text-text-muted uppercase tracking-wide">{kpi.label}</span>
            <div className="mt-1">
              <span className="font-mono text-xl font-semibold text-text tabular-nums leading-none">
                {kpi.value}
              </span>
              {kpi.trend && (
                <span className="ml-1 text-sm text-text-secondary">{kpi.trend}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Table content */}
      <CardContent className="p-0">
        {children}
      </CardContent>

      {/* Footer: pagination + sync time */}
      <CardFooter className="justify-between border-t border-border py-2 px-4">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
            Anterior
          </Button>
          <span>Página {page} de {pageCount}</span>
          <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}>
            Siguiente
          </Button>
        </div>
        <span className="text-xs text-text-muted">
          Tiempo real
          {lastSyncAt && <> &middot; {lastSyncAt.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</>}
        </span>
      </CardFooter>
    </Card>
  );
}
```

Key design decisions vs old DrillDownPanel:
- Uses shadcn `Card`, `CardHeader`, `CardContent`, `CardFooter`
- Uses `Button variant="outline" size="sm"` for pagination (not hand-rolled)
- KPI values: `text-xl font-semibold` (not `1.4rem 700`)
- Title: `text-lg font-semibold` (not `font-display 1.1rem 700`)
- All Tailwind spacing: `p-4`, `gap-2`, `py-2 px-4`

- [ ] **Step 5.4: Run test to verify it passes**

- [ ] **Step 5.5: Commit**

```bash
git add apps/frontend/src/app/app/operations-control/components/StagePanel.tsx \
       apps/frontend/src/app/app/operations-control/components/StagePanel.test.tsx
git commit -m "feat(spec-32): StagePanel — shadcn Card drill-down template"
```

---

### Task 6: Rewrite all 7 stage panels

**Files:** All 7 files in `components/stage-panels/` + their tests.

Each panel follows the same transformation:
1. Replace `DrillDownPanel` import with `StagePanel`
2. Replace `CSSProperties` constants (TH, TD, EMPTY_TD) with shared Tailwind table markup
3. Keep the data logic (hooks, computed KPIs) exactly the same

- [ ] **Step 6.1: Create shared table style constants**

Create a small helper file to avoid repeating the same TH/TD classNames 7 times:

```tsx
// components/stage-panels/tableStyles.ts
export const TH = 'px-3 py-2 text-left text-xs text-text-muted uppercase tracking-wide font-medium whitespace-nowrap';
export const TD = 'px-3 py-2 text-sm text-text whitespace-nowrap';
export const TD_MONO = 'px-3 py-2 text-sm font-mono tabular-nums text-text whitespace-nowrap';
export const TD_LINK = 'px-3 py-2 text-sm font-mono tabular-nums text-status-info font-semibold whitespace-nowrap';
export const TD_EMPTY = 'px-3 py-6 text-center text-sm text-text-muted';
export const TR = 'border-b border-border hover:bg-surface-raised transition-colors';
```

- [ ] **Step 6.2: Rewrite PickupPanel (complete example — other panels follow same pattern)**

```tsx
// stage-panels/PickupPanel.tsx
'use client';

import { useState } from 'react';
import { StagePanel } from '../StagePanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';
import { TH, TD, TD_MONO, TD_LINK, TD_EMPTY, TR } from './tableStyles';

export interface StagePanelProps {
  operatorId: string;
  lastSyncAt: Date | null;
}

export function PickupPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const [page, setPage] = useState(1);
  const { rows, pageCount } = useStageBreakdown('pickup', operatorId, page);

  const pendientes = rows.length;
  const vencidas = rows.filter((r) => r['overdue_minutes'] && (r['overdue_minutes'] as number) > 0).length;
  const proxVentana = rows.length > 0 ? (rows[0]['window'] as string | undefined) ?? '—' : '—';
  const avgEspera = rows.length > 0
    ? `${Math.round(rows.reduce((sum, r) => sum + ((r['wait_minutes'] as number) ?? 0), 0) / rows.length)}m`
    : '—';

  const kpis = [
    { label: 'Pendientes', value: String(pendientes) },
    { label: 'Vencidas', value: String(vencidas) },
    { label: 'Próx. ventana', value: proxVentana },
    { label: 'Avg espera', value: avgEspera },
  ];

  return (
    <StagePanel
      title="Recogida"
      subtitle="Pickups agrupados por retailer"
      deepLink="/app/pickup"
      deepLinkLabel="Abrir Recogida"
      kpis={kpis}
      page={page}
      pageCount={Math.max(pageCount, 1)}
      onPageChange={setPage}
      lastSyncAt={lastSyncAt}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Retailer</th>
              <th className={TH}># Órdenes</th>
              <th className={TH}>Ventana</th>
              <th className={TH}>Espera</th>
              <th className={TH}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className={TD_EMPTY}>Sin elementos en esta etapa</td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={(row['retailer'] as string) ?? i} className={TR}>
                  <td className={TD_LINK}>{(row['retailer'] as string) ?? '—'}</td>
                  <td className={TD_MONO}>{String(row['order_count'] ?? row['orders'] ?? '—')}</td>
                  <td className={TD}>{(row['window'] as string) ?? '—'}</td>
                  <td className={TD_MONO}>{row['wait_minutes'] != null ? `${row['wait_minutes']}m` : '—'}</td>
                  <td className={TD}>{(row['status'] as string) ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </StagePanel>
  );
}
```

The other 5 active panels (Reception, Consolidation, Docks, Delivery, Returns) follow the exact same transformation:
1. Replace `import { DrillDownPanel }` with `import { StagePanel }`
2. Replace `const TH/TD/EMPTY_TD: React.CSSProperties` with `import { TH, TD, ... } from './tableStyles'`
3. Replace `<DrillDownPanel ...>` with `<StagePanel ...>`
4. Replace all `style={TH}` with `className={TH}`, `style={TD}` with `className={TD}`, etc.
5. Replace `style={{ ...TD, color: 'var(--color-status-info)', fontWeight: 600 }}` with `className={TD_LINK}`
6. Replace `style={{ ...TD, fontFamily: 'var(--font-sans)' }}` with `className={TD}`
7. Add `className={TR}` to each `<tr>` in tbody

- [ ] **Step 6.3: Rewrite ReceptionPanel** (same pattern)
- [ ] **Step 6.4: Rewrite ConsolidationPanel** (same pattern)
- [ ] **Step 6.5: Rewrite DocksPanel** (same pattern)
- [ ] **Step 6.6: Rewrite DeliveryPanel** (same pattern)
- [ ] **Step 6.7: Rewrite ReturnsPanel** (same pattern)
- [ ] **Step 6.8: Rewrite ReversePlaceholderPanel**

For the placeholder panel, replace inline styles with Tailwind:
```tsx
<StagePanel title="Logística inversa" subtitle="Próximamente" deepLink={null} kpis={[...]} page={1} pageCount={1} onPageChange={() => {}} lastSyncAt={lastSyncAt}>
  <div className="px-3 py-6 text-center text-sm text-text-muted">
    Próximamente
  </div>
</StagePanel>
```

- [ ] **Step 6.9: Update all 7 panel tests**

Each test should still pass — the tests check for text content and data-testids, not styling. Run all:

```bash
cd apps/frontend && npx vitest run src/app/app/operations-control/components/stage-panels/
```

- [ ] **Step 6.10: Commit**

```bash
git add apps/frontend/src/app/app/operations-control/components/stage-panels/
git commit -m "refactor(spec-32): rewrite 7 stage panels — Tailwind + StagePanel"
```

---

### Task 7: Wire everything together in OpsControlDesktop

**Files:**
- Modify: `apps/frontend/src/app/app/operations-control/components/OpsControlDesktop.tsx`

- [ ] **Step 7.1: Import new components**

Replace stub/TODO imports with the real ones:
```tsx
import { StageStrip } from './StageStrip';
import { AtRiskBanner } from './AtRiskBanner';
import { AtRiskTable } from './AtRiskTable';
```

- [ ] **Step 7.2: Run full test suite**

```bash
cd apps/frontend && npx vitest run src/app/app/operations-control/
```

All tests must pass.

- [ ] **Step 7.3: Commit**

```bash
git add apps/frontend/src/app/app/operations-control/components/OpsControlDesktop.tsx
git commit -m "feat(spec-32): wire OpsControlDesktop with new components"
```

---

### Task 8: Delete old components + clean up CSS

**Files:**
- Delete: `components/MissionDeck.tsx`
- Delete: `components/TopBar.tsx`, `components/TopBar.test.tsx`
- Delete: `components/TelemetryStrip.tsx`, `components/TelemetryStrip.test.tsx`
- Delete: `components/StageCell.tsx`, `components/StageCell.test.tsx`
- Delete: `components/AtRiskBar.tsx`, `components/AtRiskBar.test.tsx`
- Delete: `components/AtRiskList.tsx`, `components/AtRiskList.test.tsx`
- Delete: `components/DrillDownPanel.tsx`, `components/DrillDownPanel.test.tsx`
- Modify: `apps/frontend/src/app/globals.css`

- [ ] **Step 8.1: Delete old component files**

```bash
cd apps/frontend/src/app/app/operations-control/components
rm MissionDeck.tsx TopBar.tsx TopBar.test.tsx \
   TelemetryStrip.tsx TelemetryStrip.test.tsx \
   StageCell.tsx StageCell.test.tsx \
   AtRiskBar.tsx AtRiskBar.test.tsx \
   AtRiskList.tsx AtRiskList.test.tsx \
   DrillDownPanel.tsx DrillDownPanel.test.tsx
```

- [ ] **Step 8.2: Remove `--md-*` tokens from globals.css**

Delete the `/* ---- MISSION DECK PALETTE ---- */` block (approximately lines 175-188 in globals.css on origin/main) containing:
```css
--md-bg, --md-panel, --md-panel-2, --md-hairline, --md-hairline-2,
--md-text, --md-dim, --md-dimmer, --md-cobalt, --md-amber, --md-crimson, --md-mint
```

- [ ] **Step 8.3: Run full test suite — everything must still pass**

```bash
cd apps/frontend && npx vitest run
```

- [ ] **Step 8.4: Commit**

```bash
git add -A apps/frontend/src/app/app/operations-control/components/ \
         apps/frontend/src/app/globals.css
git commit -m "chore(spec-32): delete old Mission Deck components + dead --md-* tokens"
```

---

### Task 9: Visual verification + PR

- [ ] **Step 9.1: Start dev server, verify light + dark mode**

```bash
cd apps/frontend && npm run dev
```

Check `/app/operations-control` in both light and dark modes. Verify:
- PageShell header with breadcrumbs renders
- StageStrip shows 7 stages with correct health colors
- AtRiskBanner uses soft red background (not solid red)
- Drill-down panels use shadcn Card styling
- Tables match other pages' typography and spacing
- No flash of unstyled content
- Mobile view falls back to MobileOCC

- [ ] **Step 9.2: Push branch + create PR + auto-merge**

```bash
git push origin feat/spec-32-ops-control-design-alignment
gh pr create --title "refactor(spec-32): ops control design alignment" --body "$(cat <<'EOF'
## Summary
- Rewrite all 14 spec-29 Mission Deck components from inline styles to Tailwind + shadcn/ui
- Restore PageShell wrapper with breadcrumbs + RealtimeStatusIndicator
- Replace solid-red AtRiskBar with soft error-bg banner (matches UrgentOrdersBanner)
- Replace hand-rolled DrillDownPanel with shadcn Card
- Replace raw tables with Tailwind-styled table markup
- Remove dead --md-* CSS tokens from globals.css
- Restore useIsMobile() gate for mobile fallback

## Test plan
- [ ] All existing Vitest tests pass
- [ ] Light mode renders correctly
- [ ] Dark mode renders correctly
- [ ] Mobile falls back to MobileOCC
- [ ] Pipeline stage selection + drill-down navigation works
- [ ] At-risk banner shows/hides correctly

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```

- [ ] **Step 9.3: Wait for CI, confirm merge**

```bash
gh pr checks <PR_NUMBER>
gh pr view <PR_NUMBER> --json state,mergedAt
```

---

## Verification Checklist

- [ ] Every component uses Tailwind classes (zero inline `style={{}}` objects)
- [ ] No `fontFamily: 'var(--font-*)'` — use `font-sans`, `font-mono`, `font-display` Tailwind classes
- [ ] No raw pixel spacing — only Tailwind spacing scale (`p-3`, `gap-2`, etc.)
- [ ] No `borderRadius: 'Npx'` — only `rounded-md`, `rounded-lg`
- [ ] No hardcoded `rgba()` colors — only semantic Tailwind classes
- [ ] PageShell wraps the page with breadcrumbs + title + separator
- [ ] shadcn Card used for panels, shadcn Button for pagination/actions
- [ ] Status indicators use `*-bg` + `*-border` pattern (soft style)
- [ ] `font-display` only on page title (not stage labels or panel titles)
- [ ] `--md-*` tokens removed from globals.css
- [ ] Mobile detection works (useIsMobile → MobileOCC)
- [ ] All Vitest tests pass
- [ ] CI green, PR merged
