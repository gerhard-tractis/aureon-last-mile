import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PreRouteBoard } from './PreRouteBoard';
import type { PreRouteSnapshot } from '@/lib/types';

/**
 * spec-75 phase 6 item 19 — responsive verification.
 *
 * The handoff's *Interactions & Behavior* section (item 19's own wording,
 * quoting a since-removed `design_handoff_aureon_rebrand/README.md`) says
 * the three `1a` columns "collapse to tabs" below 1024px. That is NOT what
 * is built, and this test documents the gap rather than papering over it:
 * `PreRouteBoard` never renders a `Tabs`/`TabsList` (Radix or otherwise) —
 * grep across this component and its three children (`UnroutedColumn`,
 * `RoutePlanCanvas`, `RouteDraftPanel`) turns up zero references to tabs or
 * to `useIsBelowLg`. What actually exists, unchanged since spec-54 phase
 * 4.2 (the component's own docblock: "Below 1024px the columns stack"), is
 * a single CSS grid that is one column by default and switches to the
 * three-column `330px 1fr 322px` layout only at Tailwind's `lg` breakpoint
 * (1024px) — the same threshold `useIsBelowLg` resolves, but reached here
 * through `lg:` utility classes rather than through that hook. All three
 * panels stay mounted and visible below 1024px; none is hidden behind a
 * picker. This test pins that real, verified mechanism so a refactor can't
 * silently drop the responsive collapse — and so nobody mistakes it for
 * the tabbed interaction item 19 describes, which does not exist.
 */

let mockSearchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/app/dispatch',
  useSearchParams: () => mockSearchParams,
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1', role: 'admin', permissions: [], userId: 'u-1' }),
}));

const SNAPSHOT: PreRouteSnapshot = {
  generated_at: '2026-09-04T00:00:00Z',
  totals: { order_count: 0, package_count: 0, anden_count: 0, split_dock_zone_order_count: 0 },
  andenes: [],
  unmapped_comunas: [],
};

const usePreRouteSnapshotMock = vi.fn(() => ({
  snapshot: SNAPSHOT,
  isLoading: false,
  isError: false,
  fetchStatus: 'idle',
  isSuccess: true,
}));
vi.mock('@/hooks/dispatch/pre-route/usePreRouteSnapshot', () => ({
  usePreRouteSnapshot: (...args: unknown[]) => usePreRouteSnapshotMock(...args),
}));

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

beforeEach(() => {
  usePreRouteSnapshotMock.mockClear();
  mockSearchParams = new URLSearchParams();
});

describe('PreRouteBoard — responsive rule (spec-75 fase 6, item 19)', () => {
  it('mounts all three columns unconditionally, with no isBelowLg/tabs branch hiding any of them', () => {
    renderWithClient(<PreRouteBoard onCreateRoute={vi.fn()} />);

    // UnroutedColumn (left) and RouteDraftPanel (right) each carry their own
    // "Armar ruta" action — both present at once is itself proof neither
    // column is hidden behind a tab.
    expect(screen.getAllByText('Armar ruta').length).toBeGreaterThanOrEqual(2);
    // RoutePlanCanvas (centre) — the map placeholder copy
    expect(screen.getByText(/El mapa de rutas propuestas llega con el proveedor de mapas/)).toBeInTheDocument();
    // RouteDraftPanel (right) — empty-selection prompt
    expect(screen.getByText(/Selecciona una o más órdenes/)).toBeInTheDocument();

    // No tab affordance exists to pick between them — collapsing to tabs
    // would require exactly this.
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('renders the three-column grid as a single CSS tree that stacks by default and expands to 330px|1fr|322px at the lg (1024px) breakpoint — not as a hook-driven mobile/desktop branch', () => {
    const { container } = renderWithClient(<PreRouteBoard onCreateRoute={vi.fn()} />);

    const grid = container.querySelector('.lg\\:grid-cols-\\[330px_1fr_322px\\]');
    expect(grid).not.toBeNull();
    // No explicit mobile column count utility (e.g. `grid-cols-1`) — the
    // stacking below `lg` is Grid's implicit single-column default, exactly
    // as the component's own docblock describes.
    expect(grid?.className).not.toMatch(/(?:^|\s)grid-cols-1(?:\s|$)/);
  });
});
