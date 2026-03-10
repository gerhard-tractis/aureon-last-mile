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

vi.mock('@/components/dashboard/HeroSLASkeleton', () => ({
  default: () => <div>Skeleton</div>,
}));
vi.mock('@/components/dashboard/OfflineBanner', () => ({
  default: () => <div>OfflineBanner</div>,
}));
vi.mock('@/components/dashboard/LoadingTab', () => ({
  default: () => <div data-testid="loading-tab">LoadingTab</div>,
}));
vi.mock('@/components/dashboard/DeliveryTab', () => ({
  default: () => <div data-testid="delivery-tab">DeliveryTab</div>,
}));
vi.mock('@/components/analytics/OtifTab', () => ({
  default: () => <div data-testid="otif-tab">OtifTab</div>,
}));
vi.mock('@/components/analytics/UnitEconomicsTab', () => ({
  default: () => <div data-testid="unit-economics-tab">UnitEconomicsTab</div>,
}));
vi.mock('@/components/analytics/CxTab', () => ({
  default: () => <div data-testid="cx-tab">CxTab</div>,
}));

describe('DashboardPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    searchParams = new URLSearchParams();
  });

  it('renders PipelineNav with Operaciones and Analítica sections', () => {
    render(<DashboardPage />);
    expect(screen.getAllByText(/Operaciones/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Analítica/).length).toBeGreaterThan(0);
  });

  it('shows loading-tab by default', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('loading-tab')).toBeDefined();
  });

  it('shows loading-tab content when tab=loading', () => {
    searchParams = new URLSearchParams('tab=loading');
    render(<DashboardPage />);
    expect(screen.getByTestId('loading-tab')).toBeDefined();
  });

  it('shows delivery-tab content when tab=lastmile', () => {
    searchParams = new URLSearchParams('tab=lastmile');
    render(<DashboardPage />);
    expect(screen.getByTestId('delivery-tab')).toBeDefined();
    expect(screen.queryByTestId('loading-tab')).toBeNull();
  });

  it('shows delivery-tab content when tab=delivery (legacy redirect)', () => {
    searchParams = new URLSearchParams('tab=delivery');
    render(<DashboardPage />);
    expect(screen.getByTestId('delivery-tab')).toBeDefined();
  });

  it('shows otif-tab when tab=analytics_otif', () => {
    searchParams = new URLSearchParams('tab=analytics_otif');
    render(<DashboardPage />);
    expect(screen.getByTestId('otif-tab')).toBeDefined();
    expect(screen.queryByTestId('loading-tab')).toBeNull();
  });

  it('clicking Carga tab calls router.push with loading', () => {
    render(<DashboardPage />);
    const cargaButton = screen.getByRole('tab', { name: /Carga/ });
    fireEvent.click(cargaButton);
    expect(pushMock).toHaveBeenCalledWith('?tab=loading');
  });
});
