import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

const mockOtifByRetailer = vi.fn();
vi.mock('@/hooks/useDeliveryMetrics', () => ({
  useOtifByRetailer: (...args: unknown[]) => mockOtifByRetailer(...args),
}));

import OtifByRetailerTable from './OtifByRetailerTable';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const MOCK_DATA = [
  { retailer_name: 'Falabella', total_orders: 50, delivered: 45, on_time: 40, otif_pct: 88.9 },
  { retailer_name: 'Ripley', total_orders: 30, delivered: 28, on_time: 28, otif_pct: 100.0 },
  { retailer_name: 'Paris', total_orders: 20, delivered: 18, on_time: 10, otif_pct: 55.6 },
];

describe('OtifByRetailerTable', () => {
  it('renders table with retailer rows', () => {
    mockOtifByRetailer.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OtifByRetailerTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByTestId('otif-retailer-table')).toBeInTheDocument();
    expect(screen.getByText('Falabella')).toBeInTheDocument();
    expect(screen.getByText('Ripley')).toBeInTheDocument();
    expect(screen.getByText('Paris')).toBeInTheDocument();
  });

  it('applies green color to OTIF >= 95%', () => {
    mockOtifByRetailer.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OtifByRetailerTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    // Ripley has 100% OTIF
    const ripleyRow = screen.getByText('100.0').closest('td');
    expect(ripleyRow?.className).toContain('text-status-success');
  });

  it('applies red color to OTIF < 85%', () => {
    mockOtifByRetailer.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OtifByRetailerTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    // Paris has 55.6% OTIF
    const parisRow = screen.getByText('55.6').closest('td');
    expect(parisRow?.className).toContain('text-status-error');
  });

  it('shows loading skeleton', () => {
    mockOtifByRetailer.mockReturnValue({ data: undefined, isLoading: true });
    render(<OtifByRetailerTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByTestId('otif-retailer-skeleton')).toBeInTheDocument();
  });

  it('sorts by column when header clicked', async () => {
    const user = userEvent.setup();
    mockOtifByRetailer.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OtifByRetailerTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    const totalHeader = screen.getByText('Total');
    await user.click(totalHeader);
    // After clicking Total, should sort by total_orders
    const cells = screen.getAllByTestId('retailer-total');
    expect(cells[0]).toHaveTextContent('50'); // Falabella first (desc)
  });
});
