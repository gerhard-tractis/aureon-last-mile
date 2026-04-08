import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConsolidationPanel } from './ConsolidationPanel';

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

describe('ConsolidationPanel', () => {
  const defaultProps = { operatorId: 'op-1', lastSyncAt: null };

  it('renders title "Consolidación"', () => {
    render(<ConsolidationPanel {...defaultProps} />);
    expect(screen.getByTestId('drilldown-title').textContent).toBe('Consolidación');
  });

  it('renders 4 KPIs: Listas, Andenes destino, Antigüedad máx, Próx. corte', () => {
    render(<ConsolidationPanel {...defaultProps} />);
    expect(screen.getByText('Listas')).toBeDefined();
    expect(screen.getByText('Andenes destino')).toBeDefined();
    expect(screen.getByText('Antigüedad máx')).toBeDefined();
    expect(screen.getByText('Próx. corte')).toBeDefined();
  });

  it('renders table headers: Andén destino, # Órdenes, Listas desde, Estado', () => {
    render(<ConsolidationPanel {...defaultProps} />);
    expect(screen.getByText('Andén destino')).toBeDefined();
    expect(screen.getByText('# Órdenes')).toBeDefined();
    expect(screen.getByText('Listas desde')).toBeDefined();
    expect(screen.getByText('Estado')).toBeDefined();
  });

  it('renders deep-link pointing to /app/distribution', () => {
    render(<ConsolidationPanel {...defaultProps} />);
    const link = screen.getByRole('link');
    expect((link as HTMLAnchorElement).href).toContain('/app/distribution');
  });

  it('shows empty state when rows is empty', () => {
    render(<ConsolidationPanel {...defaultProps} />);
    expect(screen.getByText('Sin elementos en esta etapa')).toBeDefined();
  });

  it('renders a row for each returned item', () => {
    mockUseStageBreakdown.mockReturnValue({
      rows: [
        { dest_dock: 'Andén 1', order_count: 10, ready_since: '08:00', status: 'ready' },
        { dest_dock: 'Andén 2', order_count: 5, ready_since: '09:30', status: 'pending' },
      ],
      total: 2,
      pageCount: 1,
      stageHealth: NEUTRAL,
    });
    render(<ConsolidationPanel {...defaultProps} />);
    expect(screen.getByText('Andén 1')).toBeDefined();
    expect(screen.getByText('Andén 2')).toBeDefined();
  });
});
