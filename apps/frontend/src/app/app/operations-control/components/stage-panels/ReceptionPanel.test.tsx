import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceptionPanel } from './ReceptionPanel';

vi.mock('@/hooks/ops-control/useStageBreakdown', () => ({
  useStageBreakdown: vi.fn(),
}));

import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';

const mockUseStageBreakdown = vi.mocked(useStageBreakdown);

const NEUTRAL = { status: 'neutral', delta: '—', reasonsByOrder: new Map() };

const ORDERS = [
  { id: 'o-1', order_number: 'ORD-001', retailer_name: 'Paris', pickup_point_name: 'CD Paris', external_load_id: 'L1', effective_delivery_date: '2026-03-02', comuna: 'Ñuñoa', status: 'verificado', packages: [] },
  { id: 'o-2', order_number: 'ORD-002', retailer_name: 'Easy', pickup_point_name: 'CD Easy', external_load_id: 'L2', effective_delivery_date: '2026-03-05', comuna: 'Las Condes', status: 'verificado', packages: [] },
];

beforeEach(() => {
  mockUseStageBreakdown.mockReturnValue({ rows: [], total: 0, pageCount: 1, stageHealth: NEUTRAL });
});

describe('ReceptionPanel', () => {
  const defaultProps = { operatorId: 'op-1', lastSyncAt: null };

  it('renders title "Recepción"', () => {
    render(<ReceptionPanel {...defaultProps} />);
    expect(screen.getByTestId('drilldown-title').textContent).toBe('Recepción');
  });

  it('renders 4 KPIs: Órdenes, Bultos, Clientes, Puntos pickup', () => {
    render(<ReceptionPanel {...defaultProps} />);
    expect(screen.getAllByText('Órdenes').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bultos').length).toBeGreaterThan(0);
    expect(screen.getByText('Clientes')).toBeDefined();
    expect(screen.getByText('Puntos pickup')).toBeDefined();
  });

  it('renders uniform table headers', () => {
    render(<ReceptionPanel {...defaultProps} />);
    expect(screen.getByText('Orden')).toBeDefined();
    expect(screen.getByText('Cliente')).toBeDefined();
    expect(screen.getByText('Punto Pickup')).toBeDefined();
  });

  it('renders deep-link pointing to /app/reception', () => {
    render(<ReceptionPanel {...defaultProps} />);
    const link = screen.getByRole('link');
    expect((link as HTMLAnchorElement).href).toContain('/app/reception');
  });

  it('shows empty state when rows is empty', () => {
    render(<ReceptionPanel {...defaultProps} />);
    expect(screen.getByText('Sin órdenes en esta etapa')).toBeDefined();
  });

  it('renders a row for each order', () => {
    mockUseStageBreakdown.mockReturnValue({ rows: ORDERS, total: 2, pageCount: 1, stageHealth: NEUTRAL });
    render(<ReceptionPanel {...defaultProps} />);
    expect(screen.getByText('ORD-001')).toBeDefined();
    expect(screen.getByText('ORD-002')).toBeDefined();
  });
});
