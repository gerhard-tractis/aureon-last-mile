import { useEffect, useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchRouteSurface } from './DispatchRouteSurface';
import type { FleetVehicle } from '@/lib/dispatch/types';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

let mockIsBelowLg = false;
vi.mock('@/hooks/useViewport', () => ({ useIsBelowLg: () => mockIsBelowLg }));

let mockLoadBrief: unknown = undefined;
let mockLoadBriefLoading = false;
let mockLoadBriefError = false;
const refetchLoadBriefMock = vi.fn();
const useRouteLoadBriefMock = vi.fn(() => ({
  data: mockLoadBrief,
  isLoading: mockLoadBriefLoading,
  isError: mockLoadBriefError,
  refetch: refetchLoadBriefMock,
}));
vi.mock('@/hooks/dispatch/mobile/useRouteLoadBrief', () => ({
  useRouteLoadBrief: (...args: unknown[]) => useRouteLoadBriefMock(...args),
}));

// spec-75 phase 4 — desktop route-status read that decides RouteBuilder vs
// the read-only 1c tracking view. Defaults to a non-`loading` status so
// every pre-existing desktop test here (written before phase 4) keeps
// landing on RouteBuilder without having to know about this branch.
let mockRouteStatus: string | undefined = 'planned';
let mockRouteLoading = false;
const useDispatchRouteMock = vi.fn(() => ({
  data: mockRouteStatus ? { status: mockRouteStatus } : undefined,
  isLoading: mockRouteLoading,
}));
vi.mock('@/hooks/dispatch/useDispatchRoute', () => ({
  useDispatchRoute: (...args: unknown[]) => useDispatchRouteMock(...args),
}));

vi.mock('./RouteBuilder', () => ({
  RouteBuilder: ({ routeId }: { routeId: string }) => <div data-testid="route-builder-stub">{routeId}</div>,
}));

vi.mock('./RouteTrackingView', () => ({
  RouteTrackingView: ({ routeId }: { routeId: string }) => <div data-testid="route-tracking-stub">{routeId}</div>,
}));

const beforeScanPropsSpy = vi.fn();
vi.mock('./mobile/DispatchRouteBeforeScan', () => ({
  DispatchRouteBeforeScan: (props: { routeCode: string; onAssignVehicle: () => void; onStartScanning: () => void }) => {
    beforeScanPropsSpy(props);
    return (
      <div data-testid="before-scan-stub">
        {props.routeCode}
        <button type="button" onClick={props.onAssignVehicle}>Asignar vehículo (stub)</button>
        <button type="button" onClick={props.onStartScanning}>Empezar a escanear (stub)</button>
      </div>
    );
  },
}));

