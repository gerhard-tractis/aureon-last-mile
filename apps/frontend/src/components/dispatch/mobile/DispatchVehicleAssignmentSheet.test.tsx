import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/dispatch/mobile/useVehicleAssignmentOptions', () => ({
  useVehicleAssignmentOptions: vi.fn(),
}));
vi.mock('@/hooks/dispatch/mobile/useAssignVehicleAndDriver', () => ({
  useAssignVehicleAndDriver: vi.fn(),
}));

import { useVehicleAssignmentOptions } from '@/hooks/dispatch/mobile/useVehicleAssignmentOptions';
import { useAssignVehicleAndDriver } from '@/hooks/dispatch/mobile/useAssignVehicleAndDriver';
import { DispatchVehicleAssignmentSheet } from './DispatchVehicleAssignmentSheet';
import type { VehiclePickerRow } from '@/lib/dispatch/mobile/vehicle-picker';

const ROWS: VehiclePickerRow[] = [
  {
    id: 'v1',
    externalVehicleId: 'RTHK-72',
    plateNumber: 'RTHK-72',
    vehicleType: 'Camión 3/4',
    driverName: 'Mario González',
    capacityPackages: 240,
    assignable: true,
    blockReason: null,
    blockedByRouteCode: null,
  },
  {
    id: 'v2',
    externalVehicleId: 'ZZ-01',
    plateNumber: null,
    vehicleType: 'Furgón',
    driverName: null,
    capacityPackages: null,
    assignable: false,
    blockReason: 'no_capacity',
    blockedByRouteCode: null,
  },
  {
    id: 'v3',
    externalVehicleId: 'BUSY-1',
    plateNumber: null,
    vehicleType: 'Camión',
    driverName: null,
    capacityPackages: 100,
    assignable: false,
    blockReason: 'blocked',
    blockedByRouteCode: 'A3F91B2C',
  },
];

function mockOptions(overrides: Partial<ReturnType<typeof useVehicleAssignmentOptions>> = {}) {
  (useVehicleAssignmentOptions as ReturnType<typeof vi.fn>).mockReturnValue({
    data: ROWS,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  });
}

function mockAssign(overrides: Partial<ReturnType<typeof useAssignVehicleAndDriver>> = {}) {
  const assign = vi.fn().mockResolvedValue({ ok: true, vehicleId: 'v1', driverName: 'Mario González' });
  (useAssignVehicleAndDriver as ReturnType<typeof vi.fn>).mockReturnValue({
    assign,
    isAssigning: false,
    ...overrides,
  });
  return assign;
}

beforeEach(() => {
  vi.resetAllMocks();
});

