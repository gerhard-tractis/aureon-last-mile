import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import DashboardPage from './page';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useDashboardPeriod } from '@/hooks/dashboard/useDashboardPeriod';
import { useRouter } from 'next/navigation';

vi.mock('@/hooks/useOperatorId', () => ({ useOperatorId: vi.fn() }));
vi.mock('@/hooks/dashboard/useDashboardPeriod', () => ({ useDashboardPeriod: vi.fn() }));
vi.mock('@/app/app/dashboard/components/DashboardHeader', () => ({
  DashboardHeader: () => <div data-testid="dashboard-header" />,
}));
vi.mock('@/app/app/dashboard/components/NorthStarStrip', () => ({
  NorthStarStrip: () => <div data-testid="north-star-strip" />,
}));
vi.mock('@/app/app/dashboard/components/chapters/CpoChapter', () => ({
  CpoChapter: () => <div data-testid="cpo-chapter" />,
}));
vi.mock('@/app/app/dashboard/components/chapters/OtifChapter', () => ({
  OtifChapter: () => <div data-testid="otif-chapter" />,
}));
vi.mock('@/app/app/dashboard/components/chapters/NpsChapter', () => ({
  NpsChapter: () => <div data-testid="nps-chapter" />,
}));
vi.mock('@/app/app/dashboard/components/drill/DrillSheet', () => ({
  DrillSheet: () => <div data-testid="drill-sheet" />,
}));
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
}));

const mockPeriod = {
  period: {
    preset: 'month' as const,
    year: 2026,
    month: 4,
    start: new Date('2026-04-01'),
    end: new Date('2026-04-30'),
  },
  priorMonthPeriod: {
    preset: 'month' as const,
    year: 2026,
    month: 3,
    start: new Date('2026-03-01'),
    end: new Date('2026-03-31'),
  },
  priorYearPeriod: null,
  setPreset: vi.fn(),
  setCustomRange: vi.fn(),
};

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.mocked(useDashboardPeriod).mockReturnValue(mockPeriod);
    vi.mocked(useRouter).mockReturnValue({ push: vi.fn(), replace: vi.fn() } as never);
  });

  it('redirects to /app when role is driver', () => {
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push, replace: vi.fn() } as never);
    vi.mocked(useOperatorId).mockReturnValue({ operatorId: 'op-1', role: 'driver', permissions: [] });
    render(<Suspense fallback={null}><DashboardPage /></Suspense>);
    expect(push).toHaveBeenCalledWith('/app');
  });

  it('renders skeleton when role is null (loading)', () => {
    vi.mocked(useOperatorId).mockReturnValue({ operatorId: '', role: null as unknown as string, permissions: [] });
    render(<Suspense fallback={null}><DashboardPage /></Suspense>);
    expect(screen.getByTestId('dashboard-skeleton')).toBeTruthy();
  });

  it('renders all data sections for admin with operatorId', () => {
    vi.mocked(useOperatorId).mockReturnValue({ operatorId: 'op-1', role: 'admin', permissions: [] });
    render(<Suspense fallback={null}><DashboardPage /></Suspense>);
    expect(screen.getByTestId('dashboard-header')).toBeTruthy();
    expect(screen.getByTestId('north-star-strip')).toBeTruthy();
    expect(screen.getByTestId('cpo-chapter')).toBeTruthy();
    expect(screen.getByTestId('otif-chapter')).toBeTruthy();
    expect(screen.getByTestId('nps-chapter')).toBeTruthy();
  });

  it('renders Spanish copy "Dashboard ejecutivo"', () => {
    vi.mocked(useOperatorId).mockReturnValue({ operatorId: 'op-1', role: 'admin', permissions: [] });
    render(<Suspense fallback={null}><DashboardPage /></Suspense>);
    expect(screen.getByText('Dashboard ejecutivo')).toBeTruthy();
  });

  it('renders DrillSheet when role allows', () => {
    vi.mocked(useOperatorId).mockReturnValue({ operatorId: 'op-1', role: 'operations_manager', permissions: [] });
    render(<Suspense fallback={null}><DashboardPage /></Suspense>);
    expect(screen.getByTestId('drill-sheet')).toBeTruthy();
  });

  it('does not redirect admin to /operaciones', () => {
    vi.mocked(useOperatorId).mockReturnValue({ operatorId: 'op-1', role: 'admin', permissions: [] });
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push, replace: vi.fn() } as never);
    render(<Suspense fallback={null}><DashboardPage /></Suspense>);
    expect(push).not.toHaveBeenCalledWith('/app/dashboard/operaciones');
  });
});
