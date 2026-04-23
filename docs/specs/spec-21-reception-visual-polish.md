# Spec-21: Reception Visual Polish + QR Fix

**Status:** completed
**Author:** Claude (spec-19 follow-up)
**Date:** 2026-03-25

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the 4 reception screens to match distribution/pickup quality, fix the broken QR scanner, add KPIs/tabs/history, and surface driver info on pending cards.

**Architecture:** Pure frontend changes — no DB migrations. Expand existing Supabase select queries to include `delivered_by_user` join. Add `html5-qrcode` dependency for QR decoding. Follow patterns from spec-18 (distribution) and spec-19 (pickup).

**Tech Stack:** React, Next.js App Router, shadcn/ui, TanStack Query, Supabase client, html5-qrcode, Vitest + RTL

---

## Problem

The reception flow (4 screens) was built as a minimum viable skeleton in spec-08 and never polished. It trails the recently polished distribution (spec-18) and pickup (spec-19) pages by 2-3 quality tiers. A full design review found 18 issues across visual consistency, missing functionality, UX gaps, and Spanish grammar errors. The QR scanner camera opens but never actually decodes QR codes — the feature is non-functional.

## Issues Found

### Reception List Page (`/app/reception`) — 11 issues

| # | Category | Issue |
|---|----------|-------|
| 1 | **KPIs missing** | No MetricCards. Hub supervisor has zero at-a-glance overview (pending, in-progress, completed today, packages expected) |
| 2 | **No completed history** | Once a load is confirmed it vanishes. No "Completados" tab — can't review past receptions, who received what, or when |
| 3 | **Raw button** | "Escanear QR" is a hand-rolled `<button>` with inline Tailwind instead of shadcn `<Button>` |
| 4 | **No EmptyState** | Empty list renders a bare `<p>` instead of the `EmptyState` component used in pickup/distribution |
| 5 | **No responsive padding** | Uses `p-4` only — no `sm:p-6`, no `max-w` container. Stretches full-width on desktop |
| 6 | **QR Scanner not in Dialog** | Raw `fixed inset-0` overlay instead of shadcn `<Dialog>` — no animation, no focus trap, no accessible Escape handling |
| 7 | **QR decoding not implemented** | Camera opens but never reads QR codes (TODO on line 192 of QRScanner.tsx). Only manual UUID input works. Feature is broken |
| 8 | **Dead clicks on pending cards** | `awaiting_reception` cards have `cursor-pointer` and `role="button"` but click is a no-op. Confusing UX |
| 9 | **No driver info on cards** | Warehouse worker can't see which driver is bringing a load or when they left. `hub_receptions.delivered_by` and `manifests.completed_at` exist but aren't shown |
| 10 | **No PageShell** | Page builds its own header from scratch instead of using consistent layout patterns |
| 11 | **Raw `<input>` in QR scanner** | Manual input field uses raw `<input>` and `<button>` instead of shadcn components |

### Scan Page (`/app/reception/scan/[receptionId]`) — 3 issues

| # | Category | Issue |
|---|----------|-------|
| 12 | **Raw back button** | `<button>` with inline classes instead of shadcn `<Button variant="ghost" size="icon">` |
| 13 | **No breadcrumb** | No navigation context — user doesn't know where they are in the flow |
| 14 | **No responsive padding** | Missing `sm:p-6` |

### Complete Page (`/app/reception/complete/[receptionId]`) — 4 issues

| # | Category | Issue |
|---|----------|-------|
| 15 | **Raw back button** | Same as scan page |
| 16 | **No confirmation dialog** | "Confirmar recepción" directly mutates — no `AlertDialog` for irreversible custody transfer |
| 17 | **Spanish accent errors** | "Recepcion" → "Recepción", "perdida" → "pérdida" in toast, headings, success screen |
| 18 | **No breadcrumb** | Same as scan page |

### Cross-cutting

- `ReceptionSummary` uses hand-rolled inline cards instead of `MetricCard` (inconsistent with review/complete pages fixed in spec-19)

## Prerequisites

- Install `html5-qrcode`: `npm install html5-qrcode` (QR decoding library)
- All other components exist: `Tabs`, `AlertDialog`, `Dialog`, `Button`, `MetricCard`, `EmptyState`, `Input`

