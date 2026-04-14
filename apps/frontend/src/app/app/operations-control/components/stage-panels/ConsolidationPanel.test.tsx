import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConsolidationPanel } from './ConsolidationPanel';

vi.mock('@/hooks/ops-control/useStageBreakdown', () => ({
  useStageBreakdown: vi.fn(),
}));

import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';

const mockUseStageBreakdown = vi.mocked(useStageBreakdown);

const NEUTRAL = { status: 'neutral', delta: '—', reasonsByOrder: new Map() };

const ORDERS = [
  { id: 'o-1', order_number: 'ORD-010', retailer_name: 'Paris', pickup_point_name: 'CD Paris', external_load_id: 'L1', effective_delivery_date: '2026-03-02', comuna: 'Ñuñoa', status: 'en_bodega', packages: [] },
  { id: 'o-2', order_number: 'ORD-011', retailer_name: 'Easy', pickup_point_name: 'CD Easy', external_load_id: 'L2', effective_delivery_date: '2026-03-05', comuna: 'Las Condes', status: 'asignado', packages: [] },
];

beforeEach(() => {
  mockUseStageBreakdown.mockReturnValue({ rows: [], total: 0, pageCount: 1, stageHealth: NEUTRAL });
});

describe('ConsolidationPanel', () => {
  const defaultProps = { operatorId: 'op-1', lastSyncAt: null };

  it('renders title "Consolidación"', () => {
    render(<ConsolidationPanel {...defaultProps} />);
    expect(screen.getByTestId('drilldown-title').textContent).toBe('Consolidación');
  });

  it('renders 4 KPIs: Órdenes, Bultos, Clientes, Puntos pickup', () => {
    render(<ConsolidationPanel {...defaultProps} />);
    expect(screen.getAllByText('Órdenes').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bultos').length).toBeGreaterThan(0);
    expect(screen.getByText('Clientes')).toBeDefined();
    expect(screen.getByText('Puntos pickup')).toBeDefined();
  });

  it('renders deep-link pointing to /app/distribution', () => {
    render(<ConsolidationPanel {...defaultProps} />);
    const link = screen.getByRole('link');
    expect((link as HTMLAnchorElement).href).toContain('/app/distribution');
  });

  it('shows empty state when rows is empty', () => {
    render(<ConsolidationPanel {...defaultProps} />);
    expect(screen.getByText('Sin órdenes en esta etapa')).toBeDefined();
  });

  it('renders a row for each order', () => {
    mockUseStageBreakdown.mockReturnValue({ rows: ORDERS, total: 2, pageCount: 1, stageHealth: NEUTRAL });
    render(<ConsolidationPanel {...defaultProps} />);
    expect(screen.getByText('ORD-010')).toBeDefined();
    expect(screen.getByText('ORD-011')).toBeDefined();
  });
});