// Body uses useQueryClient() (review M1 — invalidates vehicle options after
// a successful assign), so every render needs a real QueryClientProvider.
function renderSheet(ui: JSX.Element) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('DispatchVehicleAssignmentSheet', () => {
  it('does not mount the vehicle-options hook while the sheet is closed (rule 7 — mount-gate, not just enabled:false)', () => {
    mockOptions();
    mockAssign();
    renderSheet(
      <DispatchVehicleAssignmentSheet
        open={false}
        onOpenChange={vi.fn()}
        routeId="route-1"
        routeCode="ABCDEF12"
        operatorId="op-1"
        onAssigned={vi.fn()}
      />,
    );
    expect(useVehicleAssignmentOptions).not.toHaveBeenCalled();
  });

  it('renders the header with route code and the flota-disponible copy', () => {
    mockOptions();
    mockAssign();
    renderSheet(
      <DispatchVehicleAssignmentSheet
        open
        onOpenChange={vi.fn()}
        routeId="route-1"
        routeCode="ABCDEF12"
        operatorId="op-1"
        onAssigned={vi.fn()}
      />,
    );
    expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument();
    expect(screen.getByText(/Camión y conductor/)).toBeInTheDocument();
    expect(
      screen.getByText(/Un camión que ya lleva otra ruta hoy aparece bloqueado/),
    ).toBeInTheDocument();
  });

  it('shows a blocked vehicle labelled with the route that has it, and a no-capacity vehicle as not assignable', () => {
    mockOptions();
    mockAssign();
    renderSheet(
      <DispatchVehicleAssignmentSheet
        open
        onOpenChange={vi.fn()}
        routeId="route-1"
        routeCode="ABCDEF12"
        operatorId="op-1"
        onAssigned={vi.fn()}
      />,
    );
    expect(screen.getByText('EN A3F91B2C')).toBeInTheDocument();
    expect(screen.getByText('Sin capacidad configurada')).toBeInTheDocument();
    // Only ONE selectable radio — the assignable vehicle.
    expect(screen.getAllByRole('radio')).toHaveLength(1);
  });

  it('selecting a vehicle prefills the driver field from its last-known driver', async () => {
    mockOptions();
    mockAssign();
    const user = userEvent.setup();
    renderSheet(
      <DispatchVehicleAssignmentSheet
        open
        onOpenChange={vi.fn()}
        routeId="route-1"
        routeCode="ABCDEF12"
        operatorId="op-1"
        onAssigned={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('radio'));
    expect(screen.getByRole('textbox', { name: /conductor/i })).toHaveValue('Mario González');
  });

  it('caps the driver field at 255 chars — routes.driver_name is VARCHAR(255) (review I5)', () => {
    mockOptions();
    mockAssign();
    renderSheet(
      <DispatchVehicleAssignmentSheet
        open
        onOpenChange={vi.fn()}
        routeId="route-1"
        routeCode="ABCDEF12"
        operatorId="op-1"
        onAssigned={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: /conductor/i })).toHaveAttribute('maxLength', '255');
  });

  it('the primary CTA is disabled until a vehicle is selected', () => {
    mockOptions();
    mockAssign();
    renderSheet(
      <DispatchVehicleAssignmentSheet
        open
        onOpenChange={vi.fn()}
        routeId="route-1"
        routeCode="ABCDEF12"
        operatorId="op-1"
        onAssigned={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Asignar y empezar carga/i })).toBeDisabled();
  });

  it('assigns the selected vehicle and driver, then closes and reports the result', async () => {
    mockOptions();
    const assign = mockAssign();
    const onOpenChange = vi.fn();
    const onAssigned = vi.fn();
    const user = userEvent.setup();
    renderSheet(
      <DispatchVehicleAssignmentSheet
        open
        onOpenChange={onOpenChange}
        routeId="route-1"
        routeCode="ABCDEF12"
        operatorId="op-1"
        onAssigned={onAssigned}
      />,
    );
    await user.click(screen.getByRole('radio'));
    await user.click(screen.getByRole('button', { name: /Asignar y empezar carga/i }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('route-1', 'RTHK-72', 'Mario González'));
    expect(onAssigned).toHaveBeenCalledWith({ vehicleId: 'v1', driverName: 'Mario González' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('surfaces a refusal (e.g. the vehicle got taken by another route) and keeps the sheet open', async () => {
    mockOptions();
    const assign = vi.fn().mockResolvedValue({
      ok: false,
      message: 'Este camión ya lleva otra ruta hoy (A3F91B2C)',
      code: 'VEHICLE_ALREADY_ASSIGNED_TODAY',
    });
    (useAssignVehicleAndDriver as ReturnType<typeof vi.fn>).mockReturnValue({ assign, isAssigning: false });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderSheet(
      <DispatchVehicleAssignmentSheet
        open
        onOpenChange={onOpenChange}
        routeId="route-1"
        routeCode="ABCDEF12"
        operatorId="op-1"
        onAssigned={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('radio'));
    await user.click(screen.getByRole('button', { name: /Asignar y empezar carga/i }));

    await waitFor(() =>
      expect(screen.getByText('Este camión ya lleva otra ruta hoy (A3F91B2C)')).toBeInTheDocument(),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('shows loading skeletons while vehicle options are fetching', () => {
    mockOptions({ data: undefined, isLoading: true });
    mockAssign();
    renderSheet(
      <DispatchVehicleAssignmentSheet
        open
        onOpenChange={vi.fn()}
        routeId="route-1"
        routeCode="ABCDEF12"
        operatorId="op-1"
        onAssigned={vi.fn()}
      />,
    );
    expect(screen.getByTestId('vehicle-assignment-sheet-skeleton')).toBeInTheDocument();
  });
});
