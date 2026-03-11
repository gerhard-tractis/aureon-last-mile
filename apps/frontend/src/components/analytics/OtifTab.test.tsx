import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import OtifTab from './OtifTab';

// Mock child components — we're testing composition, not children
vi.mock('@/components/dashboard/HeroSLA', () => ({ default: () => <div data-testid="hero-sla" /> }));
vi.mock('@/components/dashboard/DateFilterBar', () => ({
  default: (props: any) => <div data-testid="date-filter" />,
  __esModule: true,
}));
vi.mock('@/components/dashboard/OtifByRetailerTable', () => ({ default: () => <div data-testid="otif-retailer" /> }));
vi.mock('@/components/dashboard/LateDeliveriesTable', () => ({ default: () => <div data-testid="late-deliveries" /> }));
vi.mock('@/components/dashboard/FailureReasonsChart', () => ({ default: () => <div data-testid="failure-reasons-chart" /> }));
vi.mock('@/hooks/useDashboardMetrics', () => ({
  useFailureReasons: () => ({ data: [], isLoading: false }),
}));

function renderWithProvider(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('OtifTab', () => {
  it('renders HeroSLA with date filter', () => {
    renderWithProvider(<OtifTab operatorId="op-1" />);
    expect(screen.getByTestId('hero-sla')).toBeInTheDocument();
    expect(screen.getByTestId('date-filter')).toBeInTheDocument();
  });

  it('renders OTIF by retailer and late deliveries tables', () => {
    renderWithProvider(<OtifTab operatorId="op-1" />);
    expect(screen.getByTestId('otif-retailer')).toBeInTheDocument();
    expect(screen.getByTestId('late-deliveries')).toBeInTheDocument();
  });

  it('renders failure reasons chart using shared date filter', () => {
    renderWithProvider(<OtifTab operatorId="op-1" />);
    expect(screen.getByTestId('failure-reasons-chart')).toBeInTheDocument();
  });
});
