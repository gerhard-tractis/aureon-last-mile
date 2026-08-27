import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * QA finding #2 (second cause): the header's "SIN RUTEAR" figure used to
 * come from `usePreRouteSnapshot(operatorId, today)` — hardcoded to today —
 * while PreRouteBoard reads its date from the `?date=` search param. Planning
 * tomorrow's wave (picking a date in PreRouteFilters) left the header still
 * counting today's unrouted orders while the board below showed tomorrow's,
 * so the two numbers could disagree by construction.
 */

let mockSearchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/app/dispatch',
  useSearchParams: () => mockSearchParams,
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

vi.mock('@/hooks/dispatch/useDispatchKPIs', () => ({
  useDispatchKPIs: () => ({ data: { openRoutes: 0, inRoute: 0 }, isLoading: false }),
}));

vi.mock('@/hooks/dispatch/pre-route/useCreateRouteFromSelection', () => ({
  useCreateRouteFromSelection: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/dispatch/useDispatchRoutesByStatus', () => ({
  useDispatchRoutesByStatus: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/components/dispatch/pre-route/PreRouteBoard', () => ({
  PreRouteBoard: () => null,
}));

vi.mock('@/components/dispatch/DispatchInProgressTab', () => ({
  DispatchInProgressTab: () => null,
}));

const usePreRouteSnapshotMock = vi.fn(() => ({
  snapshot: { totals: { order_count: 0 } },
  isLoading: false,
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

describe('DispatchPage — SIN RUTEAR follows the selected date', () => {
  it('queries the pre-route snapshot for today when no ?date= is set', async () => {
    const { default: DispatchPage } = await import('./page');
    renderWithClient(<DispatchPage />);
    const today = new Date().toISOString().slice(0, 10);
    expect(usePreRouteSnapshotMock).toHaveBeenCalledWith('op-1', today, null, null);
  });

  it('queries the pre-route snapshot for the ?date= param, not today — the same date PreRouteBoard reads', async () => {
    mockSearchParams = new URLSearchParams('date=2026-09-15');
    const { default: DispatchPage } = await import('./page');
    renderWithClient(<DispatchPage />);
    expect(usePreRouteSnapshotMock).toHaveBeenCalledWith('op-1', '2026-09-15', null, null);
  });

  // Code review on #556: the date fix alone still let the header disagree
  // with the board on the *window* axis — picking "Mañana" narrowed the
  // board's totals line while the header went on counting the whole day.
  // Both callers now resolve `?window=` through the same
  // resolvePreRouteWindow PreRouteBoard uses.
  it("queries the pre-route snapshot for the ?window= param's bounds, matching what PreRouteBoard passes", async () => {
    mockSearchParams = new URLSearchParams('date=2026-09-15&window=manana');
    const { default: DispatchPage } = await import('./page');
    renderWithClient(<DispatchPage />);
    expect(usePreRouteSnapshotMock).toHaveBeenCalledWith('op-1', '2026-09-15', '00:00', '12:00');
  });

  it('passes null window bounds for the "todas" default, same as no ?window= at all', async () => {
    mockSearchParams = new URLSearchParams('date=2026-09-15&window=todas');
    const { default: DispatchPage } = await import('./page');
    renderWithClient(<DispatchPage />);
    expect(usePreRouteSnapshotMock).toHaveBeenCalledWith('op-1', '2026-09-15', null, null);
  });
});
