import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReturnsPanel } from './ReturnsPanel';

vi.mock('@/hooks/ops-control/useStageBreakdown', () => ({
  useStageBreakdown: vi.fn(),
}));

import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';

const mockUseStageBreakdown = vi.mocked(useStageBreakdown);

const NEUTRAL = { status: 'neutral', delta: '—', reasonsByOrder: new Map() };

beforeEach(() => {
  mockUseStageBreakdown.mockReturnValue({
    rows: [],
    total: 0,
    pageCount: 1,
    stageHealth: NEUTRAL,
  });
});

describe('ReturnsPanel', () => {
  const defaultProps = { operatorId: 'op-1', lastSyncAt: null };

  it('renders title "Devoluciones"', () => {
    render(<ReturnsPanel {...defaultProps} />);
    expect(screen.getByTestId('drilldown-title').textContent).toBe('Devoluciones');
  });

  it('renders 4 KPIs: Pendientes, Por retailer, Antigüedad máx, Próx. corte SLA', () => {
    render(<ReturnsPanel {...defaultProps} />);
    expect(screen.getByText('Pendientes')).toBeDefined();
    expect(screen.getByText('Por retailer')).toBeDefined();
    expect(screen.getByText('Antigüedad máx')).toBeDefined();
    expect(screen.getByText('Próx. corte SLA')).toBeDefined();
  });

  it('renders table headers: Retailer, Pedido, Razón, Antigüedad, SLA, Estado', () => {
    render(<ReturnsPanel {...defaultProps} />);
    expect(screen.getByText('Retailer')).toBeDefined();
    expect(screen.getByText('Pedido')).toBeDefined();
    expect(screen.getByText('Razón')).toBeDefined();
    expect(screen.getByText('Antigüedad')).toBeDefined();
    expect(screen.getByText('SLA')).toBeDefined();
    expect(screen.getByText('Estado')).toBeDefined();
  });

  it('renders a disabled button (no returns module yet)', () => {
    render(<ReturnsPanel {...defaultProps} />);
    const btn = screen.getByRole('button', { name: /próximamente/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows empty state when rows is empty', () => {
    render(<ReturnsPanel {...defaultProps} />);
    expect(screen.getByText('Sin elementos en esta etapa')).toBeDefined();
  });

  it('renders a row for each returned item', () => {
    mockUseStageBreakdown.mockReturnValue({
      rows: [
        { retailer: 'Retail A', order_id: 'PED-001', reason: 'damaged', age_minutes: 120, sla_deadline: '18:00', status: 'pending' },
        { retailer: 'Retail B', order_id: 'PED-002', reason: 'wrong_item', age_minutes: 60, sla_deadline: '20:00', status: 'pending' },
      ],
      total: 2,
      pageCount: 1,
      stageHealth: NEUTRAL,
    });
    render(<ReturnsPanel {...defaultProps} />);
    expect(screen.getByText('PED-001')).toBeDefined();
    expect(screen.getByText('PED-002')).toBeDefined();
  });
});
