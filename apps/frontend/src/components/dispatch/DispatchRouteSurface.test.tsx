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
  DispatchRouteBeforeScan: (props: { routeCode: string; onAssignVehicle: () => void }) => {
    beforeScanPropsSpy(props);
    return (
      <div data-testid="before-scan-stub">
        {props.routeCode}
        <button type="button" onClick={props.onAssignVehicle}>Asignar vehículo (stub)</button>
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

  it('spec-76 task 2 — 2d now exists: only the scan CTA (2e, task 4) stays disabled', () => {
    mockIsBelowLg = true;
    mockLoadBriefLoading = false;
    mockLoadBriefError = false;
    mockLoadBrief = { loadPositionLabel: null, pendingOnDock: 0, ordersCount: 0, stopsCount: 0, vehicleAssignment: null, incompleteOrders: [], comunas: [] };
    render(<DispatchRouteSurface routeId="route-12345678" operatorId="op-1" vehicles={vehicles} />);
    const props = beforeScanPropsSpy.mock.calls.at(-1)?.[0];
    expect(props.startScanningDisabledReason).toBeTruthy();
    expect(props.assignVehicleDisabledReason).toBeFalsy();
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
