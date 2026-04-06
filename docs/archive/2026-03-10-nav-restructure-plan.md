# Nav Restructure: Sidebar Sub-Items Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move Operaciones and Analítica from a single horizontal tab bar into two sidebar sub-items under Dashboard, each with its own sub-route and sub-tab bar.

**Architecture:** Split `/app/dashboard` into `/app/dashboard/operaciones` and `/app/dashboard/analitica`. The sidebar's "Dashboard" item becomes a collapsible group. PipelineNav is replaced by a reusable `SubTabNav` that accepts a `tabs` prop.

**Tech Stack:** Next.js 15 (App Router), React 19, Tailwind CSS, Vitest + RTL

---

### Task 1: Create SubTabNav component (TDD)

**Files:**
- Create: `apps/frontend/src/components/dashboard/SubTabNav.tsx`
- Create: `apps/frontend/src/components/dashboard/SubTabNav.test.tsx`

**Step 1: Write the failing test**

```tsx
// apps/frontend/src/components/dashboard/SubTabNav.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SubTabNav from './SubTabNav';

const TABS = [
  { id: 'tab_a', label: 'Tab A', enabled: true },
  { id: 'tab_b', label: 'Tab B', enabled: true },
  { id: 'tab_c', label: 'Tab C', enabled: false },
];

describe('SubTabNav', () => {
  it('renders all tab labels', () => {
    render(<SubTabNav tabs={TABS} activeTab="tab_a" onTabChange={() => {}} />);
    expect(screen.getByText('Tab A')).toBeDefined();
    expect(screen.getByText('Tab B')).toBeDefined();
    expect(screen.getByText('Tab C')).toBeDefined();
  });

  it('highlights the active tab', () => {
    render(<SubTabNav tabs={TABS} activeTab="tab_a" onTabChange={() => {}} />);
    const activeBtn = screen.getByRole('tab', { name: 'Tab A' });
    expect(activeBtn.getAttribute('aria-selected')).toBe('true');
  });

  it('calls onTabChange when clicking an enabled tab', () => {
    const onChange = vi.fn();
    render(<SubTabNav tabs={TABS} activeTab="tab_a" onTabChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tab B' }));
    expect(onChange).toHaveBeenCalledWith('tab_b');
  });

  it('does not call onTabChange when clicking a disabled tab', () => {
    const onChange = vi.fn();
    render(<SubTabNav tabs={TABS} activeTab="tab_a" onTabChange={onChange} />);
    const disabledBtn = screen.getByRole('tab', { name: /Tab C/ });
    fireEvent.click(disabledBtn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders mobile dropdown', () => {
    render(<SubTabNav tabs={TABS} activeTab="tab_a" onTabChange={() => {}} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/dashboard/SubTabNav.test.tsx --pool=threads`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```tsx
// apps/frontend/src/components/dashboard/SubTabNav.tsx
'use client';

import React from 'react';

export interface TabDefinition {
  id: string;
  label: string;
  enabled: boolean;
  step?: string; // e.g. '①' for pipeline steps
}

interface SubTabNavProps {
  tabs: TabDefinition[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export default function SubTabNav({ tabs, activeTab, onTabChange }: SubTabNavProps) {
  return (
    <div>
      {/* Mobile dropdown */}
      <select
        className="md:hidden w-full text-sm font-medium border border-slate-200 rounded-lg px-4 py-3 bg-white focus:ring-2 focus:ring-[#e6c15c]"
        value={activeTab}
        onChange={(e) => onTabChange(e.target.value)}
        role="combobox"
      >
        {tabs.map((tab) => (
          <option key={tab.id} value={tab.id} disabled={!tab.enabled}>
            {tab.step ? `${tab.step} ` : ''}{tab.label}
            {!tab.enabled ? ' — Próximamente' : ''}
          </option>
        ))}
      </select>

      {/* Desktop tab bar */}
      <div className="hidden md:block border-b border-slate-200">
        <div className="flex items-center" role="tablist">
          {tabs.map((tab, i) => (
            <React.Fragment key={tab.id}>
              {i > 0 && <div className="w-3 h-px bg-slate-300" />}
              <button
                role="tab"
                aria-selected={activeTab === tab.id}
                disabled={!tab.enabled}
                title={!tab.enabled ? 'Próximamente' : undefined}
                onClick={() => onTabChange(tab.id)}
                className={`whitespace-nowrap px-4 py-2 text-sm border-b-2 -mb-px ${
                  activeTab === tab.id
                    ? 'border-[#e6c15c] text-slate-900 font-semibold'
                    : tab.enabled
                      ? 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                      : 'border-transparent text-slate-300 cursor-not-allowed'
                }`}
              >
                {tab.step ? `${tab.step} ` : ''}{tab.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/dashboard/SubTabNav.test.tsx --pool=threads`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add apps/frontend/src/components/dashboard/SubTabNav.tsx apps/frontend/src/components/dashboard/SubTabNav.test.tsx
