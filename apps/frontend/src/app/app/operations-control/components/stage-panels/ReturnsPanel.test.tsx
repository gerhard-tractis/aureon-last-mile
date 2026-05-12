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
  { id: 'o-1', order_number: 'ORD-040', retailer_name: 'Paris', pickup_point_name: 'CD Paris', external_load_id: 'L1', effective_delivery_date: '2026-03-02', comuna: 'Ñuñoa', status: 'en_retorno', return_reason: 'Nadie en casa', return_reason_code: '07', age_minutes: 45, packages: [] },
  { id: 'o-2', order_number: 'ORD-041', retailer_name: 'Easy', pickup_point_name: 'CD Easy', external_load_id: 'L2', effective_delivery_date: '2026-03-05', comuna: 'Las Condes', status: 'parcialmente_entregado', return_reason: 'Dirección incorrecta', return_reason_code: '12', age_minutes: 120, packages: [] },
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
    expect(screen.getByText('Sin retornos pendientes')).toBeDefined();
  });

  it('renders a row for each order', () => {
    mockUseStageBreakdown.mockReturnValue({ rows: ORDERS, total: 2, pageCount: 1, stageHealth: NEUTRAL });
    render(<ReturnsPanel {...defaultProps} />);
    expect(screen.getByText('ORD-040')).toBeDefined();
    expect(screen.getByText('ORD-041')).toBeDefined();
  });

  it('renders return_reason column header "Motivo de retorno"', () => {
    render(<ReturnsPanel {...defaultProps} />);
    expect(screen.getByText('Motivo de retorno')).toBeDefined();
  });

  it('shows return_reason value for each order', () => {
    mockUseStageBreakdown.mockReturnValue({ rows: ORDERS, total: 2, pageCount: 1, stageHealth: NEUTRAL });
    render(<ReturnsPanel {...defaultProps} />);
    expect(screen.getByText('Nadie en casa')).toBeDefined();
    expect(screen.getByText('Dirección incorrecta')).toBeDefined();
  });

  it('shows return_reason_code value for each order', () => {
    mockUseStageBreakdown.mockReturnValue({ rows: ORDERS, total: 2, pageCount: 1, stageHealth: NEUTRAL });
    render(<ReturnsPanel {...defaultProps} />);
    expect(screen.getByText('07')).toBeDefined();
    expect(screen.getByText('12')).toBeDefined();
  });

  it('shows SLA badge "Tarde" for orders with age_minutes > 120', () => {
    const ordersWithLate = [
      ...ORDERS,
      { id: 'o-3', order_number: 'ORD-042', retailer_name: 'Ripley', pickup_point_name: 'CD Ripley', external_load_id: 'L3', effective_delivery_date: '2026-03-06', comuna: 'Providencia', status: 'en_retorno', return_reason: 'Rechazado', return_reason_code: '05', age_minutes: 121, packages: [] },
    ];
    mockUseStageBreakdown.mockReturnValue({ rows: ordersWithLate, total: 3, pageCount: 1, stageHealth: NEUTRAL });
    render(<ReturnsPanel {...defaultProps} />);
    const tardeBadges = screen.getAllByText('Tarde');
    expect(tardeBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('shows SLA badge "OK" for orders with age_minutes <= 60', () => {
    mockUseStageBreakdown.mockReturnValue({ rows: ORDERS, total: 2, pageCount: 1, stageHealth: NEUTRAL });
    render(<ReturnsPanel {...defaultProps} />);
    // ORD-040 has age_minutes: 45, should be OK
    expect(screen.getByText('OK')).toBeDefined();
  });
});
