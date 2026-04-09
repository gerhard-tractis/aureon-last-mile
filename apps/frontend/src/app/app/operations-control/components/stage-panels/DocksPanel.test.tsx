import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DocksPanel } from './DocksPanel';

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

describe('DocksPanel', () => {
  const defaultProps = { operatorId: 'op-1', lastSyncAt: null };

  it('renders title "Andenes"', () => {
    render(<DocksPanel {...defaultProps} />);
    expect(screen.getByTestId('drilldown-title').textContent).toBe('Andenes');
  });

  it('renders 4 KPIs: Rutas listas, Avg dwell, Más antigua inactiva, Órdenes en andén', () => {
    render(<DocksPanel {...defaultProps} />);
    expect(screen.getByText('Rutas listas')).toBeDefined();
    expect(screen.getByText('Avg dwell')).toBeDefined();
    expect(screen.getByText('Más antigua inactiva')).toBeDefined();
    expect(screen.getByText('Órdenes en andén')).toBeDefined();
  });

  it('renders table headers: Ruta, Andén, Conductor, Órdenes, Dwell, Estado, Ventana', () => {
    render(<DocksPanel {...defaultProps} />);
    expect(screen.getByText('Ruta')).toBeDefined();
    expect(screen.getByText('Andén')).toBeDefined();
    expect(screen.getByText('Conductor')).toBeDefined();
    expect(screen.getByText('Órdenes')).toBeDefined();
    expect(screen.getByText('Dwell')).toBeDefined();
    expect(screen.getByText('Estado')).toBeDefined();
    expect(screen.getByText('Ventana')).toBeDefined();
  });

  it('renders deep-link pointing to /app/dispatch', () => {
    render(<DocksPanel {...defaultProps} />);
    const link = screen.getByRole('link');
    expect((link as HTMLAnchorElement).href).toContain('/app/dispatch');
  });

  it('shows empty state when rows is empty', () => {
    render(<DocksPanel {...defaultProps} />);
    expect(screen.getByText('Sin elementos en esta etapa')).toBeDefined();
  });

  it('renders a row for each returned item', () => {
    mockUseStageBreakdown.mockReturnValue({
      rows: [
        { route_id: 'R-01', dock: 'A1', driver: 'Juan', order_count: 8, dwell_minutes: 20, status: 'ready', window: '10:00-11:00' },
        { route_id: 'R-02', dock: 'A2', driver: 'Pedro', order_count: 6, dwell_minutes: 35, status: 'loading', window: '11:00-12:00' },
      ],
      total: 2,
      pageCount: 1,
      stageHealth: NEUTRAL,
    });
    render(<DocksPanel {...defaultProps} />);
    expect(screen.getByText('R-01')).toBeDefined();
    expect(screen.getByText('R-02')).toBeDefined();
  });
});
