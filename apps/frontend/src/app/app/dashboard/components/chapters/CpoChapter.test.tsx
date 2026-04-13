import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CpoChapter } from './CpoChapter';
import type { DashboardPeriod } from '@/app/app/dashboard/lib/period';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/dashboard/useCpoChapter', () => ({
  useCpoChapter: vi.fn(),
}));

vi.mock('@/app/app/dashboard/components/Chapter', () => ({
  Chapter: ({ headline, children }: { headline: string; children: React.ReactNode }) => (
    <div>
      <span data-testid="headline">{headline}</span>
      {children}
    </div>
  ),
}));

vi.mock('@/app/app/dashboard/components/ChapterPlaceholder', () => ({
  ChapterPlaceholder: ({ reason, children }: { reason: string; children?: React.ReactNode }) => (
    <div data-testid="chapter-placeholder">
      <span>—</span>
      <p>{reason}</p>
      {children}
    </div>
  ),
}));

vi.mock('@/app/app/dashboard/components/tactical/FadrCard', () => ({
  FadrCard: ({ isLoading }: { data: unknown; isLoading: boolean }) => (
    <div data-testid="fadr-card" data-loading={String(isLoading)}>FadrCard</div>
  ),
}));

vi.mock('@/app/app/dashboard/components/tactical/RouteKmCard', () => ({
  RouteKmCard: ({ isLoading }: { data: unknown; isLoading: boolean }) => (
    <div data-testid="route-km-card" data-loading={String(isLoading)}>RouteKmCard</div>
  ),
}));

vi.mock('@/app/app/dashboard/components/tactical/KmPerStopCard', () => ({
  KmPerStopCard: ({ isLoading }: { data: unknown; isLoading: boolean }) => (
    <div data-testid="km-per-stop-card" data-loading={String(isLoading)}>KmPerStopCard</div>
  ),
}));

vi.mock('@/app/app/dashboard/components/tactical/OrdersPerRouteCard', () => ({
  OrdersPerRouteCard: ({ isLoading }: { data: unknown; isLoading: boolean }) => (
    <div data-testid="orders-per-route-card" data-loading={String(isLoading)}>OrdersPerRouteCard</div>
  ),
}));

vi.mock('@/app/app/dashboard/components/tactical/GasPlaceholderCard', () => ({
  GasPlaceholderCard: () => (
    <div data-testid="gas-placeholder-card">GasPlaceholderCard</div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { useCpoChapter } from '@/hooks/dashboard/useCpoChapter';

const mockUseCpoChapter = vi.mocked(useCpoChapter);

const PERIOD: DashboardPeriod = {
  preset: 'month',
  year: 2026,
  month: 3,
  start: new Date(2026, 2, 1),
  end: new Date(2026, 2, 31, 23, 59, 59),
};

const ROUTE_TACTICS = {
  fadr_pct: 92.5,
  avg_km_per_route: 110.0,
  avg_km_per_stop: 7.5,
  avg_orders_per_route: 13.0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CpoChapter', () => {
  beforeEach(() => {
    mockUseCpoChapter.mockReturnValue({
      routeTactics: ROUTE_TACTICS,
      isLoading: false,
      isError: false,
      fetchStatus: 'idle',
    });
  });

  it('renders chapter headline CPO', () => {
    render(<CpoChapter operatorId="op-1" period={PERIOD} />);
    expect(screen.getByTestId('headline')).toHaveTextContent('CPO');
  });

  it('renders placeholder hero (contains — from ChapterPlaceholder)', () => {
    render(<CpoChapter operatorId="op-1" period={PERIOD} />);
    expect(screen.getByTestId('chapter-placeholder')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders all 5 tactical cards', () => {
    render(<CpoChapter operatorId="op-1" period={PERIOD} />);
    expect(screen.getByTestId('fadr-card')).toBeInTheDocument();
    expect(screen.getByTestId('route-km-card')).toBeInTheDocument();
    expect(screen.getByTestId('km-per-stop-card')).toBeInTheDocument();
    expect(screen.getByTestId('orders-per-route-card')).toBeInTheDocument();
    expect(screen.getByTestId('gas-placeholder-card')).toBeInTheDocument();
  });

  it('passes isLoading=true to tactical cards when hook is loading', () => {
    mockUseCpoChapter.mockReturnValue({
      routeTactics: null,
      isLoading: true,
      isError: false,
      fetchStatus: 'fetching',
    });
    render(<CpoChapter operatorId="op-1" period={PERIOD} />);
    expect(screen.getByTestId('fadr-card')).toHaveAttribute('data-loading', 'true');
    expect(screen.getByTestId('route-km-card')).toHaveAttribute('data-loading', 'true');
    expect(screen.getByTestId('km-per-stop-card')).toHaveAttribute('data-loading', 'true');
    expect(screen.getByTestId('orders-per-route-card')).toHaveAttribute('data-loading', 'true');
  });
});
