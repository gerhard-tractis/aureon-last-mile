import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceptionPanel } from './ReceptionPanel';

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

describe('ReceptionPanel', () => {
  const defaultProps = {
    operatorId: 'op-1',
    lastSyncAt: null,
  };

  it('renders title "Recepción"', () => {
    render(<ReceptionPanel {...defaultProps} />);
    expect(screen.getByTestId('drilldown-title').textContent).toBe('Recepción');
  });

  it('renders 4 KPIs: Total, Sin clasificar, Antigüedad máx, Throughput/h', () => {
    render(<ReceptionPanel {...defaultProps} />);
    expect(screen.getByText('Total')).toBeDefined();
    expect(screen.getByText('Sin clasificar')).toBeDefined();
    expect(screen.getByText('Antigüedad máx')).toBeDefined();
    expect(screen.getByText('Throughput/h')).toBeDefined();
  });

  it('renders table column headers: Lote, Recibido, # Ítems, Antigüedad, Estado', () => {
    render(<ReceptionPanel {...defaultProps} />);
    expect(screen.getByText('Lote')).toBeDefined();
    expect(screen.getByText('Recibido')).toBeDefined();
    expect(screen.getByText('# Ítems')).toBeDefined();
    expect(screen.getByText('Antigüedad')).toBeDefined();
    expect(screen.getByText('Estado')).toBeDefined();
  });

  it('renders deep-link pointing to /app/reception', () => {
    render(<ReceptionPanel {...defaultProps} />);
    const link = screen.getByRole('link');
    expect((link as HTMLAnchorElement).href).toContain('/app/reception');
  });

  it('shows empty state when rows is empty', () => {
    render(<ReceptionPanel {...defaultProps} />);
    expect(screen.getByText('Sin elementos en esta etapa')).toBeDefined();
  });

  it('renders a row for each returned item', () => {
    mockUseStageBreakdown.mockReturnValue({
      rows: [
        { batch_id: 'LOTE-001', received_at: '09:00', item_count: 12, dwell_minutes: 45, status: 'pending' },
        { batch_id: 'LOTE-002', received_at: '10:30', item_count: 8, dwell_minutes: 15, status: 'classified' },
      ],
      total: 2,
      pageCount: 1,
      stageHealth: NEUTRAL,
    });
    render(<ReceptionPanel {...defaultProps} />);
    expect(screen.getByText('LOTE-001')).toBeDefined();
    expect(screen.getByText('LOTE-002')).toBeDefined();
  });
});
