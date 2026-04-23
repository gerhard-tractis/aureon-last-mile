# Spec 18 — Distribution Page Visual Polish

**Status:** completed

_Date: 2026-03-24_

---

## Goal

Elevate the distribution dashboard from functional to polished by adopting existing design system components (`MetricCard`, `EmptyState`) and adding icons, color cues, and better empty states. Single focused PR, no new components created.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| KPI rendering | Reuse `MetricCard` directly | DRY, visual consistency with dashboard, free trend/sparkline support later |
| Dispatch card tint | Always amber (not just when `dueSoon > 0`) | Consistent visual landmark — operators learn "amber = dispatch zone" |
| Scope | Distribution page only | Tight PR, no side effects on other pages |

## Changes

### 1. KPI Cards → MetricCard

**File:** `apps/frontend/src/app/app/distribution/page.tsx`
**Import:** `import { MetricCard } from '@/components/metrics/MetricCard';`

Replace `<DistributionKPIs>` import/usage with three inline `<MetricCard>` instances in a responsive grid (`grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4`):

| KPI | icon | label | value | className |
|-----|------|-------|-------|-----------|
| Pending | `Package` | `Pendientes de sectorizar` | `kpis?.pending ?? 0` | _(default)_ |
| Consolidation | `Layers` | `En consolidación` | `kpis?.consolidation ?? 0` | _(default)_ |
| Due soon | `Clock` | `Próximos a despachar` | `kpis?.dueSoon ?? 0` | `border-status-warning-border bg-status-warning-bg` (always applied) |

KPI cards render **unconditionally** — they show even when no dock zones are configured (values will be 0). This gives operators immediate visibility into the system state.

**Delete:** `apps/frontend/src/components/distribution/DistributionKPIs.tsx` and `DistributionKPIs.test.tsx`

### 2. Action Buttons — Icons + Mobile Labels

**File:** `apps/frontend/src/app/app/distribution/page.tsx`

Add Lucide icons and responsive labels:

| Button | Icon | Mobile label | Desktop label |
|--------|------|-------------|---------------|
| Modo lote | `LayoutGrid` | `Lote` | `Modo lote` |
| Modo rápido | `Zap` | `Rápido` | `Modo rápido` |
| Configurar andenes | `Settings` | `Andenes` | `Configurar andenes` |

Pattern:
```tsx
<Link href="..." className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-muted">
  <LayoutGrid className="h-3.5 w-3.5" />
  <span className="sm:hidden">Lote</span>
  <span className="hidden sm:inline">Modo lote</span>
</Link>
```

### 3. Empty States → EmptyState Component

**Import (all files):** `import { EmptyState } from '@/components/EmptyState';`

#### 3a. No dock zones configured (page-level)

**File:** `apps/frontend/src/app/app/distribution/page.tsx` (lines 62-69)

When `activeZones.length === 0`, show the EmptyState **between the KPIs and where the grid would be** (not an early return — KPIs still render above). This replaces the current inline `<div>` + link:

```tsx
<EmptyState
  icon={Layers}
  title="Sin andenes configurados"
  description="Configura tus andenes para comenzar a sectorizar paquetes por zona de entrega."
  action={{ label: 'Configurar andenes', href: '/app/distribution/settings' }}
/>
```

#### 3b. No active zones in DockZoneGrid

**File:** `apps/frontend/src/components/distribution/DockZoneGrid.tsx` (lines 9-14)

```tsx
<EmptyState
  icon={Layers}
  title="Sin andenes activos"
  description="Todos los andenes están inactivos. Activa al menos uno para ver la grilla de distribución."
  action={{ label: 'Configurar andenes', href: '/app/distribution/settings' }}
/>
```

#### 3c. No consolidation packages

**File:** `apps/frontend/src/components/distribution/ConsolidationPanel.tsx` (lines 20-27)

```tsx
<EmptyState
  icon={Package}
  title="Sin paquetes en consolidación"
  description="Los paquetes que necesiten consolidarse antes de despacho aparecerán aquí."
/>
```

No action button — consolidation is automatic, not user-initiated.

### 4. Test Updates

