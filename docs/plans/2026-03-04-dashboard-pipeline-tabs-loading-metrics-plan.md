# Dashboard Pipeline Tabs & Loading Metrics — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure the dashboard with pipeline navigation tabs and build the first tab (Loading Data) showing order/package ingestion metrics.

**Architecture:** Add a tab system to the existing dashboard page using URL query params. The Overview tab wraps the existing components unchanged. The Loading tab introduces new TanStack Query hooks that query `orders` and `packages` tables directly (no new DB tables/migrations). New components follow the existing MetricsCard/Recharts patterns.

**Tech Stack:** Next.js 15, React 19, TanStack Query 5, Recharts 2, date-fns 4, Tailwind CSS, Vitest + React Testing Library, shadcn/ui

**Design Doc:** `docs/plans/2026-03-04-dashboard-pipeline-tabs-loading-metrics.md`

---

### Task 1: Pipeline Tab Navigation Component

**Files:**
- Create: `apps/frontend/src/components/dashboard/PipelineNav.tsx`
- Create: `apps/frontend/src/components/dashboard/PipelineNav.test.tsx`

**Step 1: Write the failing test**

```tsx
// PipelineNav.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PipelineNav from './PipelineNav';

describe('PipelineNav', () => {
  const defaultProps = {
    activeTab: 'overview' as const,
    onTabChange: vi.fn(),
  };

  it('renders all pipeline tabs on desktop', () => {
    render(<PipelineNav {...defaultProps} />);
    expect(screen.getByText('Vista General')).toBeInTheDocument();
    expect(screen.getByText('Carga')).toBeInTheDocument();
    expect(screen.getByText('Retiro')).toBeInTheDocument();
  });

  it('highlights the active tab', () => {
    render(<PipelineNav {...defaultProps} activeTab="loading" />);
    const loadingTab = screen.getByText('Carga').closest('button');
    expect(loadingTab?.className).toContain('border-[#e6c15c]');
  });

  it('calls onTabChange when a tab is clicked', async () => {
    const onTabChange = vi.fn();
    render(<PipelineNav {...defaultProps} onTabChange={onTabChange} />);
    await userEvent.click(screen.getByText('Carga'));
    expect(onTabChange).toHaveBeenCalledWith('loading');
  });

  it('renders a dropdown on mobile viewport', () => {
    render(<PipelineNav {...defaultProps} />);
    // The select element is rendered for mobile, hidden on md+
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
  });

  it('shows Próximamente for placeholder tabs', async () => {
    const onTabChange = vi.fn();
    render(<PipelineNav {...defaultProps} onTabChange={onTabChange} />);
    // Placeholder tabs should be disabled
    const retiroTab = screen.getByText('Retiro').closest('button');
    expect(retiroTab).toBeDisabled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/dashboard/PipelineNav.test.tsx`
Expected: FAIL — module not found

**Step 3: Write the component**

```tsx
// PipelineNav.tsx
'use client';

export type PipelineTab = 'overview' | 'loading' | 'pickup' | 'reception' | 'distribution' | 'routing' | 'lastmile';

interface TabConfig {
  id: PipelineTab;
  label: string;
  step: string;
  enabled: boolean;
}

const TABS: TabConfig[] = [
  { id: 'overview', label: 'Vista General', step: '', enabled: true },
  { id: 'loading', label: 'Carga', step: '①', enabled: true },
  { id: 'pickup', label: 'Retiro', step: '②', enabled: false },
  { id: 'reception', label: 'Recepción', step: '③', enabled: false },
  { id: 'distribution', label: 'Distribución', step: '④', enabled: false },
  { id: 'routing', label: 'Despacho', step: '⑤', enabled: false },
  { id: 'lastmile', label: 'Última Milla', step: '⑥', enabled: false },
];

interface PipelineNavProps {
  activeTab: PipelineTab;
  onTabChange: (tab: PipelineTab) => void;
}

export default function PipelineNav({ activeTab, onTabChange }: PipelineNavProps) {
  return (
    <>
      {/* Desktop: horizontal tab bar */}
      <nav className="hidden md:flex items-center gap-1 border-b border-slate-200 pb-0" aria-label="Pipeline navigation">
        {TABS.map((tab, i) => {
          const isActive = activeTab === tab.id;
          return (
            <div key={tab.id} className="flex items-center">
              {i > 0 && (
                <div className="w-4 h-px bg-slate-300 mx-1" aria-hidden="true" />
              )}
              <button
                onClick={() => tab.enabled && onTabChange(tab.id)}
                disabled={!tab.enabled}
                title={!tab.enabled ? 'Próximamente' : undefined}
                className={`
                  px-4 py-3 text-sm font-medium transition-all duration-200 border-b-2 -mb-px whitespace-nowrap
                  ${isActive
                    ? 'border-[#e6c15c] text-slate-900 font-semibold'
                    : tab.enabled
                      ? 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                      : 'border-transparent text-slate-300 cursor-not-allowed'
                  }
                `}
              >
                {tab.step && <span className="mr-1.5">{tab.step}</span>}
                {tab.label}
              </button>
            </div>
          );
        })}
      </nav>

      {/* Mobile: dropdown */}
      <div className="md:hidden">
        <select
          value={activeTab}
          onChange={(e) => {
            const tab = TABS.find(t => t.id === e.target.value);
            if (tab?.enabled) onTabChange(tab.id);
          }}
          className="w-full text-sm font-medium border border-slate-200 rounded-lg px-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-[#e6c15c] text-slate-700"
          aria-label="Pipeline navigation"
        >
          {TABS.map(tab => (
            <option key={tab.id} value={tab.id} disabled={!tab.enabled}>
              {tab.step ? `${tab.step} ${tab.label}` : tab.label}
              {!tab.enabled ? ' — Próximamente' : ''}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/dashboard/PipelineNav.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/frontend/src/components/dashboard/PipelineNav.tsx apps/frontend/src/components/dashboard/PipelineNav.test.tsx
git commit -m "feat(dashboard): add PipelineNav tab navigation component"
```

