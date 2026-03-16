import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import SecondaryMetricsGrid, {
  getCapacityColor,
  getOrdersPerHourColor,
  formatTrend,
} from './SecondaryMetricsGrid';

const mockCurrentQuery = {
  data: null as {
    capacityPct: number | null;
    capacityTarget: number;
    ordersPerHour: number | null;
    totalOrders: number;
    totalDelivered: number;
  } | null,
  isLoading: false,
  isError: false,
};
const mockPrevQuery = {
  data: null as typeof mockCurrentQuery.data,
  isLoading: false,
  isError: false,
};

vi.mock('@/hooks/useDashboardMetrics', () => ({
  useSecondaryMetrics: () => mockCurrentQuery,
  useSecondaryMetricsPreviousPeriod: () => mockPrevQuery,
}));

vi.mock('@/hooks/useDashboardDates', () => ({
  getDashboardDates: () => ({
    startDate: '2026-02-24',
    endDate: '2026-03-02',
    prevStartDate: '2026-02-17',
    prevEndDate: '2026-02-23',
  }),
}));

function renderWithProvider(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

beforeEach(() => {
  mockCurrentQuery.data = null;
  mockCurrentQuery.isLoading = false;
  mockCurrentQuery.isError = false;
  mockPrevQuery.data = null;
  mockPrevQuery.isLoading = false;
  mockPrevQuery.isError = false;
});

describe('SecondaryMetricsGrid', () => {
  it('renders section title', () => {
    renderWithProvider(<SecondaryMetricsGrid operatorId="op-1" />);
    expect(screen.getByText('MÉTRICAS SECUNDARIAS')).toBeInTheDocument();
  });

  it('shows skeleton loaders when loading', () => {
    mockCurrentQuery.isLoading = true;
    const { container } = renderWithProvider(<SecondaryMetricsGrid operatorId="op-1" />);
    // Skeletons render instead of cards
    expect(screen.getByText('MÉTRICAS SECUNDARIAS')).toBeInTheDocument();
    expect(container.querySelectorAll('.grid > div').length).toBe(2);
  });

  it('shows N/A when no data', () => {
    mockCurrentQuery.data = {
      capacityPct: null,
      capacityTarget: 1000,
      ordersPerHour: null,
      totalOrders: 0,
      totalDelivered: 0,
    };
    renderWithProvider(<SecondaryMetricsGrid operatorId="op-1" />);
    const naElements = screen.getAllByText('N/A');
    expect(naElements.length).toBe(2);
  });

  it('renders capacity and orders/hour values', () => {
    mockCurrentQuery.data = {
      capacityPct: 75.5,
      capacityTarget: 1000,
      ordersPerHour: 38.2,
      totalOrders: 2674,
      totalDelivered: 2500,
    };
    renderWithProvider(<SecondaryMetricsGrid operatorId="op-1" />);
    expect(screen.getByText('75.5%')).toBeInTheDocument();
    expect(screen.getByText('38.2')).toBeInTheDocument();
    expect(screen.getByText('Capacidad Utilizada')).toBeInTheDocument();
    expect(screen.getByText('Pedidos por Hora')).toBeInTheDocument();
  });

  it('shows trend indicators when previous data available', () => {
    mockCurrentQuery.data = {
      capacityPct: 80,
      capacityTarget: 1000,
      ordersPerHour: 40,
      totalOrders: 2800,
      totalDelivered: 2600,
    };
    mockPrevQuery.data = {
      capacityPct: 70,
      capacityTarget: 1000,
      ordersPerHour: 35,
      totalOrders: 2450,
      totalDelivered: 2300,
    };
    renderWithProvider(<SecondaryMetricsGrid operatorId="op-1" />);
    const trends = screen.getAllByText('↑ +14.3% vs semana anterior');
    expect(trends.length).toBe(2);
  });

  it('shows stale indicator on error', () => {
    mockCurrentQuery.data = {
      capacityPct: 80,
      capacityTarget: 1000,
      ordersPerHour: 40,
      totalOrders: 2800,
      totalDelivered: 2600,
    };
    mockCurrentQuery.isError = true;
    renderWithProvider(<SecondaryMetricsGrid operatorId="op-1" />);
    const staleIcons = screen.getAllByTitle('Los datos pueden estar desactualizados');
    expect(staleIcons.length).toBe(2);
  });

  it('has aria-labels on both cards', () => {
    mockCurrentQuery.data = {
      capacityPct: 89.2,
      capacityTarget: 1000,
      ordersPerHour: 38.2,
      totalOrders: 2674,
      totalDelivered: 2500,
    };
    renderWithProvider(<SecondaryMetricsGrid operatorId="op-1" />);
    expect(screen.getByLabelText('Capacidad Utilizada: 89.2%')).toBeInTheDocument();
    expect(screen.getByLabelText('Pedidos por Hora: 38.2')).toBeInTheDocument();
  });

  it('renders 2-column grid', () => {
    mockCurrentQuery.data = {
      capacityPct: 80,
      capacityTarget: 1000,
      ordersPerHour: 40,
      totalOrders: 2800,
      totalDelivered: 2600,
    };
    const { container } = renderWithProvider(<SecondaryMetricsGrid operatorId="op-1" />);
    const grid = container.querySelector('.grid.grid-cols-1.sm\\:grid-cols-2.gap-6');
    expect(grid).toBeInTheDocument();
  });
});

describe('getCapacityColor', () => {
  it('returns muted-foreground for null', () => {
    expect(getCapacityColor(null)).toBe('text-muted-foreground');
  });

  it('returns red for >95% (over-utilized)', () => {
    expect(getCapacityColor(96)).toBe('text-[#ef4444]');
    expect(getCapacityColor(100)).toBe('text-[#ef4444]');
  });

  it('returns red for <60% (under-utilized)', () => {
    expect(getCapacityColor(59)).toBe('text-[#ef4444]');
    expect(getCapacityColor(30)).toBe('text-[#ef4444]');
  });

  it('returns yellow for >85% to 95%', () => {
    expect(getCapacityColor(86)).toBe('text-[#f59e0b]');
    expect(getCapacityColor(95)).toBe('text-[#f59e0b]');
  });

  it('returns green for 60-85% (healthy)', () => {
    expect(getCapacityColor(60)).toBe('text-[#10b981]');
    expect(getCapacityColor(75)).toBe('text-[#10b981]');
    expect(getCapacityColor(85)).toBe('text-[#10b981]');
  });
});

describe('getOrdersPerHourColor', () => {
  it('returns muted-foreground for null', () => {
    expect(getOrdersPerHourColor(null)).toBe('text-muted-foreground');
  });

  it('returns green for >=40', () => {
    expect(getOrdersPerHourColor(40)).toBe('text-[#10b981]');
    expect(getOrdersPerHourColor(50)).toBe('text-[#10b981]');
  });

  it('returns yellow for 30-39.9', () => {
    expect(getOrdersPerHourColor(30)).toBe('text-[#f59e0b]');
    expect(getOrdersPerHourColor(39.9)).toBe('text-[#f59e0b]');
  });

  it('returns red for <30', () => {
    expect(getOrdersPerHourColor(29.9)).toBe('text-[#ef4444]');
    expect(getOrdersPerHourColor(0)).toBe('text-[#ef4444]');
  });
});

describe('formatTrend', () => {
  it('returns null when current is null', () => {
    expect(formatTrend(null, 50)).toBeNull();
  });

  it('returns null when previous is null', () => {
    expect(formatTrend(50, null)).toBeNull();
  });

  it('returns null when previous is 0', () => {
    expect(formatTrend(50, 0)).toBeNull();
  });

  it('returns positive trend', () => {
    const result = formatTrend(80, 70);
    expect(result).toEqual({ text: '↑ +14.3% vs semana anterior', up: true });
  });

  it('returns negative trend', () => {
    const result = formatTrend(70, 80);
    expect(result).toEqual({ text: '↓ -12.5% vs semana anterior', up: false });
  });

  it('returns zero change as positive', () => {
    const result = formatTrend(50, 50);
    expect(result).toEqual({ text: '↑ +0% vs semana anterior', up: true });
  });
});
