import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OtifChapter } from './OtifChapter';
import type { DashboardPeriod } from '@/app/app/dashboard/lib/period';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/dashboard/useNorthStars', () => ({
  useNorthStars: vi.fn(),
}));

vi.mock('@/hooks/dashboard/useOtifChapter', () => ({
  useOtifChapter: vi.fn(),
}));

vi.mock('@/app/app/dashboard/components/Chapter', () => ({
  Chapter: ({ annotation, headline, children }: { annotation: string; headline: string; children: React.ReactNode }) => (
    <div>
      <span data-testid="annotation">{annotation}</span>
      <span data-testid="headline">{headline}</span>
      {children}
    </div>
  ),
}));

vi.mock('@/app/app/dashboard/components/ChapterHeroBand', () => ({
  ChapterHeroBand: ({
    value,
    momDelta,
    yoyDelta,
    meta,
  }: {
    value: string;
    momDelta: number | null;
    yoyDelta: number | null;
    meta?: string;
  }) => (
    <div data-testid="chapter-hero-band">
      <span data-testid="hero-value">{value}</span>
      <span data-testid="hero-mom">{momDelta ?? '—'}</span>
      <span data-testid="hero-yoy">{yoyDelta ?? '—'}</span>
      {meta && <span data-testid="hero-meta">{meta}</span>}
    </div>
  ),
}));

vi.mock('@/app/app/dashboard/components/tactical/OtifByRegion', () => ({
  OtifByRegion: ({ isLoading }: { data: unknown; isLoading: boolean }) => (
    <div data-testid="otif-by-region" data-loading={String(isLoading)}>OtifByRegion</div>
  ),
}));

vi.mock('@/app/app/dashboard/components/tactical/OtifByCustomer', () => ({
  OtifByCustomer: ({ isLoading }: { data: unknown; isLoading: boolean }) => (
    <div data-testid="otif-by-customer" data-loading={String(isLoading)}>OtifByCustomer</div>
  ),
}));

vi.mock('@/app/app/dashboard/components/tactical/LateReasonsSummary', () => ({
  LateReasonsSummary: ({ isLoading }: { data: unknown; isLoading: boolean }) => (
    <div data-testid="late-reasons-summary" data-loading={String(isLoading)}>LateReasonsSummary</div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { useNorthStars } from '@/hooks/dashboard/useNorthStars';
import { useOtifChapter } from '@/hooks/dashboard/useOtifChapter';

const mockUseNorthStars = vi.mocked(useNorthStars);
const mockUseOtifChapter = vi.mocked(useOtifChapter);

const PERIOD: DashboardPeriod = {
  preset: 'month',
  year: 2026,
  month: 3,
  start: new Date(2026, 2, 1),
  end: new Date(2026, 2, 31, 23, 59, 59),
};

const NORTH_STARS_DATA = {
  current: { otif_pct: 94.2, row_type: 'current' as const, period_year: 2026, period_month: 3, cpo_clp: null, nps_score: null, csat_pct: null, total_orders: 100, delivered_orders: 94, failed_orders: 6, computed_at: '' },
  priorMonth: { otif_pct: 92.8, row_type: 'prior_month' as const, period_year: 2026, period_month: 2, cpo_clp: null, nps_score: null, csat_pct: null, total_orders: 95, delivered_orders: 88, failed_orders: 7, computed_at: '' },
  priorYear: { otif_pct: 90.1, row_type: 'prior_year' as const, period_year: 2025, period_month: 3, cpo_clp: null, nps_score: null, csat_pct: null, total_orders: 80, delivered_orders: 72, failed_orders: 8, computed_at: '' },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OtifChapter', () => {
  beforeEach(() => {
    mockUseNorthStars.mockReturnValue({
      data: NORTH_STARS_DATA,
      isLoading: false,
      isError: false,
      status: 'success',
      fetchStatus: 'idle',
    } as ReturnType<typeof useNorthStars>);

    mockUseOtifChapter.mockReturnValue({
      byRegion: [],
      byCustomer: [],
      lateReasons: [],
      isLoading: false,
      isError: false,
    });
  });

  it('renders annotation CAPÍTULO 02', () => {
    render(<OtifChapter operatorId="op-1" period={PERIOD} />);
    expect(screen.getByTestId('annotation')).toHaveTextContent('CAPÍTULO 02');
  });

  it('renders headline OTIF', () => {
    render(<OtifChapter operatorId="op-1" period={PERIOD} />);
    expect(screen.getByTestId('headline')).toHaveTextContent('OTIF');
  });

  it('renders hero band with OTIF value from data', () => {
    render(<OtifChapter operatorId="op-1" period={PERIOD} />);
    expect(screen.getByTestId('chapter-hero-band')).toBeInTheDocument();
    // formatPercent(94.2) = '94,2%'
    expect(screen.getByTestId('hero-value')).toHaveTextContent('94,2%');
  });

  it('renders MoM delta (current - priorMonth = 94.2 - 92.8 = 1.4)', () => {
    render(<OtifChapter operatorId="op-1" period={PERIOD} />);
    // momDelta = 94.2 - 92.8 = 1.4 (approximately)
    const momEl = screen.getByTestId('hero-mom');
    expect(momEl.textContent).not.toBe('—');
  });

  it('renders YoY delta when prior year data available', () => {
    render(<OtifChapter operatorId="op-1" period={PERIOD} />);
    const yoyEl = screen.getByTestId('hero-yoy');
    expect(yoyEl.textContent).not.toBe('—');
  });

  it('renders — for YoY delta when prior year data is null', () => {
    mockUseNorthStars.mockReturnValue({
      data: { ...NORTH_STARS_DATA, priorYear: null },
      isLoading: false,
      isError: false,
      status: 'success',
      fetchStatus: 'idle',
    } as ReturnType<typeof useNorthStars>);
    render(<OtifChapter operatorId="op-1" period={PERIOD} />);
    expect(screen.getByTestId('hero-yoy')).toHaveTextContent('—');
  });

  it('renders all 3 tactical components', () => {
    render(<OtifChapter operatorId="op-1" period={PERIOD} />);
    expect(screen.getByTestId('otif-by-region')).toBeInTheDocument();
    expect(screen.getByTestId('otif-by-customer')).toBeInTheDocument();
    expect(screen.getByTestId('late-reasons-summary')).toBeInTheDocument();
  });
});