git commit -m "feat: add SubTabNav reusable tab component"
```

---

### Task 2: Create Operaciones page

**Files:**
- Create: `apps/frontend/src/app/app/dashboard/operaciones/page.tsx`
- Create: `apps/frontend/src/app/app/dashboard/operaciones/page.test.tsx`

**Step 1: Write the failing test**

```tsx
// apps/frontend/src/app/app/dashboard/operaciones/page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import OperacionesPage from './page';

const pushMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
}));

vi.mock('@/hooks/useDashboardMetrics', () => ({
  useOperatorId: () => ({ operatorId: 'test-op', role: 'admin' }),
}));

vi.mock('@/components/dashboard/HeroSLASkeleton', () => ({
  default: () => <div>Skeleton</div>,
}));
vi.mock('@/components/dashboard/OfflineBanner', () => ({
  default: () => <div>OfflineBanner</div>,
}));
vi.mock('@/components/dashboard/LoadingTab', () => ({
  default: () => <div data-testid="loading-tab">LoadingTab</div>,
}));
vi.mock('@/components/dashboard/DeliveryTab', () => ({
  default: () => <div data-testid="delivery-tab">DeliveryTab</div>,
}));

describe('OperacionesPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    searchParams = new URLSearchParams();
  });

  it('shows loading-tab by default', () => {
    render(<OperacionesPage />);
    expect(screen.getByTestId('loading-tab')).toBeDefined();
  });

  it('shows delivery-tab when tab=lastmile', () => {
    searchParams = new URLSearchParams('tab=lastmile');
    render(<OperacionesPage />);
    expect(screen.getByTestId('delivery-tab')).toBeDefined();
  });

  it('renders Carga tab button', () => {
    render(<OperacionesPage />);
    expect(screen.getByRole('tab', { name: /Carga/ })).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/app/app/dashboard/operaciones/page.test.tsx --pool=threads`
Expected: FAIL — module not found

**Step 3: Write implementation**

```tsx
// apps/frontend/src/app/app/dashboard/operaciones/page.tsx
'use client';

import { Suspense, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOperatorId } from '@/hooks/useDashboardMetrics';
import SubTabNav, { type TabDefinition } from '@/components/dashboard/SubTabNav';
import HeroSLASkeleton from '@/components/dashboard/HeroSLASkeleton';
import OfflineBanner from '@/components/dashboard/OfflineBanner';
import LoadingTab from '@/components/dashboard/LoadingTab';
import DeliveryTab from '@/components/dashboard/DeliveryTab';

const ALLOWED_ROLES = ['operations_manager', 'admin'];

const OPERACIONES_TABS: TabDefinition[] = [
  { id: 'loading', step: '①', label: 'Carga', enabled: true },
  { id: 'pickup', step: '②', label: 'Retiro', enabled: false },
  { id: 'reception', step: '③', label: 'Recepción', enabled: false },
  { id: 'distribution', step: '④', label: 'Distribución', enabled: false },
  { id: 'routing', step: '⑤', label: 'Despacho', enabled: false },
  { id: 'lastmile', step: '⑥', label: 'Última Milla', enabled: true },
];

const VALID_TABS = OPERACIONES_TABS.map((t) => t.id);

function OperacionesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { operatorId, role } = useOperatorId();

  const rawTab = searchParams.get('tab');
  const activeTab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'loading';

  const handleTabChange = useCallback(
    (tab: string) => router.push(`?tab=${tab}`),
    [router],
  );

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
      <SubTabNav tabs={OPERACIONES_TABS} activeTab={activeTab} onTabChange={handleTabChange} />
      {activeTab === 'loading' && <LoadingTab operatorId={operatorId} />}
      {activeTab === 'lastmile' && <DeliveryTab operatorId={operatorId} />}
    </div>
  );
}

