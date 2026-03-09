import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

const mockLateDeliveries = vi.fn();
vi.mock('@/hooks/useDeliveryMetrics', () => ({
  useLateDeliveries: (...args: unknown[]) => mockLateDeliveries(...args),
}));

import LateDeliveriesTable from './LateDeliveriesTable';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const MOCK_DATA = [
  { order_number: 'ORD-001', retailer_name: 'Falabella', delivery_date: '2026-03-05',
    completed_date: '2026-03-08', days_late: 3, driver_name: 'ALEJANDRO' },
  { order_number: 'ORD-002', retailer_name: 'Ripley', delivery_date: '2026-03-07',
    completed_date: '2026-03-08', days_late: 1, driver_name: 'CARLOS' },
];

describe('LateDeliveriesTable', () => {
  it('renders late deliveries with days_late badge', () => {
    mockLateDeliveries.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<LateDeliveriesTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByTestId('late-deliveries-table')).toBeInTheDocument();
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('+3 días')).toBeInTheDocument();
    expect(screen.getByText('+1 día')).toBeInTheDocument();
  });

  it('shows empty state when no late deliveries', () => {
    mockLateDeliveries.mockReturnValue({ data: [], isLoading: false });
    render(<LateDeliveriesTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByText(/Sin entregas tardías/)).toBeInTheDocument();
  });

  it('shows loading skeleton', () => {
    mockLateDeliveries.mockReturnValue({ data: undefined, isLoading: true });
    render(<LateDeliveriesTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByTestId('late-deliveries-skeleton')).toBeInTheDocument();
  });

  it('shows count in header', () => {
    mockLateDeliveries.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<LateDeliveriesTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByText(/Entregas Tardías/)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
