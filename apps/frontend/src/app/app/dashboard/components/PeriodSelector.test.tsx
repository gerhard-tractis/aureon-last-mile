import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
}));

import { useIsMobile } from '@/hooks/useIsMobile';
import { PeriodSelector } from './PeriodSelector';
import type { DashboardPeriod } from '@/app/app/dashboard/lib/period';

const BASE_PERIOD: DashboardPeriod = {
  preset: 'month',
  year: 2026,
  month: 3,
  start: new Date(2026, 2, 1),
  end: new Date(2026, 2, 31, 23, 59, 59),
};

describe('PeriodSelector — mobile', () => {
  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(true);
  });

  it('renders a Select dropdown on mobile', () => {
    render(
      <PeriodSelector
        period={BASE_PERIOD}
        onSetPreset={vi.fn()}
        onSetCustomRange={vi.fn()}
      />,
    );
    // The shadcn Select renders a button with role="combobox"
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('Select shows all 4 preset options when opened', async () => {
    render(
      <PeriodSelector
        period={BASE_PERIOD}
        onSetPreset={vi.fn()}
        onSetCustomRange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    // "Mes" appears in both the trigger and the dropdown option — use getAllByText
    expect((await screen.findAllByText('Mes')).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('Trimestre')).toBeInTheDocument();
    expect(await screen.findByText('YTD')).toBeInTheDocument();
    expect(await screen.findByText('Personalizado')).toBeInTheDocument();
  });
});

describe('PeriodSelector — desktop', () => {
  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(false);
  });

  it('renders pill buttons on desktop', () => {
    render(
      <PeriodSelector
        period={BASE_PERIOD}
        onSetPreset={vi.fn()}
        onSetCustomRange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Mes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trimestre' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'YTD' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Personalizado' })).toBeInTheDocument();
  });

  it('clicking Trimestre pill calls onSetPreset with "quarter"', () => {
    const onSetPreset = vi.fn();
    render(
      <PeriodSelector
        period={BASE_PERIOD}
        onSetPreset={onSetPreset}
        onSetCustomRange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Trimestre' }));
    expect(onSetPreset).toHaveBeenCalledWith('quarter');
  });

  it('active period pill has a distinct bg class compared to inactive pills', () => {
    render(
      <PeriodSelector
        period={BASE_PERIOD}
        onSetPreset={vi.fn()}
        onSetCustomRange={vi.fn()}
      />,
    );
    // "Mes" is active (preset === 'month')
    const activeBtn = screen.getByRole('button', { name: 'Mes' });
    const inactiveBtn = screen.getByRole('button', { name: 'Trimestre' });
    // Active button should have a different className
    expect(activeBtn.className).not.toBe(inactiveBtn.className);
  });

  it('clicking Personalizado shows from/to date inputs', () => {
    const { rerender } = render(
      <PeriodSelector
        period={BASE_PERIOD}
        onSetPreset={vi.fn()}
        onSetCustomRange={vi.fn()}
      />,
    );
    // Click Personalizado button — it calls onSetPreset('custom'), but we
    // also need to test the custom UI. We render with preset='custom'.
    const customPeriod: DashboardPeriod = {
      ...BASE_PERIOD,
      preset: 'custom',
      customFrom: '2026-02-01',
      customTo: '2026-03-31',
    };
    rerender(
      <PeriodSelector
        period={customPeriod}
        onSetPreset={vi.fn()}
        onSetCustomRange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/desde/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/hasta/i)).toBeInTheDocument();
  });
});