## Key Files

| File | Path |
|------|------|
| Reception list page | `apps/frontend/src/app/app/reception/page.tsx` |
| Scan page | `apps/frontend/src/app/app/reception/scan/[receptionId]/page.tsx` |
| Complete page | `apps/frontend/src/app/app/reception/complete/[receptionId]/page.tsx` |
| ReceptionList | `apps/frontend/src/components/reception/ReceptionList.tsx` |
| ReceptionCard | `apps/frontend/src/components/reception/ReceptionCard.tsx` |
| ReceptionSummary | `apps/frontend/src/components/reception/ReceptionSummary.tsx` |
| QRScanner | `apps/frontend/src/components/reception/QRScanner.tsx` |
| ReceptionStepBreadcrumb | `apps/frontend/src/components/reception/ReceptionStepBreadcrumb.tsx` *(new)* |
| useReceptionManifests | `apps/frontend/src/hooks/reception/useReceptionManifests.ts` |
| useCompletedReceptions | `apps/frontend/src/hooks/reception/useCompletedReceptions.ts` *(new)* |

## Execution Order

```
Chunk 1 (shared) ──┬──▶ Chunk 2 (list page)     ← largest, do first
                    ├──▶ Chunk 4 (scan page)
                    └──▶ Chunk 5 (complete page)

Chunk 3 (QR decoding) ──▶ independent, parallel with Chunk 1
```

---

## Chunk 1: Shared Component Updates

### Task 1.1: ReceptionStepBreadcrumb (NEW)

**Files:**
- Create: `apps/frontend/src/components/reception/ReceptionStepBreadcrumb.tsx`
- Create: `apps/frontend/src/components/reception/ReceptionStepBreadcrumb.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// ReceptionStepBreadcrumb.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceptionStepBreadcrumb } from './ReceptionStepBreadcrumb';

describe('ReceptionStepBreadcrumb', () => {
  it('renders all step labels', () => {
    render(<ReceptionStepBreadcrumb current="reception" />);
    expect(screen.getByText('Recepción')).toBeInTheDocument();
    expect(screen.getByText('Escaneo')).toBeInTheDocument();
    expect(screen.getByText('Confirmación')).toBeInTheDocument();
  });

  it('highlights current step with aria-current', () => {
    render(<ReceptionStepBreadcrumb current="scan" />);
    expect(screen.getByText('Escaneo')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Recepción')).not.toHaveAttribute('aria-current');
  });

  it('marks previous steps as secondary text', () => {
    render(<ReceptionStepBreadcrumb current="confirm" />);
    expect(screen.getByText('Recepción').className).toContain('text-text-secondary');
    expect(screen.getByText('Escaneo').className).toContain('text-text-secondary');
    expect(screen.getByText('Confirmación').className).toContain('text-accent');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module not found)**

```bash
cd apps/frontend && npx vitest run src/components/reception/ReceptionStepBreadcrumb.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// ReceptionStepBreadcrumb.tsx
export type ReceptionStep = 'reception' | 'scan' | 'confirm';

const STEPS: { key: ReceptionStep; label: string }[] = [
  { key: 'reception', label: 'Recepción' },
  { key: 'scan', label: 'Escaneo' },
  { key: 'confirm', label: 'Confirmación' },
];

interface ReceptionStepBreadcrumbProps {
  current: ReceptionStep;
}

