import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadingKPIStrip from './LoadingKPIStrip';

vi.mock('@/hooks/useLoadingMetrics', () => ({
  useOrdersLoaded: () => ({ data: 156, isLoading: false }),
  usePackagesLoaded: () => ({ data: { packages_count: 203, avg_per_order: 1.3 }, isLoading: false }),
  useOrdersCommitted: () => ({ data: 142, isLoading: false }),
  useActiveClients: () => ({ data: 2, isLoading: false }),
  useComunasCovered: () => ({ data: 18, isLoading: false }),
}));

const props = {
  operatorId: 'op-1',
  startDate: '2026-01-01',
  endDate: '2026-01-31',
  prevStartDate: '2025-12-01',
  prevEndDate: '2025-12-31',
};

describe('LoadingKPIStrip', () => {
  it('renders all 5 KPI labels', () => {
    render(<LoadingKPIStrip {...props} />);
    expect(screen.getByText('Órdenes Cargadas')).toBeInTheDocument();
    expect(screen.getByText('Bultos Cargados')).toBeInTheDocument();
    expect(screen.getByText('Órdenes Comprometidas')).toBeInTheDocument();
    expect(screen.getByText('Clientes Activos')).toBeInTheDocument();
    expect(screen.getByText('Comunas Cubiertas')).toBeInTheDocument();
  });

  it('displays correct values', () => {
    render(<LoadingKPIStrip {...props} />);
    expect(screen.getByText('156')).toBeInTheDocument();
    expect(screen.getByText('203')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });

  it('shows avg packages subtitle', () => {
    render(<LoadingKPIStrip {...props} />);
    expect(screen.getByText('Promedio: 1.3 por orden')).toBeInTheDocument();
  });
});
