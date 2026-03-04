import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CommittedOrdersChart from './CommittedOrdersChart';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="chart-container">{children}</div>,
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div data-testid="line" />,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));

vi.mock('@/hooks/useLoadingMetrics', () => ({
  useCommittedOrdersDaily: () => ({
    data: [
      { day: '2026-03-01', count: 45 },
      { day: '2026-03-02', count: 52 },
    ],
    isLoading: false,
  }),
}));

describe('CommittedOrdersChart', () => {
  it('renders title "Órdenes Comprometidas por Día"', () => {
    render(<CommittedOrdersChart operatorId="op1" startDate="2026-03-01" endDate="2026-03-07" />);
    expect(screen.getByText('Órdenes Comprometidas por Día')).toBeInTheDocument();
  });

  it('renders line-chart testid', () => {
    render(<CommittedOrdersChart operatorId="op1" startDate="2026-03-01" endDate="2026-03-07" />);
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });
});
