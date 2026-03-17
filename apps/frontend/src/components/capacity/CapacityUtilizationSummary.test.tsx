import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CapacityUtilizationSummary from './CapacityUtilizationSummary';

const mockUtilizationReturn = {
  data: [
    {
      client_id: 'client-a',
      retailer_name: 'Retailer A',
      capacity_date: '2026-03-01',
      daily_capacity: 300,
      actual_orders: 270,
      utilization_pct: 90,
      source: 'manual',
    },
    {
      client_id: 'client-a',
      retailer_name: 'Retailer A',
      capacity_date: '2026-03-02',
      daily_capacity: 300,
      actual_orders: 330,
      utilization_pct: 110,
      source: 'manual',
    },
    {
      client_id: 'client-b',
      retailer_name: 'Retailer B',
      capacity_date: '2026-03-01',
      daily_capacity: 200,
      actual_orders: 180,
      utilization_pct: 90,
      source: 'rule',
    },
  ],
  isLoading: false,
};

vi.mock('@/hooks/useCapacityUtilization', () => ({
  useCapacityUtilization: () => mockUtilizationReturn,
}));

describe('CapacityUtilizationSummary', () => {
  it('renders table headers', () => {
    render(
      <CapacityUtilizationSummary
        operatorId="op-1"
        month="2026-03"
      />
    );
    // Use exact column header text
    expect(screen.getByText('Retailer')).toBeDefined();
    expect(screen.getByText('Utilización')).toBeDefined();
    expect(screen.getByRole('columnheader', { name: /Días >100%/i })).toBeDefined();
  });

  it('shows retailer names', () => {
    render(
      <CapacityUtilizationSummary
        operatorId="op-1"
        month="2026-03"
      />
    );
    expect(screen.getByText('Retailer A')).toBeDefined();
    expect(screen.getByText('Retailer B')).toBeDefined();
  });

  it('calculates days over 100% correctly', () => {
    render(
      <CapacityUtilizationSummary
        operatorId="op-1"
        month="2026-03"
      />
    );
    // Retailer A has 1 day over 100% (110%)
    const cells = screen.getAllByText('1');
    expect(cells.length).toBeGreaterThan(0);
  });

  it('shows loading skeleton when isLoading is true', () => {
    (mockUtilizationReturn as { isLoading: boolean }).isLoading = true;
    render(
      <CapacityUtilizationSummary
        operatorId="op-1"
        month="2026-03"
      />
    );
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
    (mockUtilizationReturn as { isLoading: boolean }).isLoading = false;
  });
});
