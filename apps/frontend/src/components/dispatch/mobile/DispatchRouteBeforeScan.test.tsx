import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchRouteBeforeScan } from './DispatchRouteBeforeScan';

const baseProps = {
  routeCode: 'ABCDEF12',
  loadPositionLabel: 'Andén A3',
  pendingOnDock: 71,
  ordersCount: 37,
  stopsCount: 14,
  vehicleAssignment: null,
  incompleteOrders: [],
  comunas: [
    { comuna: 'Santiago', count: 20 },
    { comuna: 'Providencia', count: 17 },
  ],
  onBack: vi.fn(),
  onStartScanning: vi.fn(),
  onAssignVehicle: vi.fn(),
};

describe('DispatchRouteBeforeScan', () => {
  it('shows andén, órdenes and paradas counts, and comunas de la ruta', () => {
    render(<DispatchRouteBeforeScan {...baseProps} />);
    expect(screen.getByText('71')).toBeInTheDocument();
    expect(screen.getByText('En el andén')).toBeInTheDocument();
    expect(screen.getByText('37')).toBeInTheDocument();
    expect(screen.getByText('Órdenes')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('Paradas')).toBeInTheDocument();
    expect(screen.getByText('Santiago')).toBeInTheDocument();
    expect(screen.getByText('Providencia')).toBeInTheDocument();
  });

  it('names the consequence of an incomplete order and lists the ORD- codes', () => {
    render(
      <DispatchRouteBeforeScan
        {...baseProps}
        incompleteOrders={[{ orderId: 'o1', orderNumber: 'ORD-4021' }, { orderId: 'o2', orderNumber: 'ORD-4099' }]}
      />,
    );
    expect(screen.getByText(/el cliente recibe en dos visitas/)).toBeInTheDocument();
    expect(screen.getByText('ORD-4021')).toBeInTheDocument();
    expect(screen.getByText('ORD-4099')).toBeInTheDocument();
  });

  it('renders no warning when nothing is incomplete', () => {
    render(<DispatchRouteBeforeScan {...baseProps} />);
    expect(screen.queryByTestId('dispatch-incomplete-orders-warning')).not.toBeInTheDocument();
  });

  it('keeps "Empezar a escanear" enabled with no vehicle assigned, absent a disabled reason (decision 6)', () => {
    render(<DispatchRouteBeforeScan {...baseProps} />);
    const button = screen.getByRole('button', { name: /empezar a escanear/i });
    expect(button).toBeEnabled();
  });

  it('shows "Sin asignar" and the DispatchTrack note when there is no vehicle', () => {
    render(<DispatchRouteBeforeScan {...baseProps} />);
    expect(screen.getByText(/Sin asignar · toca para elegir camión y conductor/)).toBeInTheDocument();
    expect(screen.getByText(/DispatchTrack necesita el identificador del camión/)).toBeInTheDocument();
  });

  // spec-76 review I7 — routes.vehicle_id is only ever written by the
  // dispatch handler, after `loaded`; every route this screen can show
  // today has it NULL. This fixture is only realistic for the post-2d
  // future once `2d` starts persisting an earlier assignment — it is not a
  // state a route can be in right now.
  it('renders the assigned vehicle and driver once populated (post-2d future — NULL for every route today)', () => {
    render(
      <DispatchRouteBeforeScan
        {...baseProps}
        vehicleAssignment={{ externalVehicleId: 'ZALDUENDO-12', driverName: 'Mario González' }}
      />,
    );
    expect(screen.getByText(/ZALDUENDO-12 · Mario González/)).toBeInTheDocument();
  });

  it('calls onStartScanning / onAssignVehicle / onBack', async () => {
    const onStartScanning = vi.fn();
    const onAssignVehicle = vi.fn();
    const onBack = vi.fn();
    render(
      <DispatchRouteBeforeScan
        {...baseProps}
        onStartScanning={onStartScanning}
        onAssignVehicle={onAssignVehicle}
        onBack={onBack}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /empezar a escanear/i }));
    expect(onStartScanning).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /asignar camión y conductor/i }));
    expect(onAssignVehicle).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /volver/i }));
    expect(onBack).toHaveBeenCalled();
  });

  describe('spec-76 review C1 — disabled reason', () => {
    it('disables "Empezar a escanear" and shows why, when a reason is given', async () => {
      const onStartScanning = vi.fn();
      render(
        <DispatchRouteBeforeScan
          {...baseProps}
          onStartScanning={onStartScanning}
          startScanningDisabledReason="El escaneo llega en el próximo paso"
        />,
      );
      const button = screen.getByRole('button', { name: /empezar a escanear/i });
      expect(button).toBeDisabled();
      expect(screen.getByText('El escaneo llega en el próximo paso')).toBeInTheDocument();
      await userEvent.click(button);
      expect(onStartScanning).not.toHaveBeenCalled();
    });

    it('disables "Asignar camión y conductor" and shows why, when a reason is given', async () => {
      const onAssignVehicle = vi.fn();
      render(
        <DispatchRouteBeforeScan
          {...baseProps}
          onAssignVehicle={onAssignVehicle}
          assignVehicleDisabledReason="La asignación llega en el próximo paso"
        />,
      );
      const button = screen.getByRole('button', { name: /asignar camión y conductor/i });
      expect(button).toBeDisabled();
      expect(screen.getByText('La asignación llega en el próximo paso')).toBeInTheDocument();
      await userEvent.click(button);
      expect(onAssignVehicle).not.toHaveBeenCalled();
    });
  });
});
