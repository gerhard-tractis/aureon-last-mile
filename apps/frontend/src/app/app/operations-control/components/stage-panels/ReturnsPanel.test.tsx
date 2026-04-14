import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReturnsPanel } from './ReturnsPanel';

vi.mock('@/hooks/ops-control/useStageBreakdown', () => ({
  useStageBreakdown: vi.fn(),
}));

import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';

const mockUseStageBreakdown = vi.mocked(useStageBreakdown);

const NEUTRAL = { status: 'neutral', delta: '—', reasonsByOrder: new Map() };

const ORDERS = [
  { id: 'o-1', order_number: 'ORD-040', retailer_name: 'Paris', pickup_point_name: 'CD Paris', external_load_id: 'L1', effective_delivery_date: '2026-03-02', comuna: 'Ñuñoa', status: 'devuelto', packages: [] },
  { id: 'o-2', order_number: 'ORD-041', retailer_name: 'Easy', pickup_point_name: 'CD Easy', external_load_id: 'L2', effective_delivery_date: '2026-03-05', comuna: 'Las Condes', status: 'devuelto', packages: [] },
];

beforeEach(() => {
  mockUseStageBreakdown.mockReturnValue({ rows: [], total: 0, pageCount: 1, stageHealth: NEUTRAL });
});

describe('ReturnsPanel', () => {
  const defaultProps = { operatorId: 'op-1', lastSyncAt: null };

  it('renders title "Reingresos"', () => {
    render(<ReturnsPanel {...defaultProps} />);
    expect(screen.getByTestId('drilldown-title').textContent).toBe('Reingresos');
  });

  it('renders 4 KPIs: Órdenes, Bultos, Clientes, Puntos pickup', () => {
    render(<ReturnsPanel {...defaultProps} />);
    expect(screen.getAllByText('Órdenes').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bultos').length).toBeGreaterThan(0);
    expect(screen.getByText('Clientes')).toBeDefined();
    expect(screen.getByText('Puntos pickup')).toBeDefined();
  });

  it('renders a disabled button (no returns module yet)', () => {
    render(<ReturnsPanel {...defaultProps} />);
    const btn = screen.getByRole('button', { name: /próximamente/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows empty state when rows is empty', () => {
    render(<ReturnsPanel {...defaultProps} />);
    expect(screen.getByText('Sin órdenes en esta etapa')).toBeDefined();
  });

  it('renders a row for each order', () => {
    mockUseStageBreakdown.mockReturnValue({ rows: ORDERS, total: 2, pageCount: 1, stageHealth: NEUTRAL });
    render(<ReturnsPanel {...defaultProps} />);
    expect(screen.getByText('ORD-040')).toBeDefined();
    expect(screen.getByText('ORD-041')).toBeDefined();
  });
});
