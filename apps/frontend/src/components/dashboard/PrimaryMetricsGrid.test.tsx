import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import PrimaryMetricsGrid from './PrimaryMetricsGrid';

// Mock recharts
vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'area-chart' }, children),
  Area: () => React.createElement('div', { 'data-testid': 'area' }),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'responsive-container' }, children),
}));

const mockFadrQuery = { data: null as number | null, isLoading: false, isError: false };
const mockClaimsQuery = { data: null as { count: number; amount: number } | null, isLoading: false, isError: false };
const mockEfficiencyQuery = { data: null as number | null, isLoading: false, isError: false };
const mockPerfQuery = {
  data: null as { totalOrders: number; deliveredOrders: number; failedDeliveries: number } | null,
  isLoading: false,
  isError: false,
};
const mockPrevFadrQuery = { data: null as number | null, isLoading: false, isError: false };
const mockPrevClaimsQuery = { data: null as { count: number; amount: number } | null, isLoading: false, isError: false };
const mockPrevEfficiencyQuery = { data: null as number | null, isLoading: false, isError: false };
const mockSeriesQuery = { data: [] as { date: string; value: number }[], isLoading: false, isError: false };
const mockFadrSummaryQuery = { data: null as { firstAttempt: number; total: number } | null, isLoading: false, isError: false };

vi.mock('@/hooks/useDashboardMetrics', () => ({
  useFadrMetric: () => mockFadrQuery,
  useFadrPreviousPeriod: () => mockPrevFadrQuery,
  useFadrDailySeries: () => mockSeriesQuery,
  useFadrSummary: () => mockFadrSummaryQuery,
  useShortageClaimsMetric: () => mockClaimsQuery,
  useClaimsPreviousPeriod: () => mockPrevClaimsQuery,
  useAvgDeliveryTimeMetric: () => mockEfficiencyQuery,
  useDeliveryTimePreviousPeriod: () => mockPrevEfficiencyQuery,
  usePerformanceMetricsSummary: () => mockPerfQuery,
  useDailyMetricsSeries: () => mockSeriesQuery,
}));

vi.mock('@/hooks/useDashboardDates', () => ({
  getDashboardDates: () => ({
    startDate: '2026-02-24',
    endDate: '2026-03-02',
    prevStartDate: '2026-02-17',
    prevEndDate: '2026-02-23',
  }),
}));

