import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchRouteSurface } from './DispatchRouteSurface';
import type { FleetVehicle } from '@/lib/dispatch/types';

// spec-78 — the dock tablet (3a) viewport branch. Split into its own file
// (rather than growing DispatchRouteSurface.test.tsx, already at 358 lines
// before this task) so both files stay closer to the 300-line budget.

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

let mockIsBelowLg = false;
let mockIsDesktop = true;
let mockHasTabletHeight = true;
vi.mock('@/hooks/useViewport', () => ({
  useViewport: () => ({
    isBelowLg: mockIsBelowLg,
    isDesktop: mockIsDesktop,
    isMobile: false,
    hasTabletHeight: mockHasTabletHeight,
  }),
}));

let mockIsDock = false;
vi.mock('@/hooks/useIsDockDevice', () => ({ useIsDockDevice: () => mockIsDock }));

let mockLoadBrief: unknown = undefined;
const useRouteLoadBriefMock = vi.fn(() => ({
  data: mockLoadBrief,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));
vi.mock('@/hooks/dispatch/mobile/useRouteLoadBrief', () => ({
  useRouteLoadBrief: (...args: unknown[]) => useRouteLoadBriefMock(...args),
}));

let mockRouteStatus: string | undefined = 'planned';
vi.mock('@/hooks/dispatch/useDispatchRoute', () => ({
  useDispatchRoute: () => ({ data: mockRouteStatus ? { status: mockRouteStatus } : undefined, isLoading: false }),
}));

vi.mock('./RouteBuilder', () => ({
  RouteBuilder: () => <div data-testid="route-builder-stub" />,
}));
vi.mock('./RouteTrackingView', () => ({
  RouteTrackingView: () => <div data-testid="route-tracking-stub" />,
}));
vi.mock('./mobile/DispatchRouteBeforeScan', () => ({
  DispatchRouteBeforeScan: (props: { onStartScanning: () => void }) => (
    <div data-testid="before-scan-stub">
      <button type="button" onClick={props.onStartScanning}>Empezar a escanear (stub)</button>
    </div>
  ),
}));
vi.mock('./mobile/DispatchVehicleAssignmentSheet', () => ({
  DispatchVehicleAssignmentSheet: () => null,
}));
vi.mock('./mobile/DispatchRouteScanSession', () => ({
  DispatchRouteScanSession: () => <div data-testid="scan-session-stub" />,
}));
const scanSessionTabletPropsSpy = vi.fn();
vi.mock('./mobile/DispatchRouteScanSessionTablet', () => ({
  DispatchRouteScanSessionTablet: (props: { routeCode: string; onViewPackages: () => void }) => {
    scanSessionTabletPropsSpy(props);
    return (
      <div data-testid="scan-session-tablet-stub">
        <button type="button" onClick={props.onViewPackages}>Ver los N (stub)</button>
      </div>
    );
  },
}));
vi.mock('./mobile/DispatchPackagesByStop', () => ({
  DispatchPackagesByStop: () => <div data-testid="packages-by-stop-stub" />,
}));

const vehicles: FleetVehicle[] = [];

describe('DispatchRouteSurface — spec-78 dock tablet (3a) viewport branch', () => {
  beforeEach(() => {
    mockIsBelowLg = false;
    mockIsDesktop = true;
    mockHasTabletHeight = true;
    mockIsDock = false;
    mockRouteStatus = 'planned';
    mockLoadBrief = undefined;
    scanSessionTabletPropsSpy.mockClear();
  });

  it('regression — a NON-dock browser at 1024px still gets the read-only 1c tracking view for a loading route (must not be stolen)', () => {
    mockRouteStatus = 'loading';
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('route-tracking-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('scan-session-tablet-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('before-scan-stub')).not.toBeInTheDocument();
  });

  it('a NON-dock browser at 1024px with NO active route still gets RouteBuilder, never the crew tree', () => {
    mockRouteStatus = 'planned';
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('route-builder-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('before-scan-stub')).not.toBeInTheDocument();
  });

  it('a dock device at tablet size (1024 × 768) gets the crew tree (2c) before scanning starts, whatever the route status', () => {
    mockIsDock = true;
    mockRouteStatus = 'loading'; // must NOT matter to this branch — see DispatchRouteSurface.tsx's own header
    mockLoadBrief = { loadPositionLabel: 'A3', pendingOnDock: 5, ordersCount: 3, stopsCount: 2, vehicleAssignment: null, incompleteOrders: [], comunas: [] };
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('before-scan-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('route-tracking-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('route-builder-stub')).not.toBeInTheDocument();
    expect(useRouteLoadBriefMock).toHaveBeenCalledWith('route-12345678', 'op-1', { enabled: true });
  });

  it('a phone in landscape (844 × 390 — width matches desktop, height does not) never gets the tablet layout, even with the dock flag set', () => {
    mockIsDock = true;
    mockIsDesktop = true;
    mockHasTabletHeight = false; // 390px height — the cut this test pins
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('route-builder-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('before-scan-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scan-session-tablet-stub')).not.toBeInTheDocument();
  });

  it('a dock tablet mounts DispatchRouteScanSessionTablet (3a), not the phone’s 2e, once scanning, passing route status through for Despachar', async () => {
    mockIsDock = true;
    mockRouteStatus = 'loaded';
    mockLoadBrief = {
      loadPositionLabel: 'A3',
      pendingOnDock: 5,
      ordersCount: 3,
      stopsCount: 2,
      vehicleAssignment: { externalVehicleId: 'JKPT-45', driverName: 'Mario González' },
      vehicleCapacityPackages: 200,
      incompleteOrders: [],
      comunas: [],
      orderBoxCounts: new Map(),
    };
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);

    await userEvent.click(screen.getByRole('button', { name: /Empezar a escanear \(stub\)/i }));

    expect(screen.getByTestId('scan-session-tablet-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('scan-session-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('before-scan-stub')).not.toBeInTheDocument();

    const props = scanSessionTabletPropsSpy.mock.calls.at(-1)?.[0];
    expect(props.routeCode).toBe('ROUTE-12');
    expect(props.driverName).toBe('Mario González');
    expect(props.vehicleExternalId).toBe('JKPT-45');
    expect(props.vehicleCapacityPackages).toBe(200);
    expect(props.routeStatus).toBe('loaded');
  });

  it('"Ver los N" on the tablet reuses the same (mobile-shaped) packages-by-stop screen — no third component set', async () => {
    mockIsDock = true;
    mockRouteStatus = 'loading';
    mockLoadBrief = { loadPositionLabel: 'A3', pendingOnDock: 5, ordersCount: 3, stopsCount: 2, vehicleAssignment: null, incompleteOrders: [], comunas: [] };
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);

    await userEvent.click(screen.getByRole('button', { name: /Empezar a escanear \(stub\)/i }));
    await userEvent.click(screen.getByRole('button', { name: /Ver los N \(stub\)/i }));

    expect(screen.getByTestId('packages-by-stop-stub')).toBeInTheDocument();
    expect(screen.getByTestId('scan-session-tablet-stub').closest('[hidden]')).not.toBeNull();
  });
});
