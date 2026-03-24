import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AnaliticaPage from './page';

const pushMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
  usePathname: () => '/app/dashboard/analitica',
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
vi.mock('@/components/analytics/OtifTab', () => ({
  default: () => <div data-testid="otif-tab">OtifTab</div>,
}));
vi.mock('@/components/analytics/UnitEconomicsTab', () => ({
  default: () => <div data-testid="unit-economics-tab">UnitEconomicsTab</div>,
}));
vi.mock('@/components/analytics/CxTab', () => ({
  default: () => <div data-testid="cx-tab">CxTab</div>,
}));

describe('AnaliticaPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    searchParams = new URLSearchParams();
  });

  it('shows otif-tab by default', () => {
    render(<AnaliticaPage />);
    expect(screen.getByTestId('otif-tab')).toBeDefined();
  });

  it('shows unit-economics-tab when tab=unit_economics', () => {
    searchParams = new URLSearchParams('tab=unit_economics');
    render(<AnaliticaPage />);
    expect(screen.getByTestId('unit-economics-tab')).toBeDefined();
  });

  it('renders OTIF tab button', () => {
    render(<AnaliticaPage />);
    expect(screen.getByRole('tab', { name: 'OTIF' })).toBeDefined();
  });
});
