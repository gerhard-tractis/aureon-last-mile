import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DispatchRouteSurface } from './DispatchRouteSurface';
import type { FleetVehicle } from '@/lib/dispatch/types';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

let mockIsBelowLg = false;
vi.mock('@/hooks/useViewport', () => ({ useIsBelowLg: () => mockIsBelowLg }));

let mockLoadBrief: unknown = undefined;
let mockLoadBriefLoading = false;
const useRouteLoadBriefMock = vi.fn(() => ({ data: mockLoadBrief, isLoading: mockLoadBriefLoading }));
vi.mock('@/hooks/dispatch/mobile/useRouteLoadBrief', () => ({
  useRouteLoadBrief: (...args: unknown[]) => useRouteLoadBriefMock(...args),
}));

vi.mock('./RouteBuilder', () => ({
  RouteBuilder: ({ routeId }: { routeId: string }) => <div data-testid="route-builder-stub">{routeId}</div>,
}));

vi.mock('./mobile/DispatchRouteBeforeScan', () => ({
  DispatchRouteBeforeScan: ({ routeCode }: { routeCode: string }) => (
    <div data-testid="before-scan-stub">{routeCode}</div>
  ),
}));

const vehicles: FleetVehicle[] = [];

describe('DispatchRouteSurface', () => {
  it('mounts RouteBuilder (desktop) at or above lg, without ever fetching the load brief', () => {
    mockIsBelowLg = false;
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('route-builder-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('before-scan-stub')).not.toBeInTheDocument();
    expect(useRouteLoadBriefMock).toHaveBeenCalledWith('route-12345678', 'op-1', { enabled: false });
  });

  it('shows a skeleton, not zeroed counts, while the mobile load brief is loading', () => {
    mockIsBelowLg = true;
    mockLoadBriefLoading = true;
    mockLoadBrief = undefined;
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('dispatch-route-surface-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('before-scan-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('route-builder-stub')).not.toBeInTheDocument();
  });

  it('mounts DispatchRouteBeforeScan (mobile), and only that, below lg once loaded', () => {
    mockIsBelowLg = true;
    mockLoadBriefLoading = false;
    mockLoadBrief = { loadPositionLabel: 'A3', pendingOnDock: 5, ordersCount: 3, stopsCount: 2, vehicleAssignment: null, incompleteOrders: [], comunas: [] };
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('before-scan-stub')).toHaveTextContent('ROUTE-12');
    expect(screen.queryByTestId('route-builder-stub')).not.toBeInTheDocument();
    expect(useRouteLoadBriefMock).toHaveBeenCalledWith('route-12345678', 'op-1', { enabled: true });
  });
});
