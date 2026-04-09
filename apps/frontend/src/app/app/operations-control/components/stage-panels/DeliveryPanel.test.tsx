import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeliveryPanel } from './DeliveryPanel';

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

describe('DeliveryPanel', () => {
  const defaultProps = { operatorId: 'op-1', lastSyncAt: null };

  it('renders title "Reparto"', () => {
    render(<DeliveryPanel {...defaultProps} />);
    expect(screen.getByTestId('drilldown-title').textContent).toBe('Reparto');
  });

  it('renders 4 KPIs: Rutas activas, En tiempo, Atrasadas, Entregadas hoy', () => {
    render(<DeliveryPanel {...defaultProps} />);
    expect(screen.getByText('Rutas activas')).toBeDefined();
    expect(screen.getByText('En tiempo')).toBeDefined();
    expect(screen.getByText('Atrasadas')).toBeDefined();
    expect(screen.getByText('Entregadas hoy')).toBeDefined();
  });

  it('renders table headers: Ruta, Conductor, Progreso, Entregadas / total, Próx. parada, Estado', () => {
    render(<DeliveryPanel {...defaultProps} />);
    expect(screen.getByText('Ruta')).toBeDefined();
    expect(screen.getByText('Conductor')).toBeDefined();
    expect(screen.getByText('Progreso')).toBeDefined();
    expect(screen.getByText('Entregadas / total')).toBeDefined();
    expect(screen.getByText('Próx. parada')).toBeDefined();
    expect(screen.getByText('Estado')).toBeDefined();
  });

  it('renders deep-link pointing to /app/dispatch?view=routes', () => {
    render(<DeliveryPanel {...defaultProps} />);
    const link = screen.getByRole('link');
    expect((link as HTMLAnchorElement).href).toContain('/app/dispatch');
  });

  it('shows empty state when rows is empty', () => {
    render(<DeliveryPanel {...defaultProps} />);
    expect(screen.getByText('Sin elementos en esta etapa')).toBeDefined();
  });

  it('renders a row for each returned item', () => {
    mockUseStageBreakdown.mockReturnValue({
      rows: [
        { route_id: 'R-10', driver: 'Ana', progress_pct: 60, delivered_count: 6, total_count: 10, next_stop: 'Calle 5', status: 'active' },
        { route_id: 'R-11', driver: 'Luis', progress_pct: 80, delivered_count: 8, total_count: 10, next_stop: 'Calle 8', status: 'active' },
      ],
      total: 2,
      pageCount: 1,
      stageHealth: NEUTRAL,
    });
    render(<DeliveryPanel {...defaultProps} />);
    expect(screen.getByText('R-10')).toBeDefined();
    expect(screen.getByText('R-11')).toBeDefined();
  });
});
