import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DispatchTabletSidePanel } from './DispatchTabletSidePanel';

const baseProps = {
  vehicleExternalId: 'RTHK-72',
  driverName: 'Mario González',
  packagesLoaded: 148,
  vehicleCapacityPackages: 200,
  ordersCount: 42,
  stopsCount: 30,
  pendingOnDock: 24,
  rejectionCount: 0,
  rejectionTally: [],
  history: [],
  incompleteOrders: [],
  orderBoxCounts: new Map(),
};

describe('DispatchTabletSidePanel', () => {
  it('reuses 1c’s RouteTrackingVehiclePanel verbatim — vehicle, driver and occupancy render', () => {
    render(<DispatchTabletSidePanel {...baseProps} />);
    expect(screen.getByText('RTHK-72')).toBeInTheDocument();
    expect(screen.getByText('Mario González')).toBeInTheDocument();
    expect(screen.getByText(/Ocupación con 148 paquete/)).toBeInTheDocument();
  });

  it('shows órdenes, paradas and en el andén as three stat tiles', () => {
    render(<DispatchTabletSidePanel {...baseProps} />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Órdenes')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('Paradas')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('En el andén')).toBeInTheDocument();
  });

  it('puts rejections/incomplete-orders/history inside the internally-scrolling region (decision 5)', () => {
    render(
      <DispatchTabletSidePanel
        {...baseProps}
        incompleteOrders={[{ orderId: 'o1', orderNumber: 'ORD-1' }]}
      />,
    );
    const scrollRegion = screen.getByTestId('dispatch-tablet-side-scroll');
    expect(scrollRegion).toHaveClass('overflow-y-auto');
    expect(scrollRegion.querySelector('[data-testid="dispatch-tablet-incomplete-orders"]')).not.toBeNull();
  });
});
