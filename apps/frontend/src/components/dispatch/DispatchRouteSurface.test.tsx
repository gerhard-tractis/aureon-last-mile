import { describe, it, expect, vi } from 'vitest';
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

vi.mock('./RouteBuilder', () => ({
  RouteBuilder: ({ routeId }: { routeId: string }) => <div data-testid="route-builder-stub">{routeId}</div>,
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
vi.mock('./mobile/DispatchRouteScanSession', () => ({
  DispatchRouteScanSession: (props: { routeCode: string; onViewPackages: () => void }) => {
    scanSessionPropsSpy(props);
    return (
      <div data-testid="scan-session-stub">
        {props.routeCode}
        <button type="button" onClick={props.onViewPackages}>Ver los N (stub)</button>
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
  it('mounts RouteBuilder (desktop) at or above lg, without ever fetching the load brief', () => {
    mockIsBelowLg = false;
    mockLoadBriefError = false;
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    expect(screen.getByTestId('route-builder-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('before-scan-stub')).not.toBeInTheDocument();
    expect(useRouteLoadBriefMock).toHaveBeenCalledWith('route-12345678', 'op-1', { enabled: false });
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

  it('spec-76 task 4 (2h) — "Ver los N" swaps the scan session for the packages-by-stop screen, and back', async () => {
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

    await userEvent.click(screen.getByRole('button', { name: /Ver los N \(stub\)/i }));
    expect(screen.getByTestId('packages-by-stop-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('scan-session-stub')).not.toBeInTheDocument();
    const props = packagesByStopPropsSpy.mock.calls.at(-1)?.[0];
    expect(props.routeCode).toBe('ROUTE-12');
    expect(props.ordersCount).toBe(3);
    expect(props.stopsCount).toBe(2);

    await userEvent.click(screen.getByRole('button', { name: /Volver al escaneo \(stub\)/i }));
    expect(screen.getByTestId('scan-session-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('packages-by-stop-stub')).not.toBeInTheDocument();
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
