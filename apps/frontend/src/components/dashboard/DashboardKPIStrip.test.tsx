import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { DashboardKPIStrip } from './DashboardKPIStrip';
import type { OtifMetrics } from '@/hooks/useDeliveryMetrics';

const mockQuery: { data: OtifMetrics | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};

vi.mock('@/hooks/useDeliveryMetrics', () => ({
  useOtifMetrics: vi.fn(() => mockQuery),
}));

function renderWithProvider(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const defaultProps = { operatorId: 'op-1', startDate: '2026-03-01', endDate: '2026-03-23' };

const sampleData: OtifMetrics = {
  total_orders: 1247,
  delivered_orders: 1100,
  failed_orders: 23,
  in_route_orders: 124,
  pending_orders: 0,
  on_time_deliveries: 1050,
  otif_percentage: 84.2,
};

describe('DashboardKPIStrip', () => {
  beforeEach(() => {
    mockQuery.data = undefined;
    mockQuery.isLoading = false;
  });

  it('renders 4 metric cards with correct labels', () => {
    mockQuery.data = sampleData;
    renderWithProvider(<DashboardKPIStrip {...defaultProps} />);

    expect(screen.getByText('Pedidos Hoy')).toBeInTheDocument();
    expect(screen.getByText('Entregados')).toBeInTheDocument();
    expect(screen.getByText('Fallidos')).toBeInTheDocument();
    expect(screen.getByText('En Ruta')).toBeInTheDocument();
  });

  it('shows loading skeletons when loading', () => {
    mockQuery.isLoading = true;
    const { container } = renderWithProvider(<DashboardKPIStrip {...defaultProps} />);

    expect(screen.queryByText('Pedidos Hoy')).not.toBeInTheDocument();
    const skeletons = container.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBe(4);
  });

  it('formats numbers with es-CL locale', () => {
    mockQuery.data = sampleData;
    renderWithProvider(<DashboardKPIStrip {...defaultProps} />);

    // 1247 formatted with es-CL → "1.247"
    expect(screen.getByText((1247).toLocaleString('es-CL'))).toBeInTheDocument();
    // 1100 formatted with es-CL → "1.100"
    expect(screen.getByText((1100).toLocaleString('es-CL'))).toBeInTheDocument();
    // 23 → "23"
    expect(screen.getByText((23).toLocaleString('es-CL'))).toBeInTheDocument();
    // 124 → "124"
    expect(screen.getByText((124).toLocaleString('es-CL'))).toBeInTheDocument();
  });
});
