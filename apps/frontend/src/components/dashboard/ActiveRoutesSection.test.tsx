import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ActiveRoutesSection from './ActiveRoutesSection';
import type { ActiveRoute } from '@/hooks/useActiveRoutes';

const mockUseActiveRoutes = vi.fn();

vi.mock('@/hooks/useActiveRoutes', () => ({
  useActiveRoutes: (...args: unknown[]) => mockUseActiveRoutes(...args),
}));

vi.mock('./RouteProgressCard', () => ({
  default: ({ route }: { route: ActiveRoute }) => (
    <div data-testid="route-card">{route.driver_name}</div>
  ),
}));

function renderWithProvider(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const MOCK_ROUTE: ActiveRoute = {
  id: 'r1',
  external_route_id: '1',
  driver_name: 'Ana López',
  vehicle_id: null,
  status: 'in_progress',
  start_time: null,
  total_stops: 5,
  completed_stops: 2,
  dispatches: [],
};

describe('ActiveRoutesSection', () => {
  it('renders loading skeleton while fetching', () => {
    mockUseActiveRoutes.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    renderWithProvider(<ActiveRoutesSection operatorId="op-1" />);
    expect(screen.getByTestId('routes-skeleton')).toBeInTheDocument();
  });

  it('renders error state on failure', () => {
    mockUseActiveRoutes.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    renderWithProvider(<ActiveRoutesSection operatorId="op-1" />);
    expect(screen.getByTestId('routes-error')).toBeInTheDocument();
  });

  it('renders empty state when no routes', () => {
    mockUseActiveRoutes.mockReturnValue({ isLoading: false, isError: false, data: [] });
    renderWithProvider(<ActiveRoutesSection operatorId="op-1" />);
    expect(screen.getByTestId('routes-empty')).toBeInTheDocument();
  });

  it('renders route cards when routes are present', () => {
    mockUseActiveRoutes.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [MOCK_ROUTE, { ...MOCK_ROUTE, id: 'r2', driver_name: 'Carlos Ruiz' }],
    });
    renderWithProvider(<ActiveRoutesSection operatorId="op-1" />);
    expect(screen.getAllByTestId('route-card')).toHaveLength(2);
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument();
  });

  it('passes operatorId to useActiveRoutes', () => {
    mockUseActiveRoutes.mockReturnValue({ isLoading: false, isError: false, data: [] });
    renderWithProvider(<ActiveRoutesSection operatorId="op-999" />);
    expect(mockUseActiveRoutes).toHaveBeenCalledWith('op-999');
  });
});