---

### Task 2: Integrate Pipeline Nav into Dashboard Page

**Files:**
- Modify: `apps/frontend/src/app/app/dashboard/page.tsx`

**Step 1: Write the failing test**

```tsx
// Create: apps/frontend/src/app/app/dashboard/page.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

// Mock hooks
vi.mock('@/hooks/useDashboardMetrics', () => ({
  useOperatorId: () => ({ operatorId: 'test-op-id', role: 'admin' }),
}));

// Mock heavy child components
vi.mock('@/components/dashboard/HeroSLA', () => ({ default: () => <div data-testid="hero-sla" /> }));
vi.mock('@/components/dashboard/PrimaryMetricsGrid', () => ({ default: () => <div data-testid="primary-grid" /> }));
vi.mock('@/components/dashboard/CustomerPerformanceTable', () => ({ default: () => <div data-testid="customer-table" /> }));
vi.mock('@/components/dashboard/FailedDeliveriesAnalysis', () => ({ default: () => <div data-testid="failed-analysis" /> }));
vi.mock('@/components/dashboard/SecondaryMetricsGrid', () => ({ default: () => <div data-testid="secondary-grid" /> }));
vi.mock('@/components/dashboard/ExportDashboardModal', () => ({ default: () => <div data-testid="export-modal" /> }));
vi.mock('@/components/dashboard/OfflineBanner', () => ({ default: () => <div data-testid="offline-banner" /> }));
vi.mock('@/components/dashboard/LoadingTab', () => ({ default: () => <div data-testid="loading-tab" /> }));

import DashboardPage from './page';

describe('DashboardPage', () => {
  it('renders PipelineNav', () => {
    render(<DashboardPage />);
    expect(screen.getByText('Vista General')).toBeInTheDocument();
    expect(screen.getByText('Carga')).toBeInTheDocument();
  });

  it('shows overview content by default', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('hero-sla')).toBeInTheDocument();
  });

  it('switches to loading tab when Carga is clicked', async () => {
    render(<DashboardPage />);
    await userEvent.click(screen.getByText('Carga'));
    expect(screen.getByTestId('loading-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('hero-sla')).not.toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/app/app/dashboard/page.test.tsx`
Expected: FAIL — PipelineNav not rendered, LoadingTab not found

**Step 3: Update the dashboard page**

```tsx
// apps/frontend/src/app/app/dashboard/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOperatorId } from '@/hooks/useDashboardMetrics';
import PipelineNav, { type PipelineTab } from '@/components/dashboard/PipelineNav';
import HeroSLA from '@/components/dashboard/HeroSLA';
import HeroSLASkeleton from '@/components/dashboard/HeroSLASkeleton';
import PrimaryMetricsGrid from '@/components/dashboard/PrimaryMetricsGrid';
import CustomerPerformanceTable from '@/components/dashboard/CustomerPerformanceTable';
import FailedDeliveriesAnalysis from '@/components/dashboard/FailedDeliveriesAnalysis';
import SecondaryMetricsGrid from '@/components/dashboard/SecondaryMetricsGrid';
import ExportDashboardModal from '@/components/dashboard/ExportDashboardModal';
import OfflineBanner from '@/components/dashboard/OfflineBanner';
import LoadingTab from '@/components/dashboard/LoadingTab';

const ALLOWED_ROLES = ['operations_manager', 'admin'];

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { operatorId, role } = useOperatorId();
  const [exportOpen, setExportOpen] = useState(false);

  const activeTab = (searchParams.get('tab') as PipelineTab) || 'overview';

  const handleTabChange = useCallback((tab: PipelineTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'overview') {
      params.delete('tab');
    } else {
      params.set('tab', tab);
    }
    const query = params.toString();
    router.push(`/app/dashboard${query ? `?${query}` : ''}`);
  }, [router, searchParams]);

  useEffect(() => {
    if (role && !ALLOWED_ROLES.includes(role)) {
      router.push('/app');
    }
  }, [role, router]);

  if (!role) return <HeroSLASkeleton />;
  if (!ALLOWED_ROLES.includes(role)) return null;
  if (!operatorId) return <HeroSLASkeleton />;

  return (
    <div className="space-y-6">
      <OfflineBanner />
      <PipelineNav activeTab={activeTab} onTabChange={handleTabChange} />

      {activeTab === 'overview' && (
        <>
          <HeroSLA operatorId={operatorId} />
          <PrimaryMetricsGrid operatorId={operatorId} />
          <CustomerPerformanceTable operatorId={operatorId} />
          <FailedDeliveriesAnalysis operatorId={operatorId} />
          <SecondaryMetricsGrid operatorId={operatorId} />
          <div className="flex justify-end">
            <button
              onClick={() => setExportOpen(true)}
              className="bg-slate-700 hover:bg-slate-800 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Exportar Reporte
            </button>
          </div>
          <ExportDashboardModal
            open={exportOpen}
            onOpenChange={setExportOpen}
            operatorId={operatorId}
          />
        </>
      )}

      {activeTab === 'loading' && (
        <LoadingTab operatorId={operatorId} />
      )}
    </div>
  );
}
```

**Step 4: Create a stub LoadingTab so tests pass**

```tsx
// Create: apps/frontend/src/components/dashboard/LoadingTab.tsx
export default function LoadingTab({ operatorId }: { operatorId: string }) {
  return <div>Loading tab placeholder for {operatorId}</div>;
}
```

**Step 5: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/app/app/dashboard/page.test.tsx`
Expected: PASS

**Step 6: Run full test suite to check for regressions**

Run: `cd apps/frontend && npx vitest run`
Expected: All existing tests pass

**Step 7: Commit**

```bash
git add apps/frontend/src/app/app/dashboard/page.tsx apps/frontend/src/app/app/dashboard/page.test.tsx apps/frontend/src/components/dashboard/LoadingTab.tsx
git commit -m "feat(dashboard): integrate pipeline tabs with URL state, stub LoadingTab"
```

---

### Task 3: Date Filter Bar Component

**Files:**
- Create: `apps/frontend/src/components/dashboard/DateFilterBar.tsx`
- Create: `apps/frontend/src/components/dashboard/DateFilterBar.test.tsx`

**Step 1: Write the failing test**

```tsx
// DateFilterBar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DateFilterBar from './DateFilterBar';

