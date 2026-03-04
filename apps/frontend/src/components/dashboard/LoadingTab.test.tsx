import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

// Mock all sub-components
vi.mock('./DateFilterBar', () => ({ default: () => <div data-testid="date-filter" /> }));
vi.mock('./LoadingKPIStrip', () => ({ default: () => <div data-testid="kpi-strip" /> }));
vi.mock('./DailyOrdersChart', () => ({ default: () => <div data-testid="daily-chart" /> }));
vi.mock('./CommittedOrdersChart', () => ({ default: () => <div data-testid="committed-chart" /> }));
vi.mock('./OrdersByClientTable', () => ({ default: () => <div data-testid="client-table" /> }));
vi.mock('./OrdersByComunaTable', () => ({ default: () => <div data-testid="comuna-table" /> }));
vi.mock('@/hooks/useDatePreset', () => ({
  useDatePreset: () => ({ startDate: '2026-03-01', endDate: '2026-03-15', prevStartDate: '2026-02-14', prevEndDate: '2026-02-28' }),
}));

import LoadingTab from './LoadingTab';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('LoadingTab', () => {
  it('renders all sections', () => {
    render(<LoadingTab operatorId="test-op" />, { wrapper });
    expect(screen.getByTestId('date-filter')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-strip')).toBeInTheDocument();
    expect(screen.getByTestId('daily-chart')).toBeInTheDocument();
    expect(screen.getByTestId('committed-chart')).toBeInTheDocument();
    expect(screen.getByTestId('client-table')).toBeInTheDocument();
    expect(screen.getByTestId('comuna-table')).toBeInTheDocument();
  });

  it('has loading-tab testid for page integration', () => {
    render(<LoadingTab operatorId="test-op" />, { wrapper });
    expect(screen.getByTestId('loading-tab')).toBeInTheDocument();
  });
});
