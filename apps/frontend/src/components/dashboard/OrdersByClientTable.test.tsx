import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import OrdersByClientTable from './OrdersByClientTable';

vi.mock('@/hooks/useLoadingMetrics', () => ({
  useOrdersByClient: () => ({
    data: [
      { retailer_name: 'Paris', orders: 80, packages: 95, pct: 57.1 },
      { retailer_name: 'Easy', orders: 60, packages: 78, pct: 42.9 },
    ],
    isLoading: false,
  }),
}));

function renderWithProvider(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('OrdersByClientTable', () => {
  it('renders title "Órdenes por Cliente"', () => {
    renderWithProvider(<OrdersByClientTable operatorId="op1" startDate="2026-01-01" endDate="2026-01-31" />);
    expect(screen.getByText('Órdenes por Cliente')).toBeDefined();
  });

  it('renders retailer names (Paris, Easy)', () => {
    renderWithProvider(<OrdersByClientTable operatorId="op1" startDate="2026-01-01" endDate="2026-01-31" />);
    expect(screen.getByText('Paris')).toBeDefined();
    expect(screen.getByText('Easy')).toBeDefined();
  });

  it('renders column headers (Cliente, Órdenes, Bultos, % del Total)', () => {
    renderWithProvider(<OrdersByClientTable operatorId="op1" startDate="2026-01-01" endDate="2026-01-31" />);
    expect(screen.getByText('Cliente')).toBeDefined();
    expect(screen.getByText('Órdenes')).toBeDefined();
    expect(screen.getByText('Bultos')).toBeDefined();
    expect(screen.getByText('% del Total')).toBeDefined();
  });
});
