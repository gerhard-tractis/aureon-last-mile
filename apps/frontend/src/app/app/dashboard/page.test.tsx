import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DashboardPage from './page';

const pushMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
}));

vi.mock('@/hooks/useDashboardMetrics', () => ({
  useOperatorId: () => ({ operatorId: 'test-op', role: 'admin' }),
}));

vi.mock('@/components/dashboard/HeroSLA', () => ({
  default: () => <div data-testid="hero-sla">HeroSLA</div>,
}));
vi.mock('@/components/dashboard/HeroSLASkeleton', () => ({
  default: () => <div>Skeleton</div>,
}));
vi.mock('@/components/dashboard/PrimaryMetricsGrid', () => ({
  default: () => <div data-testid="primary-metrics">PrimaryMetricsGrid</div>,
}));
vi.mock('@/components/dashboard/CustomerPerformanceTable', () => ({
  default: () => <div>CustomerPerformanceTable</div>,
}));
vi.mock('@/components/dashboard/FailedDeliveriesAnalysis', () => ({
  default: () => <div>FailedDeliveriesAnalysis</div>,
}));
vi.mock('@/components/dashboard/SecondaryMetricsGrid', () => ({
  default: () => <div>SecondaryMetricsGrid</div>,
}));
vi.mock('@/components/dashboard/ExportDashboardModal', () => ({
  default: () => <div>ExportDashboardModal</div>,
}));
vi.mock('@/components/dashboard/OfflineBanner', () => ({
  default: () => <div>OfflineBanner</div>,
}));
vi.mock('@/components/dashboard/LoadingTab', () => ({
  default: () => <div data-testid="loading-tab">LoadingTab</div>,
}));

describe('DashboardPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    searchParams = new URLSearchParams();
  });

  it('renders PipelineNav', () => {
    render(<DashboardPage />);
    expect(screen.getAllByText(/Vista General/).length).toBeGreaterThan(0);
  });

  it('shows overview content by default', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('hero-sla')).toBeDefined();
  });

  it('shows loading-tab and hides hero-sla when Carga tab clicked', () => {
    render(<DashboardPage />);
    // Click the desktop tab button for Carga
    const cargaButton = screen.getByRole('tab', { name: /Carga/ });
    fireEvent.click(cargaButton);
    // router.push should have been called with loading tab
    expect(pushMock).toHaveBeenCalledWith('?tab=loading');
  });

  it('shows loading-tab content when tab=loading', () => {
    searchParams = new URLSearchParams('tab=loading');
    render(<DashboardPage />);
    expect(screen.getByTestId('loading-tab')).toBeDefined();
    expect(screen.queryByTestId('hero-sla')).toBeNull();
  });
});
