import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupPanel } from './PickupPanel';

vi.mock('@/hooks/ops-control/useOpsControlSnapshot', () => ({
  useOpsControlSnapshot: vi.fn(),
}));

import { useOpsControlSnapshot } from '@/hooks/ops-control/useOpsControlSnapshot';

const mockUseSnapshot = vi.mocked(useOpsControlSnapshot);

const MANIFESTS = [
  { id: 'm-1', external_load_id: 'CARGA-001', retailer_name: 'Paris', pickup_point_name: 'CD Paris Juncal', effective_delivery_date: '2026-03-02', order_count: 5, total_packages: 8, status: 'in_progress', reception_status: 'awaiting_reception' },
  { id: 'm-2', external_load_id: 'CARGA-002', retailer_name: 'Easy', pickup_point_name: 'CD Easy Laguna', effective_delivery_date: '2026-03-05', order_count: 3, total_packages: 4, status: 'in_progress', reception_status: 'awaiting_reception' },
  { id: 'm-3', external_load_id: 'CARGA-003', retailer_name: 'Paris', pickup_point_name: 'CD Paris 152', effective_delivery_date: '2026-03-07', order_count: 2, total_packages: 3, status: 'in_progress', reception_status: 'awaiting_reception' },
];

function mockSnapshot(pickups = MANIFESTS) {
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

  it('renders KPIs: En tránsito, Clientes, Puntos pickup, Órdenes', () => {
    render(<PickupPanel {...defaultProps} />);
    expect(screen.getByText('En tránsito')).toBeDefined();
    expect(screen.getByText('Clientes')).toBeDefined();
    expect(screen.getByText('Puntos pickup')).toBeDefined();
    expect(screen.getByText('Órdenes')).toBeDefined();
  });

  it('renders table headers', () => {
    render(<PickupPanel {...defaultProps} />);
    expect(screen.getByText('Carga')).toBeDefined();
    expect(screen.getByText('Cliente')).toBeDefined();
    expect(screen.getByText('Punto Pickup')).toBeDefined();
    expect(screen.getByText('Fecha entrega')).toBeDefined();
  });

  it('renders deep-link to /app/pickup', () => {
    render(<PickupPanel {...defaultProps} />);
    const link = screen.getByRole('link');
    expect((link as HTMLAnchorElement).href).toContain('/app/pickup');
  });

  it('renders a row per manifest', () => {
    render(<PickupPanel {...defaultProps} />);
    expect(screen.getByText('CARGA-001')).toBeDefined();
    expect(screen.getByText('CARGA-002')).toBeDefined();
    expect(screen.getByText('CARGA-003')).toBeDefined();
  });

  it('shows empty state when no manifests', () => {
    mockSnapshot([]);
    render(<PickupPanel {...defaultProps} />);
    expect(screen.getByText('Sin pickups en tránsito')).toBeDefined();
  });

  it('filters by client', async () => {
    render(<PickupPanel {...defaultProps} />);
    const select = screen.getAllByRole('combobox')[0];
    await userEvent.selectOptions(select, 'Easy');
    expect(screen.getByText('CARGA-002')).toBeDefined();
    expect(screen.queryByText('CARGA-001')).toBeNull();
    expect(screen.queryByText('CARGA-003')).toBeNull();
  });

  it('shows clear filters button when filter active', async () => {
    render(<PickupPanel {...defaultProps} />);
    const select = screen.getAllByRole('combobox')[0];
    await userEvent.selectOptions(select, 'Easy');
    expect(screen.getByText('Limpiar filtros')).toBeDefined();
  });
});
