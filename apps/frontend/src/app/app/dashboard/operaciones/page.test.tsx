import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import OperacionesPage from './page';

const pushMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
}));

vi.mock('@/hooks/useDashboardMetrics', () => ({
  useOperatorId: () => ({ operatorId: 'test-op', role: 'admin' }),
}));

vi.mock('@/hooks/useDatePreset', () => ({
  useDatePreset: () => ({
    startDate: '2026-03-17',
    endDate: '2026-03-23',
    prevStartDate: '2026-03-10',
    prevEndDate: '2026-03-16',
  }),
}));

vi.mock('@/components/dashboard/HeroSLASkeleton', () => ({
  default: () => <div>Skeleton</div>,
}));
vi.mock('@/components/dashboard/OfflineBanner', () => ({
  default: () => <div>OfflineBanner</div>,
}));
vi.mock('@/components/dashboard/HeroSLA', () => ({
  default: () => <div data-testid="hero-sla">HeroSLA</div>,
}));
vi.mock('@/components/dashboard/DashboardKPIStrip', () => ({
  DashboardKPIStrip: () => <div data-testid="kpi-strip">KPIStrip</div>,
}));
vi.mock('@/components/dashboard/DailyOrdersChart', () => ({
  default: () => <div data-testid="daily-orders-chart">DailyOrders</div>,
}));
vi.mock('@/components/dashboard/CommittedOrdersChart', () => ({
  default: () => <div data-testid="committed-orders-chart">CommittedOrders</div>,
}));
vi.mock('@/components/dashboard/DateFilterBar', () => ({
  default: () => <div data-testid="date-filter">DateFilter</div>,
}));
vi.mock('@/components/dashboard/CustomerPerformanceTable', () => ({
  default: () => <div data-testid="customer-table">CustomerTable</div>,
}));
vi.mock('@/components/dashboard/LoadingTab', () => ({
  default: () => <div data-testid="loading-tab">LoadingTab</div>,
}));
vi.mock('@/components/dashboard/DeliveryTab', () => ({
  default: () => <div data-testid="delivery-tab">DeliveryTab</div>,
}));
vi.mock('@/components/dashboard/DistributionTab', () => ({
  DistributionTab: () => <div data-testid="distribution-tab">DistributionTab</div>,
}));

function renderWithProvider(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('OperacionesPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    searchParams = new URLSearchParams();
  });

  it('shows loading-tab by default', () => {
    renderWithProvider(<OperacionesPage />);
    expect(screen.getByTestId('loading-tab')).toBeDefined();
  });

  it('shows delivery-tab when tab=lastmile', () => {
    searchParams = new URLSearchParams('tab=lastmile');
    renderWithProvider(<OperacionesPage />);
    expect(screen.getByTestId('delivery-tab')).toBeDefined();
  });

  it('renders Carga tab button', () => {
    renderWithProvider(<OperacionesPage />);
    expect(screen.getByRole('tab', { name: /Carga/ })).toBeDefined();
  });

  it('shows distribution-tab when tab=distribution', () => {
    searchParams = new URLSearchParams('tab=distribution');
    renderWithProvider(<OperacionesPage />);
    expect(screen.getByTestId('distribution-tab')).toBeDefined();
  });

  it('renders command center components', () => {
    renderWithProvider(<OperacionesPage />);
    expect(screen.getByTestId('hero-sla')).toBeDefined();
    expect(screen.getByTestId('kpi-strip')).toBeDefined();
    expect(screen.getByTestId('daily-orders-chart')).toBeDefined();
    expect(screen.getByTestId('committed-orders-chart')).toBeDefined();
    expect(screen.getByTestId('customer-table')).toBeDefined();
  });

  it('wraps content in PageShell with title', () => {
    renderWithProvider(<OperacionesPage />);
    // PageShell renders h1 with title
    expect(screen.getByRole('heading', { name: 'Operaciones' })).toBeDefined();
  });
});
