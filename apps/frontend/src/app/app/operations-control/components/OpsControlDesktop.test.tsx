import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { OpsControlDesktop } from './OpsControlDesktop';

// spec-86 fase 3, ronda 2 (#715, mayor): "No existe OpsControlDesktop.test.tsx
// — la lógica de count/health/delta [de la baldosa Discrepancias] no tiene ni
// un test." This file exists to close exactly that gap — it does not attempt
// to cover the other seven tiles, which already have coverage of their own
// data source (useOpsControlSnapshot) elsewhere.

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/app/operations-control',
}));

const EMPTY_SNAPSHOT = {
  orders: [], routes: [], pickups: [], returns: [], retailerSlaConfig: [], fetchedAt: new Date(),
};
vi.mock('@/hooks/ops-control/useOpsControlSnapshot', () => ({
  useOpsControlSnapshot: () => ({ snapshot: EMPTY_SNAPSHOT, isLoading: false, error: null, lastSyncAt: null }),
}));
vi.mock('@/hooks/ops-control/useAtRiskOrders', () => ({
  useAtRiskOrders: () => ({ orders: [], total: 0, pageCount: 0 }),
}));
vi.mock('@/hooks/ops-control/useDayPromise', () => ({
  useDayPromise: () => ({ total: 0, delivered: 0, inFlight: 0, atRisk: 0, late: 0, segments: [], isLoading: false }),
}));
vi.mock('@/hooks/useActiveRoutes', () => ({
  useActiveRoutes: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/hooks/ops-control/useDiscrepancies', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/ops-control/useDiscrepancies')>();
  return { ...actual, useDiscrepancies: vi.fn() };
});
import { useDiscrepancies } from '@/hooks/ops-control/useDiscrepancies';
const mockUseDiscrepancies = vi.mocked(useDiscrepancies);

function discrepancyTile(): HTMLElement {
  const tile = screen.getByTestId('stage-health-discrepancies').closest('button');
  if (!tile) throw new Error('discrepancies tile button not found');
  return tile as HTMLElement;
}

function discrepancyCount(): string | null {
  return discrepancyTile().querySelector('.font-mono.text-\\[25px\\]')?.textContent ?? null;
}

describe('OpsControlDesktop — Discrepancias tile', () => {
  beforeEach(() => {
    mockUseDiscrepancies.mockReset();
  });

  it('shows "—" and neutral health while still loading (no cache yet)', () => {
    mockUseDiscrepancies.mockReturnValue({
      data: undefined, isLoading: true, isError: false, fetchStatus: 'fetching',
    } as unknown as ReturnType<typeof useDiscrepancies>);
    render(<OpsControlDesktop operatorId="op-1" />);
    expect(discrepancyCount()).toBe('—');
    expect(screen.getByTestId('stage-health-discrepancies').className).toContain('bg-border');
  });

  it('shows "—" and neutral health when the query is paused (offline)', () => {
    // TanStack Query networkMode:'online' leaves an offline query in
    // fetchStatus 'paused' with isLoading=false and isError=false — the
    // exact combination `?? 0` used to read as a confident, wrong zero.
    mockUseDiscrepancies.mockReturnValue({
      data: undefined, isLoading: false, isError: false, fetchStatus: 'paused',
    } as unknown as ReturnType<typeof useDiscrepancies>);
    render(<OpsControlDesktop operatorId="op-1" />);
    expect(discrepancyCount()).toBe('—');
    expect(screen.getByTestId('stage-health-discrepancies').className).toContain('bg-border');
  });

  it('shows "—" and neutral health when the RPC errored', () => {
    mockUseDiscrepancies.mockReturnValue({
      data: undefined, isLoading: false, isError: true, fetchStatus: 'idle',
    } as unknown as ReturnType<typeof useDiscrepancies>);
    render(<OpsControlDesktop operatorId="op-1" />);
    expect(discrepancyCount()).toBe('—');
    expect(screen.getByTestId('stage-health-discrepancies').className).toContain('bg-border');
  });

  it('shows a real zero with "ok" health once resolved with no open discrepancies', () => {
    mockUseDiscrepancies.mockReturnValue({
      data: [], isLoading: false, isError: false, fetchStatus: 'idle',
    } as unknown as ReturnType<typeof useDiscrepancies>);
    render(<OpsControlDesktop operatorId="op-1" />);
    expect(discrepancyCount()).toBe('0');
    expect(screen.getByTestId('stage-health-discrepancies').className).toContain('bg-status-success');
    expect(within(discrepancyTile()).getByText('Sin incidencias')).toBeInTheDocument();
  });

  it('shows the real count with "warn" health when there are open discrepancies', () => {
    mockUseDiscrepancies.mockReturnValue({
      data: [{ id: 'd-1', total_count: 2 }, { id: 'd-2', total_count: 2 }],
      isLoading: false, isError: false, fetchStatus: 'idle',
    } as unknown as ReturnType<typeof useDiscrepancies>);
    render(<OpsControlDesktop operatorId="op-1" />);
    expect(discrepancyCount()).toBe('2');
    expect(screen.getByTestId('stage-health-discrepancies').className).toContain('bg-status-warning');
    expect(within(discrepancyTile()).getByText('2 sin resolver')).toBeInTheDocument();
  });

  it('says "N de M" and shows the real total when LIMIT 500 truncated the rows (#715 M3)', () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `d-${i}`, total_count: 617 }));
    mockUseDiscrepancies.mockReturnValue({
      data: rows, isLoading: false, isError: false, fetchStatus: 'idle',
    } as unknown as ReturnType<typeof useDiscrepancies>);
    render(<OpsControlDesktop operatorId="op-1" />);
    expect(discrepancyCount()).toBe('617');
    expect(within(discrepancyTile()).getByText('3 de 617 sin resolver')).toBeInTheDocument();
  });
});
