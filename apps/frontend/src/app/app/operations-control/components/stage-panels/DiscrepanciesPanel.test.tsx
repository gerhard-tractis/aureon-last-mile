import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiscrepanciesPanel } from './DiscrepanciesPanel';

vi.mock('@/hooks/ops-control/useDiscrepancies', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/ops-control/useDiscrepancies')>();
  return { ...actual, useDiscrepancies: vi.fn() };
});

import { useDiscrepancies } from '@/hooks/ops-control/useDiscrepancies';

const mockUseDiscrepancies = vi.mocked(useDiscrepancies);

const IDLE = { isLoading: false, isError: false, fetchStatus: 'idle' as const };

const ROWS = [
  {
    id: 'd-1', kind: 'missing' as const, operation_type: 'reception' as const, status: 'open' as const,
    detected_at: '2026-09-07T10:00:00Z', note: null,
    order_number: 'ORD-01', package_label: 'CTN-1',
    carga: 'CARGA-EASY-001', ruta: 'PR-2026-2298', closed_by_name: 'Ana Recepción',
    total_count: 1,
  },
];

beforeEach(() => {
  mockUseDiscrepancies.mockReturnValue({ data: [], ...IDLE } as unknown as ReturnType<typeof useDiscrepancies>);
});

describe('DiscrepanciesPanel', () => {
  const defaultProps = { operatorId: 'op-1', lastSyncAt: null };

  it('renders title "Discrepancias"', () => {
    render(<DiscrepanciesPanel {...defaultProps} />);
    expect(screen.getByTestId('drilldown-title').textContent).toBe('Discrepancias');
  });

  it('asks the hook for open discrepancies only', () => {
    render(<DiscrepanciesPanel {...defaultProps} />);
    expect(mockUseDiscrepancies).toHaveBeenCalledWith('op-1', 'open');
  });

  it('has no deep link — there is no dedicated screen to open yet', () => {
    render(<DiscrepanciesPanel {...defaultProps} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the empty state when there are no open discrepancies', () => {
    render(<DiscrepanciesPanel {...defaultProps} />);
    expect(screen.getByText('Sin discrepancias sin resolver')).toBeDefined();
  });

  it('renders a row per discrepancy the hook returns', () => {
    mockUseDiscrepancies.mockReturnValue({ data: ROWS, ...IDLE } as unknown as ReturnType<typeof useDiscrepancies>);
    render(<DiscrepanciesPanel {...defaultProps} />);
    expect(screen.getByText('ORD-01')).toBeDefined();
    expect(screen.getByText('CTN-1')).toBeDefined();
  });

  it('does not claim "Tiempo real" — there is no Realtime subscription on discrepancies', () => {
    render(<DiscrepanciesPanel {...defaultProps} />);
    expect(screen.queryByText(/Tiempo real/)).toBeNull();
    expect(screen.queryByTestId('stage-panel-freshness')).toBeNull();
  });

  // Ronda 3 (#715, M1): clicking the tile's honest "—" must not land on a
  // panel that confidently claims zero discrepancies.
  it('shows an unknown state instead of "zero" while still loading', () => {
    mockUseDiscrepancies.mockReturnValue({
      data: undefined, isLoading: true, isError: false, fetchStatus: 'fetching',
    } as unknown as ReturnType<typeof useDiscrepancies>);
    render(<DiscrepanciesPanel {...defaultProps} />);
    expect(screen.getByTestId('discrepancies-panel-unknown')).toBeInTheDocument();
    expect(screen.queryByText('Sin discrepancias sin resolver')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows an unknown state instead of "zero" when the query is paused (offline)', () => {
    mockUseDiscrepancies.mockReturnValue({
      data: undefined, isLoading: false, isError: false, fetchStatus: 'paused',
    } as unknown as ReturnType<typeof useDiscrepancies>);
    render(<DiscrepanciesPanel {...defaultProps} />);
    expect(screen.getByTestId('discrepancies-panel-unknown')).toBeInTheDocument();
  });

  it('shows an unknown state instead of "zero" when the RPC errored', () => {
    mockUseDiscrepancies.mockReturnValue({
      data: undefined, isLoading: false, isError: true, fetchStatus: 'idle',
    } as unknown as ReturnType<typeof useDiscrepancies>);
    render(<DiscrepanciesPanel {...defaultProps} />);
    expect(screen.getByTestId('discrepancies-panel-unknown')).toBeInTheDocument();
  });
});
