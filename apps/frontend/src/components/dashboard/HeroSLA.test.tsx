import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import HeroSLA from './HeroSLA';

// Mock hooks
const mockSlaQuery = { data: null as number | null, isLoading: false, isError: false };
const mockPrevSlaQuery = { data: null as number | null, isLoading: false, isError: false };
const mockFadrQuery = { data: null as number | null, isLoading: false, isError: false };
const mockPerfQuery = {
  data: null as { totalOrders: number; deliveredOrders: number; failedDeliveries: number } | null,
  isLoading: false,
  isError: false,
};

vi.mock('@/hooks/useDashboardMetrics', () => ({
  useSlaMetric: () => mockSlaQuery,
  useSlaPreviousPeriod: () => mockPrevSlaQuery,
  useFadrMetric: () => mockFadrQuery,
  usePerformanceMetricsSummary: () => mockPerfQuery,
  useOperatorId: () => ({ operatorId: 'op-123', role: 'admin' }),
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

describe('HeroSLA', () => {
  beforeEach(() => {
    mockSlaQuery.data = null;
    mockSlaQuery.isLoading = false;
    mockSlaQuery.isError = false;
    mockPrevSlaQuery.data = null;
    mockPrevSlaQuery.isLoading = false;
    mockPrevSlaQuery.isError = false;
    mockFadrQuery.data = null;
    mockFadrQuery.isLoading = false;
    mockFadrQuery.isError = false;
    mockPerfQuery.data = null;
    mockPerfQuery.isLoading = false;
    mockPerfQuery.isError = false;
  });

  it('renders SLA percentage with green color for >= 95%', () => {
    mockSlaQuery.data = 96.5;
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    const elements = screen.getAllByText('96.5%');
    const heroDisplay = elements.find((el) => el.className.includes('text-[4rem]'));
    expect(heroDisplay).toHaveClass('text-[#10b981]');
  });

  it('renders SLA percentage with yellow color for 90-94.9%', () => {
    mockSlaQuery.data = 92.3;
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    const elements = screen.getAllByText('92.3%');
    const heroDisplay = elements.find((el) => el.className.includes('text-[4rem]'));
    expect(heroDisplay).toHaveClass('text-[#f59e0b]');
  });

  it('renders SLA percentage with red color for < 90%', () => {
    mockSlaQuery.data = 85.0;
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    const elements = screen.getAllByText('85.0%');
    const heroDisplay = elements.find((el) => el.className.includes('text-[4rem]'));
    expect(heroDisplay).toHaveClass('text-[#ef4444]');
  });

  it('renders "N/A" when SLA is null', () => {
    mockSlaQuery.data = null;
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    expect(screen.getByText('N/A')).toBeInTheDocument();
    expect(screen.getByText('Sin datos para este periodo')).toBeInTheDocument();
  });

  it('shows trend arrow up with correct delta', () => {
    mockSlaQuery.data = 95.0;
    mockPrevSlaQuery.data = 92.7;
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    expect(screen.getByText(/\+2\.3% vs semana anterior/)).toBeInTheDocument();
  });

  it('shows trend arrow down with negative delta', () => {
    mockSlaQuery.data = 90.0;
    mockPrevSlaQuery.data = 93.0;
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    expect(screen.getByText(/-3\.0% vs semana anterior/)).toBeInTheDocument();
  });

  it('hides trend when previous period is null', () => {
    mockSlaQuery.data = 95.0;
    mockPrevSlaQuery.data = null;
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    expect(screen.queryByText(/vs semana anterior/)).not.toBeInTheDocument();
  });

  it('shows skeleton when loading', () => {
    mockSlaQuery.isLoading = true;
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    // Skeleton renders pulse animation divs, no SLA text
    expect(screen.queryByText('N/A')).not.toBeInTheDocument();
    expect(screen.queryByText(/Cumplimiento SLA/)).not.toBeInTheDocument();
  });

  it('shows error alert when query fails', () => {
    mockSlaQuery.isError = true;
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    expect(screen.getByText('Los datos pueden estar desactualizados')).toBeInTheDocument();
  });

  it('opens dialog on click', async () => {
    mockSlaQuery.data = 95.0;
    renderWithProvider(<HeroSLA operatorId="op-123" />);

    const hero = screen.getByRole('button', { name: /Ver analisis detallado de SLA/ });
    await userEvent.click(hero);

    await waitFor(() => {
      expect(screen.getByText('Analisis Detallado de SLA')).toBeInTheDocument();
    });
  });

  it('opens dialog on Enter key', async () => {
    mockSlaQuery.data = 95.0;
    renderWithProvider(<HeroSLA operatorId="op-123" />);

    const hero = screen.getByRole('button', { name: /Ver analisis detallado de SLA/ });
    hero.focus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Analisis Detallado de SLA')).toBeInTheDocument();
    });
  });

  it('renders context line with delivery counts when data is available', () => {
    mockSlaQuery.data = 95.0;
    mockPerfQuery.data = { totalOrders: 200, deliveredOrders: 190, failedDeliveries: 10 };
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    expect(screen.getByText('190 de 200 entregas cumplidas')).toBeInTheDocument();
  });

  it('renders FADR and failure count in inline metrics', () => {
    mockSlaQuery.data = 95.0;
    mockFadrQuery.data = 88.5;
    mockPerfQuery.data = { totalOrders: 200, deliveredOrders: 190, failedDeliveries: 10 };
    renderWithProvider(<HeroSLA operatorId="op-123" />);

    expect(screen.getByText(/Primera Entrega \(FADR\): 88\.5%/)).toBeInTheDocument();
    expect(screen.getByText(/Fallos: 10 \(5\.0%\)/)).toBeInTheDocument();
  });
});
