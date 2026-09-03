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

  it('keeps "Empezar a escanear" enabled with no vehicle assigned (decision 6)', () => {
    render(<DispatchRouteBeforeScan {...baseProps} />);
    const button = screen.getByRole('button', { name: /empezar a escanear/i });
    expect(button).toBeEnabled();
  });

  it('shows "Sin asignar" and the DispatchTrack note when there is no vehicle', () => {
    render(<DispatchRouteBeforeScan {...baseProps} />);
    expect(screen.getByText(/Sin asignar · toca para elegir camión y conductor/)).toBeInTheDocument();
    expect(screen.getByText(/DispatchTrack necesita el identificador del camión/)).toBeInTheDocument();
  });

  it('shows the assigned vehicle and driver when known', () => {
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
});