- **Delete** `DistributionKPIs.test.tsx`
- **Update** distribution `page.tsx` tests: verify MetricCard renders (check for `data-value` attribute, icon presence via role/label)
- **Update** distribution `page.tsx` tests: verify the "Próximos a despachar" MetricCard **always** has `border-status-warning-border bg-status-warning-bg` classes regardless of KPI value
- **Update** `DockZoneGrid.test.tsx`: verify EmptyState renders with title "Sin andenes activos"
- **Update** `ConsolidationPanel.test.tsx`: verify EmptyState renders with title "Sin paquetes en consolidación"

## Files Changed

| File | Action |
|------|--------|
| `apps/frontend/src/app/app/distribution/page.tsx` | Edit |
| `apps/frontend/src/components/distribution/DockZoneGrid.tsx` | Edit |
| `apps/frontend/src/components/distribution/ConsolidationPanel.tsx` | Edit |
| `apps/frontend/src/components/distribution/DistributionKPIs.tsx` | Delete |
| `apps/frontend/src/components/distribution/DistributionKPIs.test.tsx` | Delete |
| `apps/frontend/src/components/distribution/DockZoneGrid.test.tsx` | Edit |
| `apps/frontend/src/components/distribution/ConsolidationPanel.test.tsx` | Edit |

## Out of Scope

- No changes to `MetricCard` or `EmptyState` themselves
- No new shared components created
- No design token changes
- No changes to other pages
- Trend/sparkline data for KPIs (future enhancement)

---

# Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plain KPI cards, bare buttons, and inline empty states on the distribution page with the existing `MetricCard` and `EmptyState` design system components, adding icons and color cues.

**Architecture:** Pure UI refactor — no data model, API, or hook changes. Swap `DistributionKPIs` for three `MetricCard` instances, add Lucide icons to action buttons with responsive labels, and replace three inline empty states with the `EmptyState` component.

**Tech Stack:** React, Next.js App Router, Tailwind CSS, Lucide React, Vitest + Testing Library

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/frontend/src/app/app/distribution/page.tsx` | Edit | Main distribution page — KPIs, buttons, page-level empty state |
| `apps/frontend/src/components/distribution/DockZoneGrid.tsx` | Edit | Grid empty state → EmptyState |
| `apps/frontend/src/components/distribution/ConsolidationPanel.tsx` | Edit | Panel empty state → EmptyState |
| `apps/frontend/src/components/distribution/DistributionKPIs.tsx` | Delete | Replaced by inline MetricCards |
| `apps/frontend/src/components/distribution/DistributionKPIs.test.tsx` | Delete | Tests move to page-level |
| `apps/frontend/src/app/app/distribution/page.test.tsx` | Create | New page-level tests for KPIs, buttons, empty state |
| `apps/frontend/src/components/distribution/DockZoneGrid.test.tsx` | Edit | Update empty state assertion |
| `apps/frontend/src/components/distribution/ConsolidationPanel.test.tsx` | Edit | Update empty state assertion |

---

## Chunk 1: DockZoneGrid EmptyState

### Task 1: DockZoneGrid — test + implementation

**Files:**
- Modify: `apps/frontend/src/components/distribution/DockZoneGrid.test.tsx`
- Modify: `apps/frontend/src/components/distribution/DockZoneGrid.tsx`

- [ ] **Step 1: Update the empty state test**

Open `apps/frontend/src/components/distribution/DockZoneGrid.test.tsx` and replace the `'shows empty state when no zones'` test (line 45-48):

```tsx
  it('shows empty state when no zones', () => {
    render(<DockZoneGrid zones={[]} />);
    expect(screen.getByText('Sin andenes activos')).toBeInTheDocument();
    expect(screen.getByText(/activa al menos uno/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /configurar andenes/i })).toHaveAttribute('href', '/app/distribution/settings');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/distribution/DockZoneGrid.test.tsx`
Expected: FAIL — "Sin andenes activos" not found (old text was "No hay andenes configurados para mostrar")

- [ ] **Step 3: Implement DockZoneGrid empty state**

Edit `apps/frontend/src/components/distribution/DockZoneGrid.tsx`. Add import at top:

```tsx
import { Layers } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
```

Replace lines 9-14 (the empty `<div>`) with:

```tsx
  if (zones.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="Sin andenes activos"
        description="Todos los andenes están inactivos. Activa al menos uno para ver la grilla de distribución."
        action={{ label: 'Configurar andenes', href: '/app/distribution/settings' }}
      />
    );
  }