export default function OperacionesPage() {
  return (
    <Suspense fallback={<HeroSLASkeleton />}>
      <OperacionesContent />
    </Suspense>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/app/app/dashboard/operaciones/page.test.tsx --pool=threads`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add apps/frontend/src/app/app/dashboard/operaciones/
git commit -m "feat: add operaciones sub-route with pipeline tabs"
```

---

### Task 3: Create Analítica page

**Files:**
- Create: `apps/frontend/src/app/app/dashboard/analitica/page.tsx`
- Create: `apps/frontend/src/app/app/dashboard/analitica/page.test.tsx`

**Step 1: Write the failing test**

```tsx
// apps/frontend/src/app/app/dashboard/analitica/page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AnaliticaPage from './page';

const pushMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
}));

vi.mock('@/hooks/useDashboardMetrics', () => ({
  useOperatorId: () => ({ operatorId: 'test-op', role: 'admin' }),
}));

vi.mock('@/components/dashboard/HeroSLASkeleton', () => ({
  default: () => <div>Skeleton</div>,
}));
vi.mock('@/components/dashboard/OfflineBanner', () => ({
  default: () => <div>OfflineBanner</div>,
}));
vi.mock('@/components/analytics/OtifTab', () => ({
  default: () => <div data-testid="otif-tab">OtifTab</div>,
}));
vi.mock('@/components/analytics/UnitEconomicsTab', () => ({
  default: () => <div data-testid="unit-economics-tab">UnitEconomicsTab</div>,
}));
vi.mock('@/components/analytics/CxTab', () => ({
  default: () => <div data-testid="cx-tab">CxTab</div>,
}));

describe('AnaliticaPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    searchParams = new URLSearchParams();
  });

  it('shows otif-tab by default', () => {
    render(<AnaliticaPage />);
    expect(screen.getByTestId('otif-tab')).toBeDefined();
  });

  it('shows unit-economics-tab when tab=unit_economics', () => {
    searchParams = new URLSearchParams('tab=unit_economics');
    render(<AnaliticaPage />);
    expect(screen.getByTestId('unit-economics-tab')).toBeDefined();
  });

  it('renders OTIF tab button', () => {
    render(<AnaliticaPage />);
    expect(screen.getByRole('tab', { name: 'OTIF' })).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/app/app/dashboard/analitica/page.test.tsx --pool=threads`
Expected: FAIL — module not found

**Step 3: Write implementation**

```tsx
// apps/frontend/src/app/app/dashboard/analitica/page.tsx
'use client';

import { Suspense, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOperatorId } from '@/hooks/useDashboardMetrics';
import SubTabNav, { type TabDefinition } from '@/components/dashboard/SubTabNav';
import HeroSLASkeleton from '@/components/dashboard/HeroSLASkeleton';
import OfflineBanner from '@/components/dashboard/OfflineBanner';
import OtifTab from '@/components/analytics/OtifTab';
import UnitEconomicsTab from '@/components/analytics/UnitEconomicsTab';
import CxTab from '@/components/analytics/CxTab';

const ALLOWED_ROLES = ['operations_manager', 'admin'];

const ANALITICA_TABS: TabDefinition[] = [
  { id: 'otif', label: 'OTIF', enabled: true },
  { id: 'unit_economics', label: 'Unit Economics', enabled: false },
  { id: 'cx', label: 'CX', enabled: false },
];

const VALID_TABS = ANALITICA_TABS.map((t) => t.id);

function AnaliticaContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { operatorId, role } = useOperatorId();

  const rawTab = searchParams.get('tab');
  const activeTab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'otif';

  const handleTabChange = useCallback(
    (tab: string) => router.push(`?tab=${tab}`),
    [router],
  );

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
      <SubTabNav tabs={ANALITICA_TABS} activeTab={activeTab} onTabChange={handleTabChange} />
      {activeTab === 'otif' && <OtifTab operatorId={operatorId} />}
      {activeTab === 'unit_economics' && <UnitEconomicsTab operatorId={operatorId} />}
      {activeTab === 'cx' && <CxTab operatorId={operatorId} />}
    </div>
  );
}

export default function AnaliticaPage() {
  return (
    <Suspense fallback={<HeroSLASkeleton />}>
      <AnaliticaContent />
    </Suspense>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/app/app/dashboard/analitica/page.test.tsx --pool=threads`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add apps/frontend/src/app/app/dashboard/analitica/
git commit -m "feat: add analitica sub-route with analytics tabs"
```

---

### Task 4: Convert dashboard/page.tsx to redirect

**Files:**
- Modify: `apps/frontend/src/app/app/dashboard/page.tsx`
- Modify: `apps/frontend/src/app/app/dashboard/page.test.tsx`

**Step 1: Write the failing test**

```tsx
// apps/frontend/src/app/app/dashboard/page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import DashboardPage from './page';

const replaceMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => searchParams,
  redirect: vi.fn(),
}));

