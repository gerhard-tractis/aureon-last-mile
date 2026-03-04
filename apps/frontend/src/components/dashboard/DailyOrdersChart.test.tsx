import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DailyOrdersChart from './DailyOrdersChart';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="chart-container">{children}</div>,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  CartesianGrid: () => null,
}));

vi.mock('@/hooks/useLoadingMetrics', () => ({
  useDailyOrdersByClient: () => ({
    data: [
      { day: '2026-03-01', retailer_name: 'Paris', count: 30 },
      { day: '2026-03-01', retailer_name: 'Easy', count: 20 },
    ],
    isLoading: false,
  }),
}));

describe('DailyOrdersChart', () => {
  it('renders title', () => {
    render(<DailyOrdersChart operatorId="op1" startDate="2026-03-01" endDate="2026-03-07" />);
    expect(screen.getByText('Evolución Diaria de Órdenes Cargadas')).toBeInTheDocument();
  });

  it('renders bar-chart', () => {
    render(<DailyOrdersChart operatorId="op1" startDate="2026-03-01" endDate="2026-03-07" />);
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });
});
