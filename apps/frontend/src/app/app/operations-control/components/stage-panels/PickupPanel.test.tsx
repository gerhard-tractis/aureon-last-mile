import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PickupPanel } from './PickupPanel';

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

describe('PickupPanel', () => {
  const defaultProps = {
    operatorId: 'op-1',
    lastSyncAt: null,
  };

  it('renders title "Recogida"', () => {
    render(<PickupPanel {...defaultProps} />);
    expect(screen.getByTestId('drilldown-title').textContent).toBe('Recogida');
  });

  it('renders 4 KPIs: Pendientes, Vencidas, Próx. ventana, Avg espera', () => {
    render(<PickupPanel {...defaultProps} />);
    expect(screen.getByText('Pendientes')).toBeDefined();
    expect(screen.getByText('Vencidas')).toBeDefined();
    expect(screen.getByText('Próx. ventana')).toBeDefined();
    expect(screen.getByText('Avg espera')).toBeDefined();
  });

  it('renders table column headers: Retailer, # Órdenes, Ventana, Espera, Estado', () => {
    render(<PickupPanel {...defaultProps} />);
    expect(screen.getByText('Retailer')).toBeDefined();
    expect(screen.getByText('# Órdenes')).toBeDefined();
    expect(screen.getByText('Ventana')).toBeDefined();
    expect(screen.getByText('Espera')).toBeDefined();
    expect(screen.getByText('Estado')).toBeDefined();
  });

  it('renders deep-link button pointing to /app/pickup', () => {
    render(<PickupPanel {...defaultProps} />);
    const link = screen.getByRole('link');
    expect((link as HTMLAnchorElement).href).toContain('/app/pickup');
  });

  it('shows empty state when rows is empty', () => {
    render(<PickupPanel {...defaultProps} />);
    expect(screen.getByText('Sin elementos en esta etapa')).toBeDefined();
  });

  it('renders a row for each returned item', () => {
    mockUseStageBreakdown.mockReturnValue({
      rows: [
        { retailer: 'Retailer A', order_count: 5, window: '09:00-10:00', wait_minutes: 15, status: 'pending' },
        { retailer: 'Retailer B', order_count: 3, window: '10:00-11:00', wait_minutes: 30, status: 'overdue' },
      ],
      total: 2,
      pageCount: 1,
      stageHealth: NEUTRAL,
    });
    render(<PickupPanel {...defaultProps} />);
    expect(screen.getByText('Retailer A')).toBeDefined();
    expect(screen.getByText('Retailer B')).toBeDefined();
  });
});