describe('DashboardPage redirect', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    searchParams = new URLSearchParams();
  });

  it('redirects to /app/dashboard/operaciones by default', () => {
    render(<DashboardPage />);
    expect(replaceMock).toHaveBeenCalledWith('/app/dashboard/operaciones');
  });

  it('redirects legacy tab=delivery to /app/dashboard/operaciones?tab=lastmile', () => {
    searchParams = new URLSearchParams('tab=delivery');
    render(<DashboardPage />);
    expect(replaceMock).toHaveBeenCalledWith('/app/dashboard/operaciones?tab=lastmile');
  });

  it('redirects tab=loading to /app/dashboard/operaciones?tab=loading', () => {
    searchParams = new URLSearchParams('tab=loading');
    render(<DashboardPage />);
    expect(replaceMock).toHaveBeenCalledWith('/app/dashboard/operaciones?tab=loading');
  });

  it('redirects tab=analytics_otif to /app/dashboard/analitica?tab=otif', () => {
    searchParams = new URLSearchParams('tab=analytics_otif');
    render(<DashboardPage />);
    expect(replaceMock).toHaveBeenCalledWith('/app/dashboard/analitica?tab=otif');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/app/app/dashboard/page.test.tsx --pool=threads`
Expected: FAIL — current page renders content instead of redirecting

**Step 3: Write implementation**

```tsx
// apps/frontend/src/app/app/dashboard/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const ANALYTICS_MAP: Record<string, string> = {
  analytics_otif: 'otif',
  analytics_unit_economics: 'unit_economics',
  analytics_cx: 'cx',
};

const OPS_TABS = ['loading', 'pickup', 'reception', 'distribution', 'routing', 'lastmile', 'delivery'];

export default function DashboardRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get('tab');

    if (tab && ANALYTICS_MAP[tab]) {
      router.replace(`/app/dashboard/analitica?tab=${ANALYTICS_MAP[tab]}`);
    } else if (tab === 'delivery') {
      router.replace('/app/dashboard/operaciones?tab=lastmile');
    } else if (tab && OPS_TABS.includes(tab)) {
      router.replace(`/app/dashboard/operaciones?tab=${tab}`);
    } else {
      router.replace('/app/dashboard/operaciones');
    }
  }, [router, searchParams]);

  return null;
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/app/app/dashboard/page.test.tsx --pool=threads`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add apps/frontend/src/app/app/dashboard/page.tsx apps/frontend/src/app/app/dashboard/page.test.tsx
git commit -m "feat: convert dashboard page to redirect to sub-routes"
```

---

### Task 5: Update sidebar with collapsible Dashboard group

**Files:**
- Modify: `apps/frontend/src/components/AppLayout.tsx`

**Step 1: Update AppLayout**

Replace the single Dashboard nav item with a collapsible group containing Operaciones and Analítica sub-items.