```

Remove the unused `Card` import if it's only used in the empty state — but here `Card` and `CardContent` are still used by the zone cards below, so keep them.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/distribution/DockZoneGrid.test.tsx`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/distribution/DockZoneGrid.tsx apps/frontend/src/components/distribution/DockZoneGrid.test.tsx
git commit -m "feat(distribution): replace DockZoneGrid empty state with EmptyState component"
```

---

## Chunk 2: ConsolidationPanel EmptyState

### Task 2: ConsolidationPanel — test + implementation

**Files:**
- Modify: `apps/frontend/src/components/distribution/ConsolidationPanel.test.tsx`
- Modify: `apps/frontend/src/components/distribution/ConsolidationPanel.tsx`

- [ ] **Step 1: Update the empty state test**

Open `apps/frontend/src/components/distribution/ConsolidationPanel.test.tsx` and replace the `'shows empty state when no packages in consolidation'` test (line 25-28):

```tsx
  it('shows empty state when no packages in consolidation', () => {
    render(<ConsolidationPanel packages={[]} onRelease={vi.fn()} />);
    expect(screen.getByText('Sin paquetes en consolidación')).toBeInTheDocument();
    expect(screen.getByText(/necesiten consolidarse/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/distribution/ConsolidationPanel.test.tsx`
Expected: FAIL — "Sin paquetes en consolidación" not found

- [ ] **Step 3: Implement ConsolidationPanel empty state**

Edit `apps/frontend/src/components/distribution/ConsolidationPanel.tsx`. Add imports at top:

```tsx
import { Package } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
```

Replace lines 20-27 (the empty `<Card>`) with:

```tsx
  if (packages.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Sin paquetes en consolidación"
        description="Los paquetes que necesiten consolidarse antes de despacho aparecerán aquí."
      />
    );
  }
```

Remove `Card` and `CardContent` from imports **only if** they are no longer used elsewhere in the file. Check: `Card` is still used in `PackageRow` (line 63), so keep both imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/distribution/ConsolidationPanel.test.tsx`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/distribution/ConsolidationPanel.tsx apps/frontend/src/components/distribution/ConsolidationPanel.test.tsx
git commit -m "feat(distribution): replace ConsolidationPanel empty state with EmptyState component"
```

---

## Chunk 3: Distribution Page — KPIs, Buttons, Empty State

### Task 3: Write page-level tests

**Files:**
- Create: `apps/frontend/src/app/app/distribution/page.test.tsx`

- [ ] **Step 1: Create the page test file**

Create `apps/frontend/src/app/app/distribution/page.test.tsx` with mocks for all hooks and the full test suite:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DistributionPage from './page';

// Mock all hooks used by the page
const mockKpis = { pending: 5, consolidation: 3, dueSoon: 2 };
const mockUseDistributionKPIs = vi.fn();
vi.mock('@/hooks/distribution/useDistributionKPIs', () => ({
  useDistributionKPIs: (...args: unknown[]) => mockUseDistributionKPIs(...args),
}));

vi.mock('@/hooks/distribution/useConsolidation', () => ({
  useConsolidation: () => ({ data: [] }),
  useReleaseFromConsolidation: () => ({ mutate: vi.fn() }),
}));

const mockZones = [
  { id: 'z1', name: 'Andén 1', code: 'D1', is_consolidation: false, comunas: [{ id: 'c1', nombre: 'las condes' }], is_active: true, operator_id: 'op1' },
];
const mockUseDockZones = vi.fn();
vi.mock('@/hooks/distribution/useDockZones', () => ({
  useDockZones: (...args: unknown[]) => mockUseDockZones(...args),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

// Mock next/link to render as <a>
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode;[key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('DistributionPage', () => {
  beforeEach(() => {
    mockUseDistributionKPIs.mockReturnValue({ data: mockKpis, isLoading: false });
    mockUseDockZones.mockReturnValue({ data: mockZones });
  });

  describe('KPI cards', () => {
    it('renders three MetricCards with correct values', () => {
      const { container } = render(<DistributionPage />);
      // MetricCard renders values inside [data-value] elements
      const valueEls = container.querySelectorAll('[data-value]');
      expect(valueEls).toHaveLength(3);
      expect(valueEls[0].textContent).toBe('5');
      expect(valueEls[1].textContent).toBe('3');
      expect(valueEls[2].textContent).toBe('2');
    });

    it('renders KPI labels', () => {
      render(<DistributionPage />);
      expect(screen.getByText(/pendientes de sectorizar/i)).toBeInTheDocument();
      expect(screen.getByText(/en consolidación/i)).toBeInTheDocument();
      expect(screen.getByText(/próximos a despachar/i)).toBeInTheDocument();
    });

    it('always applies amber styling to the dispatch KPI card', () => {
      // Even with dueSoon=0, the card should have warning styling
      mockUseDistributionKPIs.mockReturnValue({
        data: { pending: 0, consolidation: 0, dueSoon: 0 },
        isLoading: false,
      });
      const { container } = render(<DistributionPage />);
      const amberCard = container.querySelector('.border-status-warning-border.bg-status-warning-bg');
      expect(amberCard).toBeTruthy();
    });
  });

  describe('Action buttons', () => {
    it('renders action links with icons', () => {
      render(<DistributionPage />);
      expect(screen.getByRole('link', { name: /lote/i })).toHaveAttribute('href', '/app/distribution/batch');
      expect(screen.getByRole('link', { name: /rápido/i })).toHaveAttribute('href', '/app/distribution/quicksort');
      expect(screen.getByRole('link', { name: /andenes/i })).toHaveAttribute('href', '/app/distribution/settings');
    });
  });

  describe('Empty state', () => {
    it('shows EmptyState when no active zones exist', () => {
      mockUseDockZones.mockReturnValue({ data: [] });
      render(<DistributionPage />);
      expect(screen.getByText('Sin andenes configurados')).toBeInTheDocument();
      expect(screen.getByText(/configura tus andenes/i)).toBeInTheDocument();
    });

    it('still renders KPI cards even when no zones exist', () => {
      mockUseDockZones.mockReturnValue({ data: [] });
      const { container } = render(<DistributionPage />);
      const valueEls = container.querySelectorAll('[data-value]');
      expect(valueEls).toHaveLength(3);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npx vitest run src/app/app/distribution/page.test.tsx`
Expected: FAIL — DistributionKPIs is still being used (no MetricCard, no icons on buttons, no EmptyState on page)

### Task 4: Implement page changes

**Files:**
- Modify: `apps/frontend/src/app/app/distribution/page.tsx`
- Delete: `apps/frontend/src/components/distribution/DistributionKPIs.tsx`
- Delete: `apps/frontend/src/components/distribution/DistributionKPIs.test.tsx`

- [ ] **Step 3: Rewrite page.tsx**

Replace the entire content of `apps/frontend/src/app/app/distribution/page.tsx` with:

```tsx
'use client';
import { MetricCard } from '@/components/metrics/MetricCard';
import { EmptyState } from '@/components/EmptyState';
import { DockZoneGrid } from '@/components/distribution/DockZoneGrid';
import { ConsolidationPanel } from '@/components/distribution/ConsolidationPanel';
import { UnmappedComunasBanner } from '@/components/distribution/UnmappedComunasBanner';
import { useDistributionKPIs } from '@/hooks/distribution/useDistributionKPIs';
import { useConsolidation, useReleaseFromConsolidation } from '@/hooks/distribution/useConsolidation';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { useOperatorId } from '@/hooks/useOperatorId';
import { Skeleton } from '@/components/ui/skeleton';
import { Package, Layers, Clock, LayoutGrid, Zap, Settings } from 'lucide-react';
import Link from 'next/link';

export default function DistributionPage() {
  const { operatorId } = useOperatorId();
  const { data: kpis, isLoading: kpisLoading } = useDistributionKPIs(operatorId);
  const { data: consolidationPackages } = useConsolidation(operatorId);
  const { data: zones } = useDockZones(operatorId);
  const releaseFromConsolidation = useReleaseFromConsolidation(operatorId ?? '');

  if (!operatorId || kpisLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  const allZones = zones ?? [];
  const activeZones = allZones.filter((z) => !z.is_consolidation && z.is_active);

  // Collect all comunas covered by active zones
  const mappedComunas = new Set(allZones.flatMap((z) => z.comunas));
  // UnmappedComunasBanner: show comunas that appear in packages but have no zone.
  // For now we pass empty — actual unmapped detection belongs in a future enhancement.
  const unmappedComunas: string[] = [];
  void mappedComunas;

  return (
    <div className="p-4 sm:p-6 space-y-6 sm:space-y-8 max-w-6xl mx-auto">
      <div className="space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">Distribución</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/app/distribution/batch"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="sm:hidden">Lote</span>
            <span className="hidden sm:inline">Modo lote</span>
          </Link>
          <Link
            href="/app/distribution/quicksort"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
          >
            <Zap className="h-3.5 w-3.5" />
            <span className="sm:hidden">Rápido</span>
            <span className="hidden sm:inline">Modo rápido</span>
          </Link>
          <Link
            href="/app/distribution/settings"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="sm:hidden">Andenes</span>
            <span className="hidden sm:inline">Configurar andenes</span>
          </Link>
        </div>
      </div>

      <UnmappedComunasBanner unmappedComunas={unmappedComunas} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <MetricCard icon={Package} label="Pendientes de sectorizar" value={kpis?.pending ?? 0} />
        <MetricCard icon={Layers} label="En consolidación" value={kpis?.consolidation ?? 0} />
        <MetricCard
          icon={Clock}
          label="Próximos a despachar"
          value={kpis?.dueSoon ?? 0}
          className="border-status-warning-border bg-status-warning-bg"
        />
      </div>

      {activeZones.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Sin andenes configurados"
          description="Configura tus andenes para comenzar a sectorizar paquetes por zona de entrega."
          action={{ label: 'Configurar andenes', href: '/app/distribution/settings' }}
        />
      ) : (
        <DockZoneGrid zones={activeZones} />
      )}

      <ConsolidationPanel
        packages={consolidationPackages ?? []}
        onRelease={(ids) => releaseFromConsolidation.mutate(ids)}
      />
    </div>
  );
}
```

- [ ] **Step 4: Delete old DistributionKPIs files**

```bash
rm apps/frontend/src/components/distribution/DistributionKPIs.tsx
rm apps/frontend/src/components/distribution/DistributionKPIs.test.tsx
```

- [ ] **Step 5: Run page tests to verify they pass**

Run: `cd apps/frontend && npx vitest run src/app/app/distribution/page.test.tsx`
Expected: All 6 tests PASS

- [ ] **Step 6: Run all distribution tests to verify nothing broke**

Run: `cd apps/frontend && npx vitest run src/components/distribution/ src/app/app/distribution/`
Expected: All tests PASS (DockZoneGrid: 4, ConsolidationPanel: 4, page: 6, layout: 4)

- [ ] **Step 7: Commit**

```bash
git add -A apps/frontend/src/app/app/distribution/ apps/frontend/src/components/distribution/
git commit -m "feat(distribution): visual polish — MetricCards, button icons, EmptyState

- Replace DistributionKPIs with MetricCard (Package/Layers/Clock icons)
- Always-amber tint on dispatch KPI for visual landmark
- Add Lucide icons + responsive labels to action buttons
- Replace 3 inline empty states with EmptyState component
- Delete DistributionKPIs component (replaced by MetricCard)

Spec: docs/specs/spec-18-distribution-visual-polish.md"
```

---

## Chunk 4: Final verification

### Task 5: Full test suite + type check

- [ ] **Step 1: Run TypeScript compilation check**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: No errors (confirms no broken imports from deleted DistributionKPIs)

- [ ] **Step 2: Run full test suite**

Run: `cd apps/frontend && npx vitest run`
Expected: All tests PASS. No test should reference `DistributionKPIs` anymore.

- [ ] **Step 3: Run lint**

Run: `cd apps/frontend && npx next lint`
Expected: No errors

- [ ] **Step 4: Fix any issues found, commit if needed**

If any step above fails, fix the issue and create a new commit.

- [ ] **Step 5: Push and create PR**

```bash
git push origin HEAD
gh pr create --title "feat: distribution page visual polish (spec-18)" --body "## Summary
- Replace DistributionKPIs with MetricCard (icons, monospace values, uppercase labels)
- Always-amber tint on dispatch KPI card for visual landmark
- Add Lucide icons + responsive mobile labels to action buttons
- Replace 3 inline empty states with EmptyState component + Spanish copy

## Spec
docs/specs/spec-18-distribution-visual-polish.md

## Test plan
- [ ] All vitest tests pass (page, DockZoneGrid, ConsolidationPanel)
- [ ] TypeScript compiles without errors
- [ ] Visual check on mobile viewport (stacked KPIs, short button labels)
- [ ] Visual check on desktop (3-col KPIs, full button labels)
- [ ] Empty states show icon + description + CTA button

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr merge --auto --squash
```
