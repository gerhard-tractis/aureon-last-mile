import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupPanel } from './PickupPanel';

vi.mock('@/hooks/ops-control/useOpsControlSnapshot', () => ({
  useOpsControlSnapshot: vi.fn(),
}));

import { useOpsControlSnapshot } from '@/hooks/ops-control/useOpsControlSnapshot';

const mockUseSnapshot = vi.mocked(useOpsControlSnapshot);

const ORDERS = [
  {
    id: 'o-1', order_number: '67823485', customer_name: 'Constanza Lagos',
    retailer_name: 'Paris', external_load_id: '45021609', pickup_point_name: 'CD Paris Juncal',
    effective_delivery_date: '2026-03-02', comuna: 'Ñuñoa', status: 'verificado',
    packages: [{ id: 'p-1', label: 'DD033412141', status: 'verificado', declared_box_count: 1 }],
  },
  {
    id: 'o-2', order_number: '2916909648', customer_name: 'Juan Perez',
    retailer_name: 'Easy', external_load_id: 'CARGA001', pickup_point_name: 'CD Easy Laguna',
    effective_delivery_date: '2026-03-05', comuna: 'Las Condes', status: 'verificado',
    packages: [{ id: 'p-2', label: 'LPNCL003305', status: 'verificado', declared_box_count: 1 }],
  },
];

function mockSnapshot(pickups = ORDERS) {
  mockUseSnapshot.mockReturnValue({
    snapshot: {
      orders: [], routes: [], pickups, returns: [],
      retailerSlaConfig: [], fetchedAt: new Date(),
    },
    isLoading: false,
    error: null,
    lastSyncAt: new Date(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSnapshot();
});

describe('PickupPanel', () => {
  const defaultProps = { operatorId: 'op-1', lastSyncAt: null };

  it('renders title "Recogida"', () => {
    render(<PickupPanel {...defaultProps} />);
    expect(screen.getByTestId('drilldown-title').textContent).toBe('Recogida');
  });

  it('renders KPIs', () => {
    render(<PickupPanel {...defaultProps} />);
    expect(screen.getAllByText('Órdenes').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bultos').length).toBeGreaterThan(0);
    expect(screen.getByText('Clientes')).toBeDefined();
    expect(screen.getByText('Puntos pickup')).toBeDefined();
  });

  it('renders order-level table headers', () => {
    render(<PickupPanel {...defaultProps} />);
    expect(screen.getByText('Orden')).toBeDefined();
    expect(screen.getByText('Cliente')).toBeDefined();
    expect(screen.getByText('Punto Pickup')).toBeDefined();
    expect(screen.getByText('Fecha entrega')).toBeDefined();
    expect(screen.getByText('Comuna')).toBeDefined();
  });

  it('renders a row per order', () => {
    render(<PickupPanel {...defaultProps} />);
    expect(screen.getByText('67823485')).toBeDefined();
    expect(screen.getByText('2916909648')).toBeDefined();
  });

  it('expands order to show packages on click', async () => {
    render(<PickupPanel {...defaultProps} />);
    expect(screen.queryByText('DD033412141')).toBeNull();

    const row = screen.getByText('67823485').closest('tr')!;
    await userEvent.click(row);

    expect(screen.getByText('DD033412141')).toBeDefined();
    expect(screen.getByText('Etiqueta')).toBeDefined();
  });

  it('filters by client', async () => {
    render(<PickupPanel {...defaultProps} />);
    const select = screen.getAllByRole('combobox')[0];
    await userEvent.selectOptions(select, 'Easy');
    expect(screen.getByText('2916909648')).toBeDefined();
    expect(screen.queryByText('67823485')).toBeNull();
  });

  it('shows empty state', () => {
    mockSnapshot([]);
    render(<PickupPanel {...defaultProps} />);
    expect(screen.getByText('Sin órdenes en esta etapa')).toBeDefined();
  });

  it('renders deep-link to /app/pickup', () => {
    render(<PickupPanel {...defaultProps} />);
    const link = screen.getByRole('link');
    expect((link as HTMLAnchorElement).href).toContain('/app/pickup');
  });
});
