import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('OperacionesPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    searchParams = new URLSearchParams();
  });

  it('shows loading-tab by default', () => {
    render(<OperacionesPage />);
    expect(screen.getByTestId('loading-tab')).toBeDefined();
  });

  it('shows delivery-tab when tab=lastmile', () => {
    searchParams = new URLSearchParams('tab=lastmile');
    render(<OperacionesPage />);
    expect(screen.getByTestId('delivery-tab')).toBeDefined();
  });

  it('renders Carga tab button', () => {
    render(<OperacionesPage />);
    expect(screen.getByRole('tab', { name: /Carga/ })).toBeDefined();
  });
});