export function ReceptionStepBreadcrumb({ current }: ReceptionStepBreadcrumbProps) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);

  return (
    <nav aria-label="Reception flow steps" className="flex items-center gap-1 text-sm mb-3">
      {STEPS.map((step, i) => {
        const isCurrent = i === currentIndex;
        const isCompleted = i < currentIndex;
        const labelClass = isCurrent
          ? 'text-accent font-semibold'
          : isCompleted
            ? 'text-text-secondary'
            : 'text-text-muted';

        return (
          <span key={step.key} className="flex items-center gap-1">
            {i > 0 && <span className="text-text-muted">›</span>}
            <span className={labelClass} aria-current={isCurrent ? 'step' : undefined}>
              {step.label}
            </span>
          </span>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit** `feat(spec-21): add ReceptionStepBreadcrumb component`

### Task 1.2: ReceptionSummary → MetricCard

**Files:**
- Modify: `apps/frontend/src/components/reception/ReceptionSummary.tsx`
- Modify: `apps/frontend/src/components/reception/ReceptionSummary.test.tsx`

- [ ] **Step 1: Rewrite tests for MetricCard pattern**

```tsx
// ReceptionSummary.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceptionSummary } from './ReceptionSummary';

describe('ReceptionSummary', () => {
  it('renders MetricCards with correct values via data-value', () => {
    const { container } = render(
      <ReceptionSummary expectedCount={10} receivedCount={8} />
    );
    const valueEls = container.querySelectorAll('[data-value]');
    expect(valueEls).toHaveLength(3);
    expect(valueEls[0].textContent).toBe('10');
    expect(valueEls[1].textContent).toBe('8');
    expect(valueEls[2].textContent).toBe('2');
  });

  it('renders Spanish labels', () => {
    render(<ReceptionSummary expectedCount={10} receivedCount={10} />);
    expect(screen.getByText('Esperados')).toBeInTheDocument();
    expect(screen.getByText('Recibidos')).toBeInTheDocument();
    expect(screen.getByText('Faltantes')).toBeInTheDocument();
  });

  it('shows green status banner when all received', () => {
    render(<ReceptionSummary expectedCount={10} receivedCount={10} />);
    expect(screen.getByText('Todos los paquetes recibidos')).toBeInTheDocument();
  });

  it('shows amber status banner when discrepancies', () => {
    render(<ReceptionSummary expectedCount={10} receivedCount={8} />);
    expect(screen.getByText(/paquetes faltantes/)).toBeInTheDocument();
  });

  it('handles zero expected gracefully', () => {
    const { container } = render(
      <ReceptionSummary expectedCount={0} receivedCount={0} />
    );
    const valueEls = container.querySelectorAll('[data-value]');
    expect(valueEls).toHaveLength(3);
    valueEls.forEach((el) => expect(el.textContent).toBe('0'));
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (`[data-value]` not found)**

```bash
cd apps/frontend && npx vitest run src/components/reception/ReceptionSummary.test.tsx
```

- [ ] **Step 3: Rewrite with MetricCard**

Replace the 3 inline `<div>` summary cards with `<MetricCard>` components inside `CardContent`. Keep the status banner. Import `MetricCard` from `@/components/metrics/MetricCard`. Use `Package`, `CheckCircle`, `AlertTriangle` icons. Add conditional `className` on missing MetricCard (`border-status-error-border bg-status-error-bg` when `missingCount > 0`).

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit** `feat(spec-21): replace ReceptionSummary inline cards with MetricCard`

---

## Chunk 2: Reception List Page

### Task 2.1: useCompletedReceptions hook (NEW)

**Files:**
- Create: `apps/frontend/src/hooks/reception/useCompletedReceptions.ts`
- Create: `apps/frontend/src/hooks/reception/useCompletedReceptions.test.ts`

- [ ] **Step 1: Write hook test**

```ts
// useCompletedReceptions.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCompletedReceptions } from './useCompletedReceptions';
import type { ReactNode } from 'react';

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            order: () => Promise.resolve({
              data: [{
                id: 'm1', external_load_id: 'CARGA-001', retailer_name: 'Easy',
                total_packages: 20, completed_at: '2026-03-25T10:00:00Z',
                reception_status: 'received', assigned_to_user_id: 'u1',
                hub_receptions: [{ id: 'r1', expected_count: 20, received_count: 20, status: 'completed', completed_at: '2026-03-25T11:00:00Z' }],
              }],
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useCompletedReceptions', () => {
  it('fetches completed manifests', async () => {
    const { result } = renderHook(() => useCompletedReceptions('op-1'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].retailer_name).toBe('Easy');
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(() => useCompletedReceptions(null), { wrapper });
    expect(result.current.data).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**
- [ ] **Step 3: Implement hook**

```ts
// useCompletedReceptions.ts
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { ReceptionManifest } from './useReceptionManifests';

export function useCompletedReceptions(operatorId: string | null) {
  return useQuery({
    queryKey: ['reception', 'completed', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('manifests')
        .select(
          `id, external_load_id, retailer_name, total_packages, completed_at,
           reception_status, assigned_to_user_id,
           hub_receptions(id, expected_count, received_count, status, completed_at)`
        )
        .eq('reception_status', 'received')
        .is('deleted_at', null)
        .order('completed_at', { ascending: false });

      if (error) throw error;
      return data as ReceptionManifest[];
    },
    enabled: !!operatorId,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit** `feat(spec-21): add useCompletedReceptions hook`

### Task 2.2: Expand useReceptionManifests with driver info

**Files:**
- Modify: `apps/frontend/src/hooks/reception/useReceptionManifests.ts`

- [ ] **Step 1: Add `delivered_by_user` to `ReceptionHubInfo` type**

```ts
export interface ReceptionHubInfo {
  id: string;
  expected_count: number;
  received_count: number;
  status: string;
  delivered_by_user?: { full_name: string } | null;
}
```

- [ ] **Step 2: Update select to include the join**

```ts
.select(
  `id, external_load_id, retailer_name, total_packages, completed_at,
   reception_status, assigned_to_user_id,
   hub_receptions(id, expected_count, received_count, status,
     delivered_by_user:users!hub_receptions_delivered_by_fkey(full_name)
   )`
)
```

- [ ] **Step 3: Run existing hook tests — expect PASS**

```bash
cd apps/frontend && npx vitest run src/hooks/reception/useReceptionManifests.test.ts
```

- [ ] **Step 4: Commit** `feat(spec-21): include driver name in useReceptionManifests query`

### Task 2.3: ReceptionCard — driver info + non-interactive mode

**Files:**
- Modify: `apps/frontend/src/components/reception/ReceptionCard.tsx`
- Modify: `apps/frontend/src/components/reception/ReceptionCard.test.tsx`

- [ ] **Step 1: Add new tests to existing test file**

```tsx
// Append to ReceptionCard.test.tsx:
it('shows driver name when provided', () => {
  render(<ReceptionCard {...defaultProps} driverName="Carlos López" />);
  expect(screen.getByText(/Carlos López/)).toBeInTheDocument();
});

it('shows departure time when provided', () => {
  render(<ReceptionCard {...defaultProps} departedAt="2026-03-25T14:30:00Z" />);
  expect(screen.getByText(/Salió a las/)).toBeInTheDocument();
});

it('renders non-interactive when interactive is false', () => {
  render(<ReceptionCard {...defaultProps} interactive={false} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('shows hint text when interactive is false', () => {
  render(<ReceptionCard {...defaultProps} interactive={false} />);
  expect(screen.getByText(/Escanee QR para iniciar/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test — expect FAIL on new tests**
- [ ] **Step 3: Update ReceptionCard**

Add props: `driverName?: string | null`, `departedAt?: string | null`, `interactive?: boolean` (default true).

When `interactive=false`: render as plain `<div>` without `role="button"`, `cursor-pointer`, `tabIndex`, click/keyDown handlers. Show "Escanee QR para iniciar recepción" hint for non-in-progress cards.

When `driverName` provided: show `<Truck>` icon + name. When `departedAt` provided: show "Salió a las HH:MM" using `es-CL` locale. Only show `completedAt` fallback when `departedAt` is not provided.

- [ ] **Step 4: Run tests — expect ALL PASS**
- [ ] **Step 5: Commit** `feat(spec-21): ReceptionCard driver info + non-interactive mode`

### Task 2.4: Rewrite Reception List Page

**Files:**
- Modify: `apps/frontend/src/app/app/reception/page.tsx`
- Create: `apps/frontend/src/app/app/reception/page.test.tsx`

- [ ] **Step 1: Write page test**

```tsx
// page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReceptionPage from './page';

const mockActive = [
  {
    id: 'm1', external_load_id: 'CARGA-001', retailer_name: 'Easy',
    total_packages: 20, completed_at: '2026-03-25T10:00:00Z',
    reception_status: 'awaiting_reception', assigned_to_user_id: 'u1',
    hub_receptions: [{ id: 'r1', expected_count: 20, received_count: 0, status: 'pending',
      delivered_by_user: { full_name: 'Carlos López' } }],
  },
  {
    id: 'm2', external_load_id: 'CARGA-002', retailer_name: 'Sodimac',
    total_packages: 15, completed_at: '2026-03-25T11:00:00Z',
    reception_status: 'reception_in_progress', assigned_to_user_id: 'u1',
    hub_receptions: [{ id: 'r2', expected_count: 15, received_count: 8, status: 'in_progress',
      delivered_by_user: { full_name: 'Ana Ruiz' } }],
  },
];

const mockCompleted = [
  {
    id: 'm3', external_load_id: 'CARGA-000', retailer_name: 'Easy',
    total_packages: 10, completed_at: new Date().toISOString(),
    reception_status: 'received', assigned_to_user_id: 'u1',
    hub_receptions: [{ id: 'r3', expected_count: 10, received_count: 10, status: 'completed',
      completed_at: new Date().toISOString() }],
  },
];

const mockUseReceptionManifests = vi.fn();
const mockUseCompletedReceptions = vi.fn();

vi.mock('@/hooks/reception/useReceptionManifests', () => ({
  useReceptionManifests: (...args: unknown[]) => mockUseReceptionManifests(...args),
}));
vi.mock('@/hooks/reception/useCompletedReceptions', () => ({
  useCompletedReceptions: (...args: unknown[]) => mockUseCompletedReceptions(...args),
}));
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));
vi.mock('@/components/reception/QRScanner', () => ({
  QRScanner: () => <div data-testid="qr-scanner" />,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe('ReceptionPage', () => {
  beforeEach(() => {
    mockUseReceptionManifests.mockReturnValue({ data: mockActive, isLoading: false });
    mockUseCompletedReceptions.mockReturnValue({ data: mockCompleted, isLoading: false });
  });

  it('renders 4 MetricCards with correct values', () => {
    const { container } = render(<ReceptionPage />);
    const valueEls = container.querySelectorAll('[data-value]');
    expect(valueEls).toHaveLength(4);
    expect(valueEls[0].textContent).toBe('1');  // en tránsito
    expect(valueEls[1].textContent).toBe('1');  // en progreso
    expect(valueEls[2].textContent).toBe('1');  // completados hoy
    expect(valueEls[3].textContent).toBe('35'); // paquetes esperados
  });

  it('renders KPI labels in Spanish', () => {
    render(<ReceptionPage />);
    expect(screen.getByText('En tránsito')).toBeInTheDocument();
    expect(screen.getByText('En progreso')).toBeInTheDocument();
    expect(screen.getByText('Completados hoy')).toBeInTheDocument();
    expect(screen.getByText('Paquetes esperados')).toBeInTheDocument();
  });

  it('renders tab triggers', () => {
    render(<ReceptionPage />);
    expect(screen.getByRole('tab', { name: 'Activos' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Completados' })).toBeInTheDocument();
  });

  it('shows EmptyState when no active manifests', () => {
    mockUseReceptionManifests.mockReturnValue({ data: [], isLoading: false });
    render(<ReceptionPage />);
    expect(screen.getByText('Sin cargas pendientes')).toBeInTheDocument();
  });

  it('renders active manifest cards', () => {
    render(<ReceptionPage />);
    expect(screen.getByText('Easy')).toBeInTheDocument();
    expect(screen.getByText('Sodimac')).toBeInTheDocument();
  });

  it('has max-w constraint and responsive padding', () => {
    const { container } = render(<ReceptionPage />);
    expect(container.querySelector('.max-w-4xl')).toBeTruthy();
  });

  it('renders shadcn Button for QR scan', () => {
    render(<ReceptionPage />);
    expect(screen.getByRole('button', { name: /escanear qr/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**
- [ ] **Step 3: Rewrite page**

Follow the pickup page pattern exactly. Key structure:
- Header: title "Recepción" + `<Button>` for "Escanear QR"
- 4 KPIs: `grid-cols-2 sm:grid-cols-4` with MetricCard (En tránsito, En progreso, Completados hoy, Paquetes esperados)
- `<Tabs>` with Activos/Completados
- Active tab: `ReceptionCard` list with driver info, non-interactive for awaiting cards
- Completed tab: `ReceptionCard` list with `interactive={false}`
- Both tabs: `<EmptyState>` when empty, `<Skeleton>` when loading
- QR Scanner in `<Dialog>` instead of raw overlay
- Container: `max-w-4xl mx-auto`, `p-4 sm:p-6`, `space-y-6 sm:space-y-8`

KPI computations:
- `awaitingCount`: filter `reception_status === 'awaiting_reception'`
- `inProgressCount`: filter `reception_status === 'reception_in_progress'`
- `completedTodayCount`: from completedManifests, filter hub_receptions where `completed_at` is today
- `totalExpectedPackages`: sum `total_packages` from activeManifests

`isToday` helper: same as in pickup page.

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Run all reception tests for regressions**

```bash
cd apps/frontend && npx vitest run src/components/reception/ src/app/app/reception/
```

- [ ] **Step 6: Commit** `feat(spec-21): rewrite reception list page with KPIs, tabs, driver info`

---

## Chunk 3: QR Decoding (Functional Fix)

### Task 3.1: Install html5-qrcode

- [ ] **Step 1: Install**

```bash
cd apps/frontend && npm install html5-qrcode
```

- [ ] **Step 2: Commit** `chore(spec-21): install html5-qrcode for QR decoding`

### Task 3.2: Rewrite QRScanner with real QR decoding

**Files:**
- Modify: `apps/frontend/src/components/reception/QRScanner.tsx`
- Modify: `apps/frontend/src/components/reception/QRScanner.test.tsx`

- [ ] **Step 1: Update tests — mock html5-qrcode**

```tsx
// QRScanner.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QRScanner } from './QRScanner';

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
  })),
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

describe('QRScanner', () => {
  beforeEach(() => { mockPush.mockClear(); mockFrom.mockClear(); });

  it('renders scanner container', () => {
    const { container } = render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);
    expect(container.querySelector('#qr-reader')).toBeInTheDocument();
  });

  it('renders manual input fallback', () => {
    render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);
    expect(screen.getByPlaceholderText(/ID del manifiesto/i)).toBeInTheDocument();
  });

  it('validates UUID format', async () => {
    render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);
    const input = screen.getByPlaceholderText(/ID del manifiesto/i);
    fireEvent.change(input, { target: { value: 'not-a-uuid' } });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    await waitFor(() => {
      expect(screen.getByText('Código QR no válido')).toBeInTheDocument();
    });
  });

  it('navigates on valid UUID lookup', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          reception_status: 'awaiting_reception',
          hub_receptions: [{ id: 'reception-1', status: 'pending' }],
        },
        error: null,
      }),
    });

    render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);
    const input = screen.getByPlaceholderText(/ID del manifiesto/i);
    fireEvent.change(input, { target: { value: '550e8400-e29b-41d4-a716-446655440000' } });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/app/reception/scan/reception-1');
    });
  });

  it('shows already-received message', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          reception_status: 'received',
          hub_receptions: [{ id: 'reception-1', status: 'completed',
            completed_at: '2026-03-18T12:00:00Z',
            received_by_user: { full_name: 'Juan Perez' } }],
        },
        error: null,
      }),
    });

    render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);
    const input = screen.getByPlaceholderText(/ID del manifiesto/i);
    fireEvent.change(input, { target: { value: '550e8400-e29b-41d4-a716-446655440000' } });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    await waitFor(() => {
      expect(screen.getByText('Esta carga ya fue recibida')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (component structure changed)**
- [ ] **Step 3: Rewrite QRScanner**

Key changes:
- Remove `fixed inset-0` wrapper — component now lives inside Dialog from Chunk 2
- Replace raw `<video>` + TODO with `Html5Qrcode`: create scanner in `useEffect`, call `scanner.start({ facingMode: 'environment' }, config, onDecodeSuccess)`, cleanup with `scanner.stop()` + `scanner.clear()`
- On successful decode: call existing `lookupManifest(decodedText)`
- Camera error: show fallback icon + text (same as before)
- Replace raw `<input>` with shadcn `<Input>`, raw `<button>` with `<Button size="icon" variant="outline">`
- Add `onClose()` call before `router.push` to close the Dialog

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit** `feat(spec-21): implement QR decoding with html5-qrcode`

---

## Chunk 4: Scan Page Polish

### Task 4.1: Update scan page

**Files:**
- Modify: `apps/frontend/src/app/app/reception/scan/[receptionId]/page.tsx`
- Create: `apps/frontend/src/app/app/reception/scan/[receptionId]/page.test.tsx`

- [ ] **Step 1: Write page test**

```tsx
// page.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReceptionScanPage from './page';

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));
vi.mock('@/hooks/reception/useReceptionScans', () => ({
  useReceptionScans: () => ({ data: [] }),
  useReceptionScanMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ is: () => ({ single: () => Promise.resolve({
            data: { manifest_id: 'm1', expected_count: 10, received_count: 3 },
          }) }) }),
          single: () => Promise.resolve({ data: { external_load_id: 'CARGA-001' } }),
        }),
        in: () => ({ is: () => Promise.resolve({ data: [] }) }),
      }),
    }),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  }),
}));
vi.mock('@/components/reception/ReceptionScanner', () => ({
  ReceptionScanner: () => <div data-testid="reception-scanner" />,
}));
vi.mock('@/components/reception/ReceptionDetailList', () => ({
  ReceptionDetailList: () => <div data-testid="detail-list" />,
  ReceptionPackageItem: {},
}));
vi.mock('@/components/pickup/PickupFlowHeader', () => ({
  PickupFlowHeader: () => <div data-testid="flow-header" />,
}));
vi.mock('@/components/reception/ReceptionStepBreadcrumb', () => ({
  ReceptionStepBreadcrumb: () => <div data-testid="breadcrumb" />,
}));
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ receptionId: 'r-1' }),
  useRouter: () => ({ push: mockPush }),
}));

describe('ReceptionScanPage', () => {
  it('renders breadcrumb', () => {
    render(<ReceptionScanPage />);
    expect(screen.getByTestId('breadcrumb')).toBeInTheDocument();
  });

  it('renders back button as shadcn Button', () => {
    render(<ReceptionScanPage />);
    expect(screen.getByRole('button', { name: /volver a recepción/i })).toBeInTheDocument();
  });

  it('has responsive padding', () => {
    const { container } = render(<ReceptionScanPage />);
    expect(container.firstElementChild?.className).toContain('sm:p-6');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**
- [ ] **Step 3: Update scan page**

Changes:
1. Add `import { ReceptionStepBreadcrumb } from '@/components/reception/ReceptionStepBreadcrumb'`
2. Add `import { Button } from '@/components/ui/button'` (if not already imported)
3. Insert `<ReceptionStepBreadcrumb current="scan" />` after opening div
4. Container: `"space-y-4 p-4 max-w-2xl mx-auto"` → `"space-y-4 p-4 sm:p-6 max-w-2xl mx-auto"`
5. Back button: replace raw `<button>` with `<Button variant="ghost" size="icon" aria-label="Volver a recepción">`

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit** `feat(spec-21): polish reception scan page — breadcrumb, Button, padding`

---

## Chunk 5: Complete Page Polish

### Task 5.1: Update complete page

**Files:**
- Modify: `apps/frontend/src/app/app/reception/complete/[receptionId]/page.tsx`
- Create: `apps/frontend/src/app/app/reception/complete/[receptionId]/page.test.tsx`

- [ ] **Step 1: Write page test**

```tsx
// page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReceptionCompletePage from './page';

const mockUseHubReception = vi.fn();
const mockUseCompleteReception = vi.fn();
vi.mock('@/hooks/reception/useHubReceptions', () => ({
  useHubReception: (...args: unknown[]) => mockUseHubReception(...args),
  useCompleteReception: (...args: unknown[]) => mockUseCompleteReception(...args),
}));
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));
vi.mock('@/components/reception/ReceptionSummary', () => ({
  ReceptionSummary: () => <div data-testid="reception-summary" />,
}));
vi.mock('@/components/reception/ReceptionStepBreadcrumb', () => ({
  ReceptionStepBreadcrumb: () => <div data-testid="breadcrumb" />,
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ receptionId: 'r-1' }),
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}));

