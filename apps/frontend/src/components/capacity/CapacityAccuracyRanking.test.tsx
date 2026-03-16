import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CapacityAccuracyRanking from './CapacityAccuracyRanking';

const mockAccuracyReturn = {
  data: [
    {
      client_id: 'client-a',
      retailer_name: 'Retailer A',
      capacity_date: '2026-03-01',
      forecasted: 300,
      actual: 270,
      accuracy_pct: 90,
    },
    {
      client_id: 'client-a',
      retailer_name: 'Retailer A',
      capacity_date: '2026-03-02',
      forecasted: 300,
      actual: 330,
      accuracy_pct: 90,
    },
    {
      client_id: 'client-b',
      retailer_name: 'Retailer B',
      capacity_date: '2026-03-01',
      forecasted: 200,
      actual: 160,
      accuracy_pct: 80,
    },
  ],
  isLoading: false,
};

vi.mock('@/hooks/useForecastAccuracy', () => ({
  useForecastAccuracy: () => mockAccuracyReturn,
}));

describe('CapacityAccuracyRanking', () => {
  it('renders table headers', () => {
    render(
      <CapacityAccuracyRanking
        operatorId="op-1"
        month="2026-03"
      />
    );
    // Use exact header text to avoid matching data rows
    expect(screen.getByText('Retailer')).toBeDefined();
    expect(screen.getByText('Precisión')).toBeDefined();
    expect(screen.getByText('Días Medidos')).toBeDefined();
  });

  it('shows retailers sorted by accuracy descending', () => {
    render(
      <CapacityAccuracyRanking
        operatorId="op-1"
        month="2026-03"
      />
    );
    const rows = screen.getAllByRole('row');
    // Header + 2 data rows
    expect(rows.length).toBe(3);
    // First data row should be Retailer A (90% accuracy > 80%)
    expect(rows[1].textContent).toContain('Retailer A');
    expect(rows[2].textContent).toContain('Retailer B');
  });

  it('shows days measured count', () => {
    render(
      <CapacityAccuracyRanking
        operatorId="op-1"
        month="2026-03"
      />
    );
    // Retailer A has 2 days measured
    expect(screen.getByText('2')).toBeDefined();
  });

  it('renders without crashing when loading', () => {
    (mockAccuracyReturn as { isLoading: boolean }).isLoading = true;
    render(
      <CapacityAccuracyRanking
        operatorId="op-1"
        month="2026-03"
      />
    );
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
    (mockAccuracyReturn as { isLoading: boolean }).isLoading = false;
  });
});