```tsx
// In AppLayout.tsx, replace the navigation array and nav rendering:

// Add imports at the top:
import { ChevronRight, TrendingUp } from 'lucide-react';

// Replace the navigation const (around line 61-66):
const operacionesHref = '/app/dashboard/operaciones';
const analiticaHref = '/app/dashboard/analitica';
const isDashboardSection = pathname.startsWith('/app/dashboard');

const standaloneNav = [
  { name: 'User Settings', href: '/app/user-settings', icon: User },
];

// Replace the <nav> section (around line 105-127) with:
<nav className="mt-4 px-2 space-y-1">
  {dashboardAllowed && (
    <div>
      <button
        onClick={() => {
          if (!isDashboardSection) {
            router.push(operacionesHref);
          }
        }}
        className={`w-full group flex items-center justify-between px-2 py-2 text-sm font-medium rounded-md ${
          isDashboardSection
            ? 'bg-primary-50 text-primary-600'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`}
      >
        <div className="flex items-center">
          <BarChart3 className={`mr-3 h-5 w-5 ${
            isDashboardSection ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'
          }`} />
          Dashboard
        </div>
        <ChevronRight className={`h-4 w-4 transition-transform ${
          isDashboardSection ? 'rotate-90' : ''
        }`} />
      </button>
      {isDashboardSection && (
        <div className="ml-6 mt-1 space-y-1">
          <Link
            href={operacionesHref}
            className={`group flex items-center px-2 py-1.5 text-sm rounded-md ${
              pathname.startsWith(operacionesHref)
                ? 'text-primary-600 font-medium'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <BarChart3 className="mr-2 h-4 w-4" />
            Operaciones
          </Link>
          <Link
            href={analiticaHref}
            className={`group flex items-center px-2 py-1.5 text-sm rounded-md ${
              pathname.startsWith(analiticaHref)
                ? 'text-primary-600 font-medium'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <TrendingUp className="mr-2 h-4 w-4" />
            Analítica
          </Link>
        </div>
      )}
    </div>
  )}
  {standaloneNav.map((item) => {
    const isActive = pathname === item.href;
    return (
      <Link
        key={item.name}
        href={item.href}
        className={`group flex items-center px-2 py-2 text-sm font-medium rounded-md ${
          isActive
            ? 'bg-primary-50 text-primary-600'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`}
      >
        <item.icon className={`mr-3 h-5 w-5 ${
          isActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'
        }`} />
        {item.name}
      </Link>
    );
  })}
</nav>
```

**Step 2: Verify build and lint**

Run: `cd apps/frontend && npx tsc --noEmit && npx next lint`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/frontend/src/components/AppLayout.tsx
git commit -m "feat: collapsible Dashboard sidebar with Operaciones and Analítica sub-items"
```

---

### Task 6: Clean up old PipelineNav

**Files:**
- Delete: `apps/frontend/src/components/dashboard/PipelineNav.tsx`

**Step 1: Verify PipelineNav is no longer imported anywhere**

Run: `grep -r "PipelineNav" apps/frontend/src/ --include="*.tsx" --include="*.ts"`
Expected: Only hits in PipelineNav.tsx itself (and possibly old test files). The dashboard/page.tsx redirect no longer imports it.

**Step 2: Delete PipelineNav**

```bash
rm apps/frontend/src/components/dashboard/PipelineNav.tsx
```

**Step 3: Run all tests**

Run: `cd apps/frontend && npx vitest run --pool=threads`
Expected: All tests pass

**Step 4: Run build verification**

Run: `cd apps/frontend && npx tsc --noEmit && npx next lint && npx next build`
Expected: All pass

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove unused PipelineNav component"
```

---

### Task 7: Final verification and PR

**Step 1: Run full test suite**

Run: `cd apps/frontend && npx vitest run --pool=threads`
Expected: All tests pass

**Step 2: Run full build**

Run: `cd apps/frontend && npx next build`
Expected: Build succeeds

**Step 3: Push and create PR**

```bash
git push origin <branch-name>
gh pr create --title "feat: sidebar nav restructure — Operaciones & Analítica sub-items"
gh pr merge --auto --squash <PR-number>
```
