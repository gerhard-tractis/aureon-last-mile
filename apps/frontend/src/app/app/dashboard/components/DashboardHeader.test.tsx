import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
}));

import { useIsMobile } from '@/hooks/useIsMobile';
import { DashboardHeader } from './DashboardHeader';
import type { DashboardPeriod } from '@/app/app/dashboard/lib/period';

const MARCH_2026: DashboardPeriod = {
  preset: 'month',
  year: 2026,
  month: 3,
  start: new Date(2026, 2, 1),
  end: new Date(2026, 2, 31, 23, 59, 59),
};

describe('DashboardHeader', () => {
  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(false);
  });

  it('renders title "Dashboard ejecutivo"', () => {
    render(
      <DashboardHeader
        period={MARCH_2026}
        onSetPreset={vi.fn()}
        onSetCustomRange={vi.fn()}
      />,
    );
    expect(screen.getByText('Dashboard ejecutivo')).toBeInTheDocument();
  });

  it('renders PeriodSelector (pill buttons visible on desktop)', () => {
    render(
      <DashboardHeader
        period={MARCH_2026}
        onSetPreset={vi.fn()}
        onSetCustomRange={vi.fn()}
      />,
    );
    // PeriodSelector renders "Mes" pill on desktop
    expect(screen.getByRole('button', { name: 'Mes' })).toBeInTheDocument();
  });

  it('renders "as of" line with the formatted period label "Marzo 2026"', () => {
    render(
      <DashboardHeader
        period={MARCH_2026}
        onSetPreset={vi.fn()}
        onSetCustomRange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Marzo 2026/)).toBeInTheDocument();
  });
});
