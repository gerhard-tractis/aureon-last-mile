import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import HeroSLA from './HeroSLA';
import type { OtifMetrics } from '@/hooks/useDeliveryMetrics';

// Mock hooks
const mockOtifQuery = {
  data: null as OtifMetrics | null,
  isLoading: false,
  isError: false,
  isPlaceholderData: false,
};
const mockPrevOtifQuery = {
  data: null as OtifMetrics | null,
  isLoading: false,
  isError: false,
  isPlaceholderData: false,
};
const mockFadrQuery = { data: null as number | null, isLoading: false, isError: false, isPlaceholderData: false };

vi.mock('@/hooks/useDeliveryMetrics', () => ({
  useOtifMetrics: (_operatorId: string, startDate: string) =>
    startDate === '2026-02-17' ? mockPrevOtifQuery : mockOtifQuery,
}));

vi.mock('@/hooks/useDashboardMetrics', () => ({
  useFadrMetric: () => mockFadrQuery,
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

function makeOtif(delivered: number, total: number, failed = 0): OtifMetrics {
  return {
    total_orders: total,
    delivered_orders: delivered,
    failed_orders: failed,
    in_route_orders: 0,
    pending_orders: 0,
    on_time_deliveries: delivered,
    otif_percentage: total > 0 ? (delivered / total) * 100 : null,
  };
}

function renderWithProvider(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('HeroSLA', () => {
  beforeEach(() => {
    mockOtifQuery.data = null;
    mockOtifQuery.isLoading = false;
    mockOtifQuery.isError = false;
    mockOtifQuery.isPlaceholderData = false;
    mockPrevOtifQuery.data = null;
    mockPrevOtifQuery.isLoading = false;
    mockPrevOtifQuery.isError = false;
    mockPrevOtifQuery.isPlaceholderData = false;
    mockFadrQuery.data = null;
    mockFadrQuery.isLoading = false;
    mockFadrQuery.isError = false;
    mockFadrQuery.isPlaceholderData = false;
  });

  it('renders SLA percentage with green color for >= 95%', () => {
    mockOtifQuery.data = makeOtif(965, 1000); // 96.5%
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    const elements = screen.getAllByText('96.5%');
    const heroDisplay = elements.find((el) => el.className.includes('text-[4rem]'));
    expect(heroDisplay).toHaveClass('text-[#10b981]');
  });

  it('renders SLA percentage with yellow color for 90-94.9%', () => {
    mockOtifQuery.data = makeOtif(923, 1000); // 92.3%
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    const elements = screen.getAllByText('92.3%');
    const heroDisplay = elements.find((el) => el.className.includes('text-[4rem]'));
    expect(heroDisplay).toHaveClass('text-[#f59e0b]');
  });

  it('renders SLA percentage with red color for < 90%', () => {
    mockOtifQuery.data = makeOtif(85, 100); // 85.0%
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    const elements = screen.getAllByText('85.0%');
    const heroDisplay = elements.find((el) => el.className.includes('text-[4rem]'));
    expect(heroDisplay).toHaveClass('text-[#ef4444]');
  });

  it('renders "N/A" when data is null', () => {
    mockOtifQuery.data = null;
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    expect(screen.getByText('N/A')).toBeInTheDocument();
    expect(screen.getByText('Sin datos para este periodo')).toBeInTheDocument();
  });

  it('shows trend arrow up with correct delta', () => {
    mockOtifQuery.data = makeOtif(95, 100);      // 95.0%
    mockPrevOtifQuery.data = makeOtif(927, 1000); // 92.7%
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    expect(screen.getByText(/\+2\.3% vs semana anterior/)).toBeInTheDocument();
  });

  it('shows trend arrow down with negative delta', () => {
    mockOtifQuery.data = makeOtif(90, 100);      // 90.0%
    mockPrevOtifQuery.data = makeOtif(930, 1000); // 93.0%
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    expect(screen.getByText(/-3\.0% vs semana anterior/)).toBeInTheDocument();
  });

  it('hides trend when previous period is null', () => {
    mockOtifQuery.data = makeOtif(95, 100); // 95.0%
    mockPrevOtifQuery.data = null;
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    expect(screen.queryByText(/vs semana anterior/)).not.toBeInTheDocument();
  });

  it('shows skeleton when loading', () => {
    mockOtifQuery.isLoading = true;
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    expect(screen.queryByText('N/A')).not.toBeInTheDocument();
    expect(screen.queryByText(/Cumplimiento SLA/)).not.toBeInTheDocument();
  });

  it('shows error alert when query fails', () => {
    mockOtifQuery.isError = true;
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    expect(screen.getByText('Los datos pueden estar desactualizados')).toBeInTheDocument();
  });

  it('opens dialog on click', async () => {
    mockOtifQuery.data = makeOtif(95, 100);
    renderWithProvider(<HeroSLA operatorId="op-123" />);

    const hero = screen.getByRole('button', { name: /Ver analisis detallado de SLA/ });
    await userEvent.click(hero);

    await waitFor(() => {
      expect(screen.getByText('Analisis Detallado de SLA')).toBeInTheDocument();
    });
  });

  it('opens dialog on Enter key', async () => {
    mockOtifQuery.data = makeOtif(95, 100);
    renderWithProvider(<HeroSLA operatorId="op-123" />);

    const hero = screen.getByRole('button', { name: /Ver analisis detallado de SLA/ });
    hero.focus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Analisis Detallado de SLA')).toBeInTheDocument();
    });
  });

  it('uses provided startDate/endDate props instead of hardcoded dates', () => {
    mockOtifQuery.data = makeOtif(95, 100);
    renderWithProvider(<HeroSLA operatorId="op-123" startDate="2026-01-01" endDate="2026-01-07" />);
    expect(screen.getAllByText('95.0%')[0]).toBeInTheDocument();
  });

  it('renders context line with delivery counts when data is available', () => {
    mockOtifQuery.data = makeOtif(190, 200);
    renderWithProvider(<HeroSLA operatorId="op-123" />);
    expect(screen.getByText('190 de 200 entregas cumplidas')).toBeInTheDocument();
  });

  it('renders FADR and failure count in inline metrics', () => {
    mockOtifQuery.data = makeOtif(190, 200, 10);
    mockFadrQuery.data = 88.5;
    renderWithProvider(<HeroSLA operatorId="op-123" />);

    expect(screen.getByText(/Primera Entrega \(FADR\): 88\.5%/)).toBeInTheDocument();
    expect(screen.getByText(/Fallos: 10 \(5\.0%\)/)).toBeInTheDocument();
  });
});