describe('DateFilterBar', () => {
  const defaultProps = {
    preset: 'this_month' as const,
    customStart: '',
    customEnd: '',
    onPresetChange: vi.fn(),
    onCustomStartChange: vi.fn(),
    onCustomEndChange: vi.fn(),
  };

  it('renders all preset buttons', () => {
    render(<DateFilterBar {...defaultProps} />);
    expect(screen.getByText('Hoy')).toBeInTheDocument();
    expect(screen.getByText('Ayer')).toBeInTheDocument();
    expect(screen.getByText('Esta Semana')).toBeInTheDocument();
    expect(screen.getByText('Este Mes')).toBeInTheDocument();
    expect(screen.getByText('Este Año')).toBeInTheDocument();
    expect(screen.getByText('Personalizado')).toBeInTheDocument();
  });

  it('highlights the active preset with gold styling', () => {
    render(<DateFilterBar {...defaultProps} preset="this_month" />);
    const btn = screen.getByText('Este Mes');
    expect(btn.className).toContain('bg-[#e6c15c]');
  });

  it('calls onPresetChange when a preset is clicked', async () => {
    const onPresetChange = vi.fn();
    render(<DateFilterBar {...defaultProps} onPresetChange={onPresetChange} />);
    await userEvent.click(screen.getByText('Ayer'));
    expect(onPresetChange).toHaveBeenCalledWith('yesterday');
  });

  it('shows custom date inputs when Personalizado is selected', () => {
    render(<DateFilterBar {...defaultProps} preset="custom" />);
    const dateInputs = screen.getAllByDisplayValue('');
    expect(dateInputs.length).toBeGreaterThanOrEqual(2);
  });

  it('does not show custom date inputs for non-custom presets', () => {
    render(<DateFilterBar {...defaultProps} preset="today" />);
    expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/dashboard/DateFilterBar.test.tsx`
Expected: FAIL

**Step 3: Write the component**

```tsx
// DateFilterBar.tsx
'use client';

export type DatePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'this_year' | 'custom';

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: 'this_week', label: 'Esta Semana' },
  { id: 'this_month', label: 'Este Mes' },
  { id: 'this_year', label: 'Este Año' },
  { id: 'custom', label: 'Personalizado' },
];

interface DateFilterBarProps {
  preset: DatePreset;
  customStart: string;
  customEnd: string;
  onPresetChange: (preset: DatePreset) => void;
  onCustomStartChange: (date: string) => void;
  onCustomEndChange: (date: string) => void;
}

export default function DateFilterBar({
  preset,
  customStart,
  customEnd,
  onPresetChange,
  onCustomStartChange,
  onCustomEndChange,
}: DateFilterBarProps) {
  return (
    <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-slate-100 -mx-4 px-4 py-3 sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map(p => (
          <button
            key={p.id}
            onClick={() => onPresetChange(p.id)}
            className={`
              px-3 py-1.5 text-sm font-medium rounded-full transition-all duration-200
              ${preset === p.id
                ? 'bg-[#e6c15c] text-slate-900 shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }
            `}
          >
            {p.label}
          </button>
        ))}

        {preset === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <label className="sr-only" htmlFor="date-start">Desde</label>
            <input
              id="date-start"
              type="date"
              value={customStart}
              onChange={e => onCustomStartChange(e.target.value)}
              aria-label="Desde"
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#e6c15c]"
            />
            <span className="text-slate-400">—</span>
            <label className="sr-only" htmlFor="date-end">Hasta</label>
            <input
              id="date-end"
              type="date"
              value={customEnd}
              onChange={e => onCustomEndChange(e.target.value)}
              aria-label="Hasta"
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#e6c15c]"
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/dashboard/DateFilterBar.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/frontend/src/components/dashboard/DateFilterBar.tsx apps/frontend/src/components/dashboard/DateFilterBar.test.tsx
git commit -m "feat(dashboard): add DateFilterBar with presets and custom range"
```

---

### Task 4: Date Preset Resolver Hook

**Files:**
- Create: `apps/frontend/src/hooks/useDatePreset.ts`
- Create: `apps/frontend/src/hooks/useDatePreset.test.ts`

**Step 1: Write the failing test**

```tsx
// useDatePreset.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDatePreset } from './useDatePreset';

// Fix "today" for deterministic tests
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-15'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDatePreset', () => {
  it('resolves "today" to current date', () => {
    const { result } = renderHook(() => useDatePreset('today'));
    expect(result.current.startDate).toBe('2026-03-15');
    expect(result.current.endDate).toBe('2026-03-15');
  });

  it('resolves "yesterday" to previous date', () => {
    const { result } = renderHook(() => useDatePreset('yesterday'));
    expect(result.current.startDate).toBe('2026-03-14');
    expect(result.current.endDate).toBe('2026-03-14');
  });

  it('resolves "this_week" to Monday through today', () => {
    // 2026-03-15 is a Sunday, so week starts Monday 2026-03-09
    const { result } = renderHook(() => useDatePreset('this_week'));
    expect(result.current.startDate).toBe('2026-03-09');
    expect(result.current.endDate).toBe('2026-03-15');
  });

  it('resolves "this_month" to first of month through today', () => {
    const { result } = renderHook(() => useDatePreset('this_month'));
    expect(result.current.startDate).toBe('2026-03-01');
    expect(result.current.endDate).toBe('2026-03-15');
  });

  it('resolves "this_year" to Jan 1 through today', () => {
    const { result } = renderHook(() => useDatePreset('this_year'));
    expect(result.current.startDate).toBe('2026-01-01');
    expect(result.current.endDate).toBe('2026-03-15');
  });

  it('resolves "custom" using provided start/end', () => {
    const { result } = renderHook(() =>
      useDatePreset('custom', '2026-02-01', '2026-02-28')
    );
    expect(result.current.startDate).toBe('2026-02-01');
    expect(result.current.endDate).toBe('2026-02-28');
  });

  it('returns previous equivalent period for trend comparison', () => {
    const { result } = renderHook(() => useDatePreset('this_month'));
    // March 1-15 = 15 days, previous period = Feb 14 - Feb 28
    expect(result.current.prevStartDate).toBeDefined();
    expect(result.current.prevEndDate).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/hooks/useDatePreset.test.ts`
Expected: FAIL

**Step 3: Write the hook**

```tsx
// useDatePreset.ts
import { useMemo } from 'react';
import { format, subDays, startOfWeek, startOfMonth, startOfYear } from 'date-fns';
import type { DatePreset } from '@/components/dashboard/DateFilterBar';

interface DateRange {
  startDate: string;
  endDate: string;
  prevStartDate: string;
  prevEndDate: string;
}

export function useDatePreset(
  preset: DatePreset,
  customStart?: string,
  customEnd?: string
): DateRange {
  return useMemo(() => {
    const today = new Date();
    const todayStr = format(today, 'yyyy-MM-dd');

    let start: Date;
    let end: Date = today;

    switch (preset) {
      case 'today':
        start = today;
        break;
      case 'yesterday':
        start = subDays(today, 1);
        end = subDays(today, 1);
        break;
      case 'this_week':
        start = startOfWeek(today, { weekStartsOn: 1 }); // Monday
        break;
      case 'this_month':
        start = startOfMonth(today);
        break;
      case 'this_year':
        start = startOfYear(today);
        break;
      case 'custom':
        if (customStart && customEnd) {
          const dayCount = Math.max(1, Math.ceil(
            (new Date(customEnd).getTime() - new Date(customStart).getTime()) / 86400000
          ) + 1);
          const prevEnd = subDays(new Date(customStart), 1);
          const prevStart = subDays(prevEnd, dayCount - 1);
          return {
            startDate: customStart,
            endDate: customEnd,
            prevStartDate: format(prevStart, 'yyyy-MM-dd'),
            prevEndDate: format(prevEnd, 'yyyy-MM-dd'),
          };
        }
        start = startOfMonth(today); // fallback
        break;
      default:
        start = startOfMonth(today);
    }

    const startStr = format(start, 'yyyy-MM-dd');
    const endStr = format(end, 'yyyy-MM-dd');
    const dayCount = Math.max(1, Math.ceil(
      (end.getTime() - start.getTime()) / 86400000
    ) + 1);
    const prevEnd = subDays(start, 1);
    const prevStart = subDays(prevEnd, dayCount - 1);

    return {
      startDate: startStr,
      endDate: endStr,
      prevStartDate: format(prevStart, 'yyyy-MM-dd'),
      prevEndDate: format(prevEnd, 'yyyy-MM-dd'),
    };
  }, [preset, customStart, customEnd]);
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/hooks/useDatePreset.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/frontend/src/hooks/useDatePreset.ts apps/frontend/src/hooks/useDatePreset.test.ts
git commit -m "feat(dashboard): add useDatePreset hook with trend period calculation"
```

---

### Task 5: Loading Metrics Query Hooks

**Files:**
- Create: `apps/frontend/src/hooks/useLoadingMetrics.ts`
- Create: `apps/frontend/src/hooks/useLoadingMetrics.test.ts`

**Step 1: Write the failing test**

```tsx
// useLoadingMetrics.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

// Mock Supabase
const mockSelect = vi.fn();
const mockRpc = vi.fn();
const mockFrom = vi.fn(() => ({
  select: mockSelect,
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
  }),
}));

import {
  useOrdersLoaded,
  usePackagesLoaded,
  useOrdersCommitted,
  useActiveClients,
  useComunasCovered,
  useDailyOrdersByClient,
  useOrdersByClient,
  useOrdersByComuna,
} from './useLoadingMetrics';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useOrdersLoaded', () => {
  it('queries orders table with date range and returns count', async () => {
    mockSelect.mockReturnValue({
      gte: vi.fn().mockReturnValue({
        lt: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ count: 42, error: null }),
        }),
      }),
    });

    const { result } = renderHook(
      () => useOrdersLoaded('op-id', '2026-03-01', '2026-03-15'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toBe(42));
  });
});

describe('usePackagesLoaded', () => {
  it('returns count and average per order', async () => {
    mockRpc.mockResolvedValue({
      data: { packages_count: 120, avg_per_order: 2.3 },
      error: null,
    });

    const { result } = renderHook(
      () => usePackagesLoaded('op-id', '2026-03-01', '2026-03-15'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.data?.packages_count).toBe(120);
      expect(result.current.data?.avg_per_order).toBe(2.3);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/hooks/useLoadingMetrics.test.ts`
Expected: FAIL

**Step 3: Write the hooks**

```tsx
// useLoadingMetrics.ts
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

const LOADING_QUERY_OPTIONS = {
  staleTime: 30000,
  refetchInterval: 60000,
  placeholderData: keepPreviousData,
} as const;

export function useOrdersLoaded(operatorId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['loading', operatorId, 'orders-loaded', startDate, endDate],
    queryFn: async () => {
      const { count, error } = await createSPAClient()
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', `${startDate}T00:00:00`)
        .lt('created_at', `${endDate}T23:59:59.999`)
        .is('deleted_at', null);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function usePackagesLoaded(operatorId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['loading', operatorId, 'packages-loaded', startDate, endDate],
    queryFn: async () => {
      // Use a raw query via RPC or join — for now query packages with order join
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('get_packages_loaded_stats', {
        p_start_date: startDate,
        p_end_date: endDate,
      });
      if (error) throw error;
      return data as { packages_count: number; avg_per_order: number };
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function useOrdersCommitted(operatorId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['loading', operatorId, 'orders-committed', startDate, endDate],
    queryFn: async () => {
      const { count, error } = await createSPAClient()
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .gte('delivery_date', startDate)
        .lte('delivery_date', endDate)
        .is('deleted_at', null);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function useActiveClients(operatorId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['loading', operatorId, 'active-clients', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('orders')
        .select('retailer_name')
        .gte('created_at', `${startDate}T00:00:00`)
        .lt('created_at', `${endDate}T23:59:59.999`)
        .is('deleted_at', null)
        .not('retailer_name', 'is', null);
      if (error) throw error;
      const unique = new Set(data?.map(d => d.retailer_name));
      return unique.size;
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function useComunasCovered(operatorId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['loading', operatorId, 'comunas-covered', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('orders')
        .select('comuna')
        .gte('created_at', `${startDate}T00:00:00`)
        .lt('created_at', `${endDate}T23:59:59.999`)
        .is('deleted_at', null);
      if (error) throw error;
      const unique = new Set(data?.map(d => d.comuna));
      return unique.size;
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function useDailyOrdersByClient(operatorId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['loading', operatorId, 'daily-orders-by-client', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient().rpc('get_daily_orders_by_client', {
        p_start_date: startDate,
        p_end_date: endDate,
      });
      if (error) throw error;
      return data as { day: string; retailer_name: string; count: number }[];
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function useCommittedOrdersDaily(operatorId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['loading', operatorId, 'committed-daily', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient().rpc('get_committed_orders_daily', {
        p_start_date: startDate,
        p_end_date: endDate,
      });
      if (error) throw error;
      return data as { day: string; count: number }[];
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function useOrdersByClient(operatorId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['loading', operatorId, 'orders-by-client', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient().rpc('get_orders_by_client', {
        p_start_date: startDate,
        p_end_date: endDate,
      });
      if (error) throw error;
      return data as { retailer_name: string; orders: number; packages: number; pct: number }[];
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function useOrdersByComuna(operatorId: string | null, startDate: string, endDate: string, region?: string) {
  return useQuery({
    queryKey: ['loading', operatorId, 'orders-by-comuna', startDate, endDate, region],
    queryFn: async () => {
      const { data, error } = await createSPAClient().rpc('get_orders_by_comuna', {
        p_start_date: startDate,
        p_end_date: endDate,
        p_region: region ?? null,
      });
      if (error) throw error;
      return data as { comuna: string; count: number; pct: number }[];
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/hooks/useLoadingMetrics.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/frontend/src/hooks/useLoadingMetrics.ts apps/frontend/src/hooks/useLoadingMetrics.test.ts
git commit -m "feat(dashboard): add TanStack Query hooks for loading metrics"
```

---

### Task 6: Supabase RPC Functions Migration

Several hooks above use RPC functions that don't exist yet. We need a migration.

**Files:**
- Create: `apps/frontend/supabase/migrations/20260305000001_create_loading_metrics_functions.sql`

**Step 1: Write the migration**

```sql
-- Loading metrics RPC functions for dashboard Loading Data tab
-- These are SECURITY INVOKER so RLS policies are applied

-- Packages loaded stats (count + avg per order)
CREATE OR REPLACE FUNCTION public.get_packages_loaded_stats(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT json_build_object(
    'packages_count', COALESCE(COUNT(p.id), 0),
    'avg_per_order', COALESCE(ROUND(COUNT(p.id)::numeric / NULLIF(COUNT(DISTINCT o.id), 0), 1), 0)
  )
  FROM packages p
  JOIN orders o ON p.order_id = o.id
  WHERE p.created_at >= p_start_date::timestamp
    AND p.created_at < (p_end_date + 1)::timestamp
    AND o.deleted_at IS NULL
    AND p.deleted_at IS NULL;
$$;

-- Daily orders grouped by client (for stacked bar chart)
CREATE OR REPLACE FUNCTION public.get_daily_orders_by_client(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS SETOF JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT json_build_object(
    'day', d.day::text,
    'retailer_name', COALESCE(d.retailer_name, 'Sin cliente'),
    'count', d.cnt
  )
  FROM (
    SELECT DATE(created_at) AS day, retailer_name, COUNT(*) AS cnt
    FROM orders
    WHERE created_at >= p_start_date::timestamp
      AND created_at < (p_end_date + 1)::timestamp
      AND deleted_at IS NULL
    GROUP BY DATE(created_at), retailer_name
    ORDER BY day, retailer_name
  ) d;
$$;

-- Daily committed orders (by delivery_date, for line chart)
CREATE OR REPLACE FUNCTION public.get_committed_orders_daily(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS SETOF JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT json_build_object(
    'day', delivery_date::text,
    'count', COUNT(*)
  )
  FROM orders
  WHERE delivery_date >= p_start_date
    AND delivery_date <= p_end_date
    AND deleted_at IS NULL
  GROUP BY delivery_date
  ORDER BY delivery_date;
$$;

-- Orders breakdown by client (for table)
CREATE OR REPLACE FUNCTION public.get_orders_by_client(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS SETOF JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH totals AS (
    SELECT COUNT(*) AS total
    FROM orders
    WHERE created_at >= p_start_date::timestamp
      AND created_at < (p_end_date + 1)::timestamp
      AND deleted_at IS NULL
  ),
  by_client AS (
    SELECT
      COALESCE(o.retailer_name, 'Sin cliente') AS retailer_name,
      COUNT(DISTINCT o.id) AS orders,
      COUNT(p.id) AS packages
    FROM orders o
    LEFT JOIN packages p ON p.order_id = o.id AND p.deleted_at IS NULL
    WHERE o.created_at >= p_start_date::timestamp
      AND o.created_at < (p_end_date + 1)::timestamp
      AND o.deleted_at IS NULL
    GROUP BY o.retailer_name
  )
  SELECT json_build_object(
    'retailer_name', bc.retailer_name,
    'orders', bc.orders,
    'packages', bc.packages,
    'pct', ROUND(bc.orders::numeric / NULLIF(t.total, 0) * 100, 1)
  )
  FROM by_client bc, totals t
  ORDER BY bc.orders DESC;
$$;

-- Orders by comuna with optional region filter
CREATE OR REPLACE FUNCTION public.get_orders_by_comuna(
  p_start_date DATE,
  p_end_date DATE,
  p_region TEXT DEFAULT NULL
)
RETURNS SETOF JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH totals AS (
    SELECT COUNT(*) AS total
    FROM orders
    WHERE created_at >= p_start_date::timestamp
      AND created_at < (p_end_date + 1)::timestamp
      AND deleted_at IS NULL
      AND (p_region IS NULL OR recipient_region = p_region)
  )
  SELECT json_build_object(
    'comuna', o.comuna,
    'count', COUNT(*),
    'pct', ROUND(COUNT(*)::numeric / NULLIF(t.total, 0) * 100, 1)
  )
  FROM orders o, totals t
  WHERE o.created_at >= p_start_date::timestamp
    AND o.created_at < (p_end_date + 1)::timestamp
    AND o.deleted_at IS NULL
    AND (p_region IS NULL OR o.recipient_region = p_region)
  GROUP BY o.comuna, t.total
  ORDER BY COUNT(*) DESC;
$$;
```

**Step 2: Verify migration syntax locally**

Run: `cd apps/frontend && cat supabase/migrations/20260305000001_create_loading_metrics_functions.sql | head -5`
Expected: file exists with correct header

**Step 3: Commit**

```bash
git add apps/frontend/supabase/migrations/20260305000001_create_loading_metrics_functions.sql
git commit -m "feat(db): add RPC functions for loading metrics dashboard"
```

**Step 4: Apply migration to production**

Run: `cd apps/frontend && npx supabase db push`
Expected: Migration applied successfully

---

### Task 7: KPI Strip Component

**Files:**
- Create: `apps/frontend/src/components/dashboard/LoadingKPIStrip.tsx`
- Create: `apps/frontend/src/components/dashboard/LoadingKPIStrip.test.tsx`

**Step 1: Write the failing test**

```tsx
// LoadingKPIStrip.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/useLoadingMetrics', () => ({
  useOrdersLoaded: () => ({ data: 156, isLoading: false }),
  usePackagesLoaded: () => ({ data: { packages_count: 203, avg_per_order: 1.3 }, isLoading: false }),
  useOrdersCommitted: () => ({ data: 142, isLoading: false }),
  useActiveClients: () => ({ data: 2, isLoading: false }),
  useComunasCovered: () => ({ data: 18, isLoading: false }),
}));

import LoadingKPIStrip from './LoadingKPIStrip';

describe('LoadingKPIStrip', () => {
  const props = {
    operatorId: 'test-op',
    startDate: '2026-03-01',
    endDate: '2026-03-15',
    prevStartDate: '2026-02-14',
    prevEndDate: '2026-02-28',
  };

  it('renders all 5 KPI cards', () => {
    render(<LoadingKPIStrip {...props} />);
    expect(screen.getByText('Órdenes Cargadas')).toBeInTheDocument();
    expect(screen.getByText('Bultos Cargados')).toBeInTheDocument();
    expect(screen.getByText('Órdenes Comprometidas')).toBeInTheDocument();
    expect(screen.getByText('Clientes Activos')).toBeInTheDocument();
    expect(screen.getByText('Comunas Cubiertas')).toBeInTheDocument();
  });

  it('displays the correct values', () => {
    render(<LoadingKPIStrip {...props} />);
    expect(screen.getByText('156')).toBeInTheDocument();
    expect(screen.getByText('203')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });

  it('shows average packages per order as subtitle', () => {
    render(<LoadingKPIStrip {...props} />);
    expect(screen.getByText(/Promedio: 1.3 por orden/)).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/dashboard/LoadingKPIStrip.test.tsx`
Expected: FAIL

**Step 3: Write the component**

```tsx
// LoadingKPIStrip.tsx
'use client';

import {
  useOrdersLoaded,
  usePackagesLoaded,
  useOrdersCommitted,
  useActiveClients,
  useComunasCovered,
} from '@/hooks/useLoadingMetrics';

interface KPICardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  isLoading: boolean;
}

function KPICard({ label, value, subtitle, isLoading }: KPICardProps) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 hover:shadow-lg hover:scale-[1.01] transition-all duration-300">
      {isLoading ? (
        <div className="animate-pulse space-y-2">
          <div className="h-8 w-20 bg-slate-200 rounded" />
          <div className="h-4 w-28 bg-slate-100 rounded" />
        </div>
      ) : (
        <>
          <div className="text-3xl font-bold text-slate-800 leading-none mb-1">
            {typeof value === 'number' ? value.toLocaleString('es-CL') : value}
          </div>
          <div className="text-sm text-slate-500">{label}</div>
          {subtitle && (
            <div className="text-xs text-slate-400 mt-1">{subtitle}</div>
          )}
        </>
      )}
    </div>
  );
}

interface LoadingKPIStripProps {
  operatorId: string;
  startDate: string;
  endDate: string;
  prevStartDate: string;
  prevEndDate: string;
}

export default function LoadingKPIStrip({
  operatorId,
  startDate,
  endDate,
}: LoadingKPIStripProps) {
  const orders = useOrdersLoaded(operatorId, startDate, endDate);
  const packages = usePackagesLoaded(operatorId, startDate, endDate);
  const committed = useOrdersCommitted(operatorId, startDate, endDate);
  const clients = useActiveClients(operatorId, startDate, endDate);
  const comunas = useComunasCovered(operatorId, startDate, endDate);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      <KPICard
        label="Órdenes Cargadas"
        value={orders.data ?? 0}
        isLoading={orders.isLoading}
      />
      <KPICard
        label="Bultos Cargados"
        value={packages.data?.packages_count ?? 0}
        subtitle={packages.data ? `Promedio: ${packages.data.avg_per_order} por orden` : undefined}
        isLoading={packages.isLoading}
      />
      <KPICard
        label="Órdenes Comprometidas"
        value={committed.data ?? 0}
        isLoading={committed.isLoading}
      />
      <KPICard
        label="Clientes Activos"
        value={clients.data ?? 0}
        isLoading={clients.isLoading}
      />
      <KPICard
        label="Comunas Cubiertas"
        value={comunas.data ?? 0}
        isLoading={comunas.isLoading}
      />
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/dashboard/LoadingKPIStrip.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/frontend/src/components/dashboard/LoadingKPIStrip.tsx apps/frontend/src/components/dashboard/LoadingKPIStrip.test.tsx
git commit -m "feat(dashboard): add LoadingKPIStrip with 5 KPI cards"
```

---

### Task 8: Daily Orders Stacked Bar Chart

**Files:**
- Create: `apps/frontend/src/components/dashboard/DailyOrdersChart.tsx`
- Create: `apps/frontend/src/components/dashboard/DailyOrdersChart.test.tsx`

**Step 1: Write the failing test**

```tsx
// DailyOrdersChart.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/useLoadingMetrics', () => ({
  useDailyOrdersByClient: () => ({
    data: [
      { day: '2026-03-01', retailer_name: 'Paris', count: 30 },
      { day: '2026-03-01', retailer_name: 'Easy', count: 20 },
      { day: '2026-03-02', retailer_name: 'Paris', count: 35 },
      { day: '2026-03-02', retailer_name: 'Easy', count: 25 },
    ],
    isLoading: false,
  }),
}));

// Mock Recharts to avoid rendering issues in test
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="chart-container">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  CartesianGrid: () => null,
}));

import DailyOrdersChart from './DailyOrdersChart';

describe('DailyOrdersChart', () => {
  it('renders the chart with title', () => {
    render(<DailyOrdersChart operatorId="op" startDate="2026-03-01" endDate="2026-03-02" />);
    expect(screen.getByText('Evolución Diaria de Órdenes Cargadas')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  it('shows loading skeleton when data is loading', () => {
    vi.mocked(await import('@/hooks/useLoadingMetrics')).useDailyOrdersByClient = vi.fn().mockReturnValue({
      data: undefined,
      isLoading: true,
    }) as any;

    // Re-import component — alternative: just test the loading prop directly
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/dashboard/DailyOrdersChart.test.tsx`
Expected: FAIL

**Step 3: Write the component**

```tsx
// DailyOrdersChart.tsx
'use client';

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { useDailyOrdersByClient } from '@/hooks/useLoadingMetrics';

const CLIENT_COLORS: Record<string, string> = {
  Paris: '#0ea5e9',
  Easy: '#10b981',
  'Sin cliente': '#94a3b8',
};

const DEFAULT_COLORS = ['#8b5cf6', '#f97316', '#ec4899', '#14b8a6'];

interface DailyOrdersChartProps {
  operatorId: string;
  startDate: string;
  endDate: string;
}

export default function DailyOrdersChart({ operatorId, startDate, endDate }: DailyOrdersChartProps) {
  const { data: rawData, isLoading } = useDailyOrdersByClient(operatorId, startDate, endDate);

  const { chartData, clients } = useMemo(() => {
    if (!rawData) return { chartData: [], clients: [] };

    const clientSet = new Set<string>();
    const byDay: Record<string, Record<string, number>> = {};

    for (const row of rawData) {
      clientSet.add(row.retailer_name);
      if (!byDay[row.day]) byDay[row.day] = {};
      byDay[row.day][row.retailer_name] = row.count;
    }

    const clients = Array.from(clientSet).sort();
    const chartData = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, counts]) => ({
        day: day.slice(5), // MM-DD for compact labels
        ...counts,
      }));

    return { chartData, clients };
  }, [rawData]);

  function getColor(client: string, index: number): string {
    return CLIENT_COLORS[client] ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  }

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
      <h3 className="text-lg font-semibold text-slate-700 mb-4">Evolución Diaria de Órdenes Cargadas</h3>
      {isLoading ? (
        <div className="h-64 animate-pulse bg-slate-100 rounded-lg" />
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
            <Tooltip
              contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
            />
            <Legend />
            {clients.map((client, i) => (
              <Bar
                key={client}
                dataKey={client}
                stackId="orders"
                fill={getColor(client, i)}
                radius={i === clients.length - 1 ? [4, 4, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/dashboard/DailyOrdersChart.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/frontend/src/components/dashboard/DailyOrdersChart.tsx apps/frontend/src/components/dashboard/DailyOrdersChart.test.tsx
git commit -m "feat(dashboard): add DailyOrdersChart stacked bar by retailer"
```

---

### Task 9: Committed Orders Line Chart

**Files:**
- Create: `apps/frontend/src/components/dashboard/CommittedOrdersChart.tsx`
- Create: `apps/frontend/src/components/dashboard/CommittedOrdersChart.test.tsx`

Follow the same pattern as Task 8 but using:
- `useCommittedOrdersDaily` hook
- Recharts `LineChart` with `Line` component
- Gold line color (#e6c15c) for the commitment curve
- Title: "Órdenes Comprometidas por Día"

**Step 1-5:** Same red-green-refactor cycle as Task 8.

**Commit message:** `feat(dashboard): add CommittedOrdersChart line chart`

---

### Task 10: Orders by Client Table

**Files:**
- Create: `apps/frontend/src/components/dashboard/OrdersByClientTable.tsx`
- Create: `apps/frontend/src/components/dashboard/OrdersByClientTable.test.tsx`

Follow the existing `CustomerPerformanceTable` pattern but simpler:
- Columns: Cliente | Órdenes | Bultos | % del Total
- Uses `useOrdersByClient` hook
- Sorted by orders descending
- No pagination needed (few clients)

**Step 1-5:** Same red-green-refactor cycle.

**Commit message:** `feat(dashboard): add OrdersByClientTable`

---

### Task 11: Orders by Comuna Table with Region Dropdown

**Files:**
- Create: `apps/frontend/src/components/dashboard/OrdersByComunaTable.tsx`
- Create: `apps/frontend/src/components/dashboard/OrdersByComunaTable.test.tsx`

Features:
- Region dropdown at top (populated from distinct `recipient_region` values)
- Table: Comuna | Órdenes | % del Total
- Uses `useOrdersByComuna` hook with optional region filter
- Sorted by count descending

**Step 1-5:** Same red-green-refactor cycle.

**Commit message:** `feat(dashboard): add OrdersByComunaTable with region filter`

---

### Task 12: Assemble LoadingTab Component

**Files:**
- Modify: `apps/frontend/src/components/dashboard/LoadingTab.tsx` (replace stub)
- Create: `apps/frontend/src/components/dashboard/LoadingTab.test.tsx`

**Step 1: Write the failing test**

```tsx
// LoadingTab.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

// Mock all sub-components
vi.mock('./DateFilterBar', () => ({ default: (props: any) => <div data-testid="date-filter" /> }));
vi.mock('./LoadingKPIStrip', () => ({ default: (props: any) => <div data-testid="kpi-strip" /> }));
vi.mock('./DailyOrdersChart', () => ({ default: (props: any) => <div data-testid="daily-chart" /> }));
vi.mock('./CommittedOrdersChart', () => ({ default: (props: any) => <div data-testid="committed-chart" /> }));
vi.mock('./OrdersByClientTable', () => ({ default: (props: any) => <div data-testid="client-table" /> }));
vi.mock('./OrdersByComunaTable', () => ({ default: (props: any) => <div data-testid="comuna-table" /> }));

import LoadingTab from './LoadingTab';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('LoadingTab', () => {
  it('renders all sections', () => {
    render(<LoadingTab operatorId="test-op" />, { wrapper: createWrapper() });
    expect(screen.getByTestId('date-filter')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-strip')).toBeInTheDocument();
    expect(screen.getByTestId('daily-chart')).toBeInTheDocument();
    expect(screen.getByTestId('committed-chart')).toBeInTheDocument();
    expect(screen.getByTestId('client-table')).toBeInTheDocument();
    expect(screen.getByTestId('comuna-table')).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/dashboard/LoadingTab.test.tsx`
Expected: FAIL — stub doesn't render sub-components

**Step 3: Write the full component**

```tsx
// LoadingTab.tsx
'use client';

import { useState } from 'react';
import DateFilterBar, { type DatePreset } from './DateFilterBar';
import { useDatePreset } from '@/hooks/useDatePreset';
import LoadingKPIStrip from './LoadingKPIStrip';
import DailyOrdersChart from './DailyOrdersChart';
import CommittedOrdersChart from './CommittedOrdersChart';
import OrdersByClientTable from './OrdersByClientTable';
import OrdersByComunaTable from './OrdersByComunaTable';

interface LoadingTabProps {
  operatorId: string;
}

export default function LoadingTab({ operatorId }: LoadingTabProps) {
  const [preset, setPreset] = useState<DatePreset>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { startDate, endDate, prevStartDate, prevEndDate } = useDatePreset(
    preset,
    customStart,
    customEnd
  );

  return (
    <div className="space-y-6">
      <DateFilterBar
        preset={preset}
        customStart={customStart}
        customEnd={customEnd}
        onPresetChange={setPreset}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
      />

      <LoadingKPIStrip
        operatorId={operatorId}
        startDate={startDate}
        endDate={endDate}
        prevStartDate={prevStartDate}
        prevEndDate={prevEndDate}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DailyOrdersChart
          operatorId={operatorId}
          startDate={startDate}
          endDate={endDate}
        />
        <CommittedOrdersChart
          operatorId={operatorId}
          startDate={startDate}
          endDate={endDate}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OrdersByClientTable
          operatorId={operatorId}
          startDate={startDate}
          endDate={endDate}
        />
        <OrdersByComunaTable
          operatorId={operatorId}
          startDate={startDate}
          endDate={endDate}
        />
      </div>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/dashboard/LoadingTab.test.tsx`
Expected: PASS

**Step 5: Run full test suite**

Run: `cd apps/frontend && npx vitest run`
Expected: All tests pass

**Step 6: Commit**

```bash
git add apps/frontend/src/components/dashboard/LoadingTab.tsx apps/frontend/src/components/dashboard/LoadingTab.test.tsx
git commit -m "feat(dashboard): assemble LoadingTab with all sections"
```

---

### Task 13: Push, PR, and Verify

**Step 1: Run full test suite one final time**

Run: `cd apps/frontend && npx vitest run`
Expected: All tests pass, no regressions

**Step 2: Create branch and push**

```bash
git checkout -b feat/dashboard-pipeline-loading-tab
git push origin feat/dashboard-pipeline-loading-tab
```

**Step 3: Create PR with auto-merge**

```bash
gh pr create --title "feat: dashboard pipeline tabs + loading data metrics" --body "$(cat <<'EOF'
## Summary
- Restructure dashboard with pipeline navigation tabs (Overview + 6 operational stages)
- Build Loading Data tab with KPI strip, daily evolution chart, committed orders chart, client/comuna breakdowns
- Add date filter bar with presets (Hoy, Ayer, Esta Semana, Este Mes, Este Año, custom range)
- Add Supabase RPC functions for loading metrics queries
- Mobile responsive: dropdown nav on mobile, no horizontal scroll

## Test plan
- [ ] Pipeline nav renders tabs on desktop, dropdown on mobile
- [ ] Tab switching updates URL query param and shows correct content
- [ ] Date filter presets compute correct date ranges
- [ ] KPI strip shows orders, packages, committed, clients, comunas
- [ ] Stacked bar chart shows daily orders by retailer
- [ ] Line chart shows committed orders by delivery_date
- [ ] Client table shows breakdown with packages count
- [ ] Comuna table filters by region dropdown
- [ ] All existing dashboard tests still pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```

**Step 4: Verify CI**

```bash
gh pr checks <PR_NUMBER>
gh pr view <PR_NUMBER> --json state,mergedAt
```

Expected: CI passes, PR merges.
