import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CapacityCalendar from './CapacityCalendar';

vi.mock('@/hooks/useCapacityCalendar', () => ({
  useCapacityCalendar: () => ({
    data: [
      {
        capacity_date: '2026-03-02',
        daily_capacity: 300,
        actual_orders: 278,
        utilization_pct: 92.7,
        source: 'manual',
      },
    ],
    isLoading: false,
    dataUpdatedAt: 1741900000000,
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            order: () => ({
              data: [
                { id: 'c-1', name: 'Retailer A' },
                { id: 'c-2', name: 'Retailer B' },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/components/capacity/CapacityCell', () => ({
  default: ({ date, capacity }: { date: string; capacity: number | null }) => (
    <div data-testid={`cell-${date}`}>{capacity ?? '—'}</div>
  ),
}));

describe('CapacityCalendar', () => {
  it('renders month navigation buttons', () => {
    render(
      <CapacityCalendar
        operatorId="op-1"
        initialMonth="2026-03"
      />
    );
    expect(screen.getByRole('button', { name: /anterior/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDefined();
  });

  it('shows month/year label', () => {
    render(
      <CapacityCalendar
        operatorId="op-1"
        initialMonth="2026-03"
      />
    );
    expect(screen.getByText(/Marzo 2026/i)).toBeDefined();
  });

  it('renders day-of-week headers', () => {
    render(
      <CapacityCalendar
        operatorId="op-1"
        initialMonth="2026-03"
      />
    );
    expect(screen.getByText('Lun')).toBeDefined();
    expect(screen.getByText('Dom')).toBeDefined();
  });

  it('navigates to next month on click', () => {
    render(
      <CapacityCalendar
        operatorId="op-1"
        initialMonth="2026-03"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    expect(screen.getByText(/Abril 2026/i)).toBeDefined();
  });

  it('navigates to previous month on click', () => {
    render(
      <CapacityCalendar
        operatorId="op-1"
        initialMonth="2026-03"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /anterior/i }));
    expect(screen.getByText(/Febrero 2026/i)).toBeDefined();
  });

  it('shows updated timestamp', () => {
    render(
      <CapacityCalendar
        operatorId="op-1"
        initialMonth="2026-03"
      />
    );
    expect(screen.getByText(/Actualizado/i)).toBeDefined();
  });
});