function renderWithProvider(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('PrimaryMetricsGrid', () => {
  beforeEach(() => {
    mockFadrQuery.data = null;
    mockFadrQuery.isLoading = false;
    mockFadrQuery.isError = false;
    mockClaimsQuery.data = null;
    mockClaimsQuery.isLoading = false;
    mockClaimsQuery.isError = false;
    mockEfficiencyQuery.data = null;
    mockEfficiencyQuery.isLoading = false;
    mockEfficiencyQuery.isError = false;
    mockPerfQuery.data = null;
    mockPerfQuery.isLoading = false;
    mockPrevFadrQuery.data = null;
    mockPrevClaimsQuery.data = null;
    mockPrevEfficiencyQuery.data = null;
    mockFadrSummaryQuery.data = null;
  });

  it('shows skeleton loaders when loading', () => {
    mockFadrQuery.isLoading = true;
    const { container } = renderWithProvider(<PrimaryMetricsGrid operatorId="op-123" />);
    // Skeleton loaders render, no card titles
    expect(screen.queryByText('FADR')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('renders all three cards with data', () => {
    mockFadrQuery.data = 92.1;
    mockClaimsQuery.data = { count: 5, amount: 150000 };
    mockEfficiencyQuery.data = 42;
    mockPerfQuery.data = { totalOrders: 305, deliveredOrders: 281, failedDeliveries: 24 };

    renderWithProvider(<PrimaryMetricsGrid operatorId="op-123" />);

    expect(screen.getByText('FADR')).toBeInTheDocument();
    expect(screen.getByText('Reclamos')).toBeInTheDocument();
    expect(screen.getByText('Eficiencia')).toBeInTheDocument();
  });

  it('renders FADR value and color-coded yellow for 90-94.9%', () => {
    mockFadrQuery.data = 92.1;
    renderWithProvider(<PrimaryMetricsGrid operatorId="op-123" />);

    const fadrValue = screen.getByText('92.1%');
    expect(fadrValue).toHaveClass('text-[var(--color-status-warning)]');
  });

  it('renders FADR benchmark badge', () => {
    mockFadrQuery.data = 96.0;
    renderWithProvider(<PrimaryMetricsGrid operatorId="op-123" />);

    expect(screen.getByText('⭐ Excelente (>95%)')).toBeInTheDocument();
  });

  it('renders N/A for FADR when null', () => {
    mockFadrQuery.data = null;
    renderWithProvider(<PrimaryMetricsGrid operatorId="op-123" />);

    const buttons = screen.getAllByRole('button');
    const fadrCard = buttons.find(b => b.getAttribute('aria-label')?.includes('FADR'));
    expect(fadrCard).toBeTruthy();
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
  });

  it('renders claims as 0 CLP in green when no claims', () => {
    mockClaimsQuery.data = null;
    renderWithProvider(<PrimaryMetricsGrid operatorId="op-123" />);

    expect(screen.getByText('0 CLP')).toBeInTheDocument();
  });

  it('renders efficiency in minutes', () => {
    mockEfficiencyQuery.data = 42;
    renderWithProvider(<PrimaryMetricsGrid operatorId="op-123" />);

    expect(screen.getByText('42 min')).toBeInTheDocument();
  });

  it('renders efficiency green for <= 40min', () => {
    mockEfficiencyQuery.data = 35;
    renderWithProvider(<PrimaryMetricsGrid operatorId="op-123" />);

    const value = screen.getByText('35 min');
    expect(value).toHaveClass('text-[var(--color-status-success)]');
  });

  it('renders efficiency red for > 60min', () => {
    mockEfficiencyQuery.data = 75;
    renderWithProvider(<PrimaryMetricsGrid operatorId="op-123" />);

    const value = screen.getByText('75 min');
    expect(value).toHaveClass('text-[var(--color-status-error)]');
  });

  it('opens FADR drill-down dialog on click', async () => {
    mockFadrQuery.data = 92.1;
    renderWithProvider(<PrimaryMetricsGrid operatorId="op-123" />);

    const fadrCard = screen.getByRole('button', { name: /FADR/ });
    await userEvent.click(fadrCard);

    await waitFor(() => {
      expect(screen.getByText('FADR - Analisis Detallado')).toBeInTheDocument();
    });
  });

  it('opens Claims drill-down dialog on click', async () => {
    mockClaimsQuery.data = { count: 3, amount: 80000 };
    renderWithProvider(<PrimaryMetricsGrid operatorId="op-123" />);

    const claimsCard = screen.getByRole('button', { name: /Reclamos/ });
    await userEvent.click(claimsCard);

    await waitFor(() => {
      expect(screen.getByText('Reclamos - Analisis Detallado')).toBeInTheDocument();
    });
  });

  it('opens Efficiency drill-down dialog on click', async () => {
    mockEfficiencyQuery.data = 42;
    renderWithProvider(<PrimaryMetricsGrid operatorId="op-123" />);

    const effCard = screen.getByRole('button', { name: /Eficiencia/ });
    await userEvent.click(effCard);

    await waitFor(() => {
      expect(screen.getByText('Eficiencia - Analisis Detallado')).toBeInTheDocument();
    });
  });

  it('shows stale indicator on FADR card when query has error', () => {
    mockFadrQuery.data = 92.1;
    mockFadrQuery.isError = true;
    renderWithProvider(<PrimaryMetricsGrid operatorId="op-123" />);

    expect(screen.getByTitle('Los datos pueden estar desactualizados')).toBeInTheDocument();
  });

  it('renders FADR context with first-attempt delivery counts', () => {
    mockFadrQuery.data = 92.1;
    mockFadrSummaryQuery.data = { firstAttempt: 281, total: 305 };
    renderWithProvider(<PrimaryMetricsGrid operatorId="op-123" />);

    expect(screen.getByText('281/305 primera entrega exitosa')).toBeInTheDocument();
  });
});