const scanSessionPropsSpy = vi.fn();
const scanSessionMountSpy = vi.fn();
const scanSessionUnmountSpy = vi.fn();
vi.mock('./mobile/DispatchRouteScanSession', () => ({
  // spec-76 review C1 — this stub owns REAL internal state ("history") and
  // reports its own mount/unmount lifecycle, so the regression test below
  // can prove the fix structurally: the component is never removed from
  // the tree (mount called once, unmount never called) across a "Ver los
  // N" -> "Volver al escaneo" round trip, which is what keeps its (and the
  // real component's `useRouteScanSession`) internal state alive. A prop
  // spy alone cannot show this — DispatchRouteScanSession's real state
  // lives in a hook `DispatchRouteSurface` never touches.
  DispatchRouteScanSession: (props: { routeCode: string; onViewPackages: () => void }) => {
    scanSessionPropsSpy(props);
    const [history, setHistory] = useState<string[]>([]);
    useEffect(() => {
      scanSessionMountSpy();
      return () => scanSessionUnmountSpy();
    }, []);
    return (
      <div data-testid="scan-session-stub">
        {props.routeCode}
        <button type="button" onClick={props.onViewPackages}>Ver los N (stub)</button>
        <button type="button" onClick={() => setHistory((h) => [...h, `scan-${h.length + 1}`])}>
          Simular escaneo (stub)
        </button>
        <ul data-testid="scan-session-history">
          {history.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </div>
    );
  },
}));

const packagesByStopPropsSpy = vi.fn();
vi.mock('./mobile/DispatchPackagesByStop', () => ({
  DispatchPackagesByStop: (props: { routeCode: string; onBack: () => void }) => {
    packagesByStopPropsSpy(props);
    return (
      <div data-testid="packages-by-stop-stub">
        {props.routeCode}
        <button type="button" onClick={props.onBack}>Volver al escaneo (stub)</button>
      </div>
    );
  },
}));

const assignmentSheetPropsSpy = vi.fn();
vi.mock('./mobile/DispatchVehicleAssignmentSheet', () => ({
  DispatchVehicleAssignmentSheet: (props: {
    open: boolean;
    onAssigned: (r: { vehicleId: string; driverName: string | null }) => void;
  }) => {
    assignmentSheetPropsSpy(props);
    return props.open ? (
      <div data-testid="assignment-sheet-stub">
        <button type="button" onClick={() => props.onAssigned({ vehicleId: 'v1', driverName: 'Mario' })}>
          Confirmar (stub)
        </button>
      </div>
    ) : null;
  },
}));

const vehicles: FleetVehicle[] = [];

describe('DispatchRouteSurface', () => {
  beforeEach(() => {
    mockRouteStatus = 'planned';
    mockRouteLoading = false;
  });

  it('mounts RouteBuilder (desktop) at or above lg for a non-loading route, without ever fetching the load brief', () => {
    mockIsBelowLg = false;
    mockLoadBriefError = false;
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('route-builder-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('before-scan-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('route-tracking-stub')).not.toBeInTheDocument();
    expect(useRouteLoadBriefMock).toHaveBeenCalledWith('route-12345678', 'op-1', { enabled: false });
    expect(useDispatchRouteMock).toHaveBeenCalledWith('route-12345678', 'op-1', true);
  });

  it('spec-75 phase 4 — mounts the read-only RouteTrackingView (1c) on desktop when the route status is loading', () => {
    mockIsBelowLg = false;
    mockRouteStatus = 'loading';
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('route-tracking-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('route-builder-stub')).not.toBeInTheDocument();
  });

  it('spec-75 phase 4 — mounts RouteBuilder for a loaded route (Despachar stays on desktop, decision 4)', () => {
    mockIsBelowLg = false;
    mockRouteStatus = 'loaded';
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('route-builder-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('route-tracking-stub')).not.toBeInTheDocument();
  });

  it('shows a skeleton on desktop while the route status is still loading, not a guess at RouteBuilder vs RouteTrackingView', () => {
    mockIsBelowLg = false;
    mockRouteLoading = true;
    mockRouteStatus = undefined;
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('dispatch-route-surface-desktop-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('route-builder-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('route-tracking-stub')).not.toBeInTheDocument();
  });

  // Phase-4 review minor — the `route?.status === 'loading'` check falls
  // through to RouteBuilder for every other case by construction, but that
  // was never pinned: a status further along the lifecycle (dispatched,
  // completed) or a route the status read genuinely failed on (`route` is
  // `undefined` post-load, not just pre-load — `isLoading` is false here)
  // must still render something actionable, not a blank screen.
  it.each(['dispatched', 'completed'] as const)(
    'falls through to RouteBuilder for a %s route, not a blank screen',
    (status) => {
      mockIsBelowLg = false;
      mockRouteStatus = status;
      render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
      expect(screen.getByTestId('route-builder-stub')).toBeInTheDocument();
      expect(screen.queryByTestId('route-tracking-stub')).not.toBeInTheDocument();
    },
  );

  it('falls through to RouteBuilder when the status read has settled but returned no route (failed/not found)', () => {
    mockIsBelowLg = false;
    mockRouteLoading = false;
    mockRouteStatus = undefined; // useDispatchRoute mock -> { data: undefined, isLoading: false }
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('route-builder-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('route-tracking-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dispatch-route-surface-desktop-skeleton')).not.toBeInTheDocument();
  });

  it('shows a skeleton, not zeroed counts, while the mobile load brief is loading', () => {
    mockIsBelowLg = true;
    mockLoadBriefLoading = true;
    mockLoadBriefError = false;
    mockLoadBrief = undefined;
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('dispatch-route-surface-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('before-scan-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('route-builder-stub')).not.toBeInTheDocument();
  });

  it('mounts DispatchRouteBeforeScan (mobile), and only that, below lg once loaded', () => {
    mockIsBelowLg = true;
    mockLoadBriefLoading = false;
    mockLoadBriefError = false;
    mockLoadBrief = { loadPositionLabel: 'A3', pendingOnDock: 5, ordersCount: 3, stopsCount: 2, vehicleAssignment: null, incompleteOrders: [], comunas: [] };
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('before-scan-stub')).toHaveTextContent('ROUTE-12');
    expect(screen.queryByTestId('route-builder-stub')).not.toBeInTheDocument();
    expect(useRouteLoadBriefMock).toHaveBeenCalledWith('route-12345678', 'op-1', { enabled: true });
  });

  it('spec-76 task 3 — 2e now exists: the scan CTA is no longer a disabled no-op', () => {
    mockIsBelowLg = true;
    mockLoadBriefLoading = false;
    mockLoadBriefError = false;
    mockLoadBrief = { loadPositionLabel: null, pendingOnDock: 0, ordersCount: 0, stopsCount: 0, vehicleAssignment: null, incompleteOrders: [], comunas: [] };
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    const props = beforeScanPropsSpy.mock.calls.at(-1)?.[0];
    expect(props.startScanningDisabledReason).toBeUndefined();
    expect(props.assignVehicleDisabledReason).toBeFalsy();
  });

  it('spec-76 task 3 — pressing "Empezar a escanear" swaps 2c for the scan session (2e), passing route/vehicle context through', async () => {
    mockIsBelowLg = true;
    mockLoadBriefLoading = false;
    mockLoadBriefError = false;
    mockLoadBrief = {
      loadPositionLabel: 'A3',
      pendingOnDock: 5,
      ordersCount: 3,
      stopsCount: 2,
      vehicleAssignment: { externalVehicleId: 'JKPT-45', driverName: 'Mario González' },
      incompleteOrders: [],
      comunas: [],
    };
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);

    expect(screen.queryByTestId('scan-session-stub')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Empezar a escanear \(stub\)/i }));

    expect(screen.getByTestId('scan-session-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('before-scan-stub')).not.toBeInTheDocument();
    const props = scanSessionPropsSpy.mock.calls.at(-1)?.[0];
    expect(props.routeCode).toBe('ROUTE-12');
    expect(props.loadPositionLabel).toBe('A3');
    expect(props.driverName).toBe('Mario González');
    expect(props.vehicleExternalId).toBe('JKPT-45');
  });

  it('opens the vehicle assignment sheet from the 2c CTA, and refetches the load brief once assigned', async () => {
    mockIsBelowLg = true;
    mockLoadBriefLoading = false;
    mockLoadBriefError = false;
    mockLoadBrief = { loadPositionLabel: null, pendingOnDock: 0, ordersCount: 0, stopsCount: 0, vehicleAssignment: null, incompleteOrders: [], comunas: [] };
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);

    expect(screen.queryByTestId('assignment-sheet-stub')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Asignar vehículo \(stub\)/i }));
    expect(screen.getByTestId('assignment-sheet-stub')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Confirmar \(stub\)/i }));
    expect(refetchLoadBriefMock).toHaveBeenCalled();
  });

  it('spec-76 task 4 (2h) — "Ver los N" shows the packages-by-stop screen over the (hidden, not unmounted) scan session, and back', async () => {
    mockIsBelowLg = true;
    mockLoadBriefLoading = false;
    mockLoadBriefError = false;
    mockLoadBrief = {
      loadPositionLabel: 'A3',
      pendingOnDock: 5,
      ordersCount: 3,
      stopsCount: 2,
      vehicleAssignment: { externalVehicleId: 'JKPT-45', driverName: 'Mario González' },
      incompleteOrders: [],
      comunas: [],
    };
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);

    await userEvent.click(screen.getByRole('button', { name: /Empezar a escanear \(stub\)/i }));
    expect(screen.getByTestId('scan-session-stub')).toBeInTheDocument();
    expect(screen.getByTestId('scan-session-stub').closest('[hidden]')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Ver los N \(stub\)/i }));
    expect(screen.getByTestId('packages-by-stop-stub')).toBeInTheDocument();
    // spec-76 review C1 — still IN the DOM (not unmounted), just hidden.
    expect(screen.getByTestId('scan-session-stub')).toBeInTheDocument();
    expect(screen.getByTestId('scan-session-stub').closest('[hidden]')).not.toBeNull();
    const props = packagesByStopPropsSpy.mock.calls.at(-1)?.[0];
    expect(props.routeCode).toBe('ROUTE-12');
    expect(props.ordersCount).toBe(3);
    expect(props.stopsCount).toBe(2);

    await userEvent.click(screen.getByRole('button', { name: /Volver al escaneo \(stub\)/i }));
    expect(screen.getByTestId('scan-session-stub')).toBeInTheDocument();
    expect(screen.getByTestId('scan-session-stub').closest('[hidden]')).toBeNull();
    expect(screen.queryByTestId('packages-by-stop-stub')).not.toBeInTheDocument();
  });

  it('spec-76 review C1 — scan session history survives opening and closing 2h (the component is never unmounted)', async () => {
    mockIsBelowLg = true;
    mockLoadBriefLoading = false;
    mockLoadBriefError = false;
    mockLoadBrief = {
      loadPositionLabel: 'A3',
      pendingOnDock: 5,
      ordersCount: 3,
      stopsCount: 2,
      vehicleAssignment: { externalVehicleId: 'JKPT-45', driverName: 'Mario González' },
      incompleteOrders: [],
      comunas: [],
    };
    scanSessionMountSpy.mockClear();
    scanSessionUnmountSpy.mockClear();
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);

    await userEvent.click(screen.getByRole('button', { name: /Empezar a escanear \(stub\)/i }));
    expect(scanSessionMountSpy).toHaveBeenCalledTimes(1);

    // Simulate a scan landing in the session's own history before 2h opens.
    await userEvent.click(screen.getByRole('button', { name: /Simular escaneo \(stub\)/i }));
    expect(screen.getByTestId('scan-session-history')).toHaveTextContent('scan-1');

    await userEvent.click(screen.getByRole('button', { name: /Ver los N \(stub\)/i }));
    await userEvent.click(screen.getByRole('button', { name: /Volver al escaneo \(stub\)/i }));

    // Never remounted, so the history a real DispatchRouteScanSession would
    // hold in useRouteScanSession's useState survives the round trip.
    expect(scanSessionMountSpy).toHaveBeenCalledTimes(1);
    expect(scanSessionUnmountSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('scan-session-history')).toHaveTextContent('scan-1');
  });

  it('spec-76 review M6 — shows a retry, not zeroed counts, when the load brief errors', async () => {
    mockIsBelowLg = true;
    mockLoadBriefLoading = false;
    mockLoadBriefError = true;
    mockLoadBrief = undefined;
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('dispatch-route-surface-error')).toBeInTheDocument();
    expect(screen.queryByTestId('before-scan-stub')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(refetchLoadBriefMock).toHaveBeenCalled();
  });
});
