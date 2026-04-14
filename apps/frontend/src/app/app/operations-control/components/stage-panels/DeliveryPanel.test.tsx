import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeliveryPanel } from './DeliveryPanel';

vi.mock('@/hooks/ops-control/useStageBreakdown', () => ({
  useStageBreakdown: vi.fn(),
}));

import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';

const mockUseStageBreakdown = vi.mocked(useStageBreakdown);

const NEUTRAL = { status: 'neutral', delta: '—', reasonsByOrder: new Map() };

const ORDERS = [
  { id: 'o-1', order_number: 'ORD-030', retailer_name: 'Paris', pickup_point_name: 'CD Paris', external_load_id: 'L1', effective_delivery_date: '2026-03-02', comuna: 'Ñuñoa', status: 'en_ruta', packages: [] },
  { id: 'o-2', order_number: 'ORD-031', retailer_name: 'Easy', pickup_point_name: 'CD Easy', external_load_id: 'L2', effective_delivery_date: '2026-03-05', comuna: 'Las Condes', status: 'en_ruta', packages: [] },
];

beforeEach(() => {
  mockUseStageBreakdown.mockReturnValue({ rows: [], total: 0, pageCount: 1, stageHealth: NEUTRAL });
});

describe('DeliveryPanel', () => {
  const defaultProps = { operatorId: 'op-1', lastSyncAt: null };

  it('renders title "Reparto"', () => {
    render(<DeliveryPanel {...defaultProps} />);
    expect(screen.getByTestId('drilldown-title').textContent).toBe('Reparto');
  });

  it('renders 4 KPIs: Órdenes, Bultos, Clientes, Puntos pickup', () => {
    render(<DeliveryPanel {...defaultProps} />);
    expect(screen.getAllByText('Órdenes').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bultos').length).toBeGreaterThan(0);
    expect(screen.getByText('Clientes')).toBeDefined();
    expect(screen.getByText('Puntos pickup')).toBeDefined();
  });

  it('renders deep-link pointing to /app/dispatch?view=routes', () => {
    render(<DeliveryPanel {...defaultProps} />);
    const link = screen.getByRole('link');
    expect((link as HTMLAnchorElement).href).toContain('/app/dispatch');
  });

  it('shows empty state when rows is empty', () => {
    render(<DeliveryPanel {...defaultProps} />);
    expect(screen.getByText('Sin órdenes en esta etapa')).toBeDefined();
  });

  it('renders a row for each order', () => {
    mockUseStageBreakdown.mockReturnValue({ rows: ORDERS, total: 2, pageCount: 1, stageHealth: NEUTRAL });
    render(<DeliveryPanel {...defaultProps} />);
    expect(screen.getByText('ORD-030')).toBeDefined();
    expect(screen.getByText('ORD-031')).toBeDefined();
  });
});