describe('ReceptionCompletePage', () => {
  beforeEach(() => {
    mockUseHubReception.mockReturnValue({
      data: {
        id: 'r-1', manifest_id: 'm1', expected_count: 20, received_count: 18,
        status: 'in_progress', discrepancy_notes: null,
        manifests: { id: 'm1', external_load_id: 'CARGA-001', retailer_name: 'Easy' },
      },
      isLoading: false,
    });
    mockUseCompleteReception.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it('renders breadcrumb', () => {
    render(<ReceptionCompletePage />);
    expect(screen.getByTestId('breadcrumb')).toBeInTheDocument();
  });

  it('renders heading with proper accent — "Confirmar Recepción"', () => {
    render(<ReceptionCompletePage />);
    expect(screen.getByText('Confirmar Recepción')).toBeInTheDocument();
  });

  it('renders confirm button (AlertDialog trigger)', () => {
    render(<ReceptionCompletePage />);
    expect(screen.getByRole('button', { name: /confirmar recepción/i })).toBeInTheDocument();
  });

  it('renders back button as shadcn Button', () => {
    render(<ReceptionCompletePage />);
    expect(screen.getByRole('button', { name: /volver/i })).toBeInTheDocument();
  });

  it('has responsive padding', () => {
    const { container } = render(<ReceptionCompletePage />);
    expect(container.firstElementChild?.className).toContain('sm:p-6');
  });

  it('shows discrepancy section when missing packages', () => {
    render(<ReceptionCompletePage />);
    expect(screen.getByText(/paquetes faltantes/i)).toBeInTheDocument();
  });

  it('uses correct Spanish — "pérdida" with accent', () => {
    render(<ReceptionCompletePage />);
    expect(screen.getByText(/pérdida/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**
- [ ] **Step 3: Update complete page**

Changes:
1. Add imports: `ReceptionStepBreadcrumb`, `AlertDialog`/`AlertDialogAction`/`AlertDialogCancel`/`AlertDialogContent`/`AlertDialogDescription`/`AlertDialogFooter`/`AlertDialogHeader`/`AlertDialogTitle`/`AlertDialogTrigger`
2. Insert `<ReceptionStepBreadcrumb current="confirm" />` at top
3. Container: add `sm:p-6`
4. Back button: replace raw `<button>` with `<Button variant="ghost" size="icon" aria-label="Volver">`
5. Wrap confirm button in `<AlertDialog>`:
   - Trigger: existing `<Button>` with text "Confirmar recepción"
   - Title: `¿Confirmar recepción de carga?`
   - Description: `Esta acción registrará la transferencia de custodia y no se puede deshacer.`
   - Cancel: `Cancelar`
   - Action: `Confirmar recepción` → calls `handleConfirm`
6. Fix Spanish accents:
   - `"Confirmar Recepcion"` → `"Confirmar Recepción"`
   - `"Recepcion completada"` → `"Recepción completada"`
   - toast success: `"Recepción completada exitosamente"`
   - toast error: `"Error al completar la recepción"`
   - `"perdida en transito"` → `"pérdida en tránsito"`

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit** `feat(spec-21): polish complete page — AlertDialog, breadcrumb, Spanish`

---

## Final Verification

- [ ] **Run all reception tests**

```bash
cd apps/frontend && npx vitest run src/components/reception/ src/app/app/reception/ src/hooks/reception/
```

- [ ] **TypeScript check**

```bash
cd apps/frontend && npx tsc --noEmit
```

- [ ] **Lint**

```bash
cd apps/frontend && npx next lint
```

- [ ] **Push and create PR with auto-merge**

```bash
git push origin feat/spec-21-reception-visual-polish
gh pr create --title "feat(spec-21): reception visual polish + QR fix" --body "..."
gh pr merge --auto --squash
```

- [ ] **Wait for CI and confirm merge**

```bash
gh pr checks <PR_NUMBER>
gh pr view <PR_NUMBER> --json state,mergedAt
```

## Acceptance Criteria

1. Reception list shows 4 KPI MetricCards with live data
2. Active/Completed tabs work — completed receptions visible in history
3. In-transit cards show driver name and departure time
4. `awaiting_reception` cards are not misleadingly clickable
5. QR scanner actually decodes QR codes from camera
6. Manual UUID fallback still works
7. All raw `<button>` replaced with shadcn `<Button>`
8. All raw modals replaced with shadcn `<Dialog>`
9. "Confirmar recepción" has AlertDialog confirmation
10. Breadcrumbs on scan and complete pages
11. Spanish accent marks corrected everywhere
12. ReceptionSummary uses MetricCard
13. Responsive padding (`sm:p-6`) on all sub-pages
14. All existing tests pass + new tests for every change
15. TypeScript clean (`tsc --noEmit`), lint clean (`next lint`)
