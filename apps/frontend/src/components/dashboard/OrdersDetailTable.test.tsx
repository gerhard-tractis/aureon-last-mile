import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

const mockOrdersDetail = vi.fn();
vi.mock('@/hooks/useDeliveryMetrics', () => ({
  useOrdersDetail: (...args: unknown[]) => mockOrdersDetail(...args),
}));

import OrdersDetailTable from './OrdersDetailTable';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const MOCK_ROWS = [
  { id: 'u1', order_number: 'ORD-001', retailer_name: 'Falabella', comuna: 'Santiago',
    delivery_date: '2026-03-05', status: 'entregado', completed_at: '2026-03-05 14:30',
    driver_name: 'ALEJANDRO', route_id: 'R-123', failure_reason: null, days_delta: 0 },
  { id: 'u2', order_number: 'ORD-002', retailer_name: 'Ripley', comuna: 'Providencia',
    delivery_date: '2026-03-06', status: 'cancelado', completed_at: '2026-03-06 16:00',
    driver_name: 'CARLOS', route_id: 'R-124', failure_reason: 'Cliente ausente', days_delta: null },
  { id: 'u3', order_number: 'ORD-003', retailer_name: 'Paris', comuna: 'Las Condes',
    delivery_date: '2026-03-04', status: 'ingresado', completed_at: null,
    driver_name: null, route_id: null, failure_reason: null, days_delta: null },
];

const MOCK_DATA = { rows: MOCK_ROWS, total_count: 53 };

describe('OrdersDetailTable', () => {
  beforeEach(() => { mockOrdersDetail.mockReset(); });

  it('renders table with order rows', () => {
    mockOrdersDetail.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OrdersDetailTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByTestId('orders-detail-table')).toBeInTheDocument();
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('ORD-002')).toBeInTheDocument();
    expect(screen.getByText('ORD-003')).toBeInTheDocument();
  });

  it('shows status badges with correct colors', () => {
    mockOrdersDetail.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OrdersDetailTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    const deliveredBadge = screen.getAllByText('Entregado').find(el => el.tagName === 'SPAN')!;
    expect(deliveredBadge.className).toContain('emerald');
    const canceladoBadge = screen.getAllByText('Cancelado').find(el => el.tagName === 'SPAN')!;
    expect(canceladoBadge.className).toContain('red');
  });

  it('expands row on click to show details', async () => {
    const user = userEvent.setup();
    mockOrdersDetail.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OrdersDetailTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    // Click on the failed order row
    await user.click(screen.getByText('ORD-002'));
    expect(screen.getByText('Cliente ausente')).toBeInTheDocument();
    expect(screen.getByText('CARLOS')).toBeInTheDocument();
  });

  it('shows pagination with page info', () => {
    mockOrdersDetail.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OrdersDetailTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    // The range text should show "1–25 de 53" (using en-dash)
    // Use a flexible matcher since the exact dash character may vary
    const pagination = screen.getByText((content) => content.includes('de 53'));
    expect(pagination).toBeInTheDocument();
  });

  it('shows loading skeleton', () => {
    mockOrdersDetail.mockReturnValue({ data: undefined, isLoading: true });
    render(<OrdersDetailTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByTestId('orders-detail-skeleton')).toBeInTheDocument();
  });

  it('accepts initialStatus filter prop', () => {
    mockOrdersDetail.mockReturnValue({ data: { rows: [], total_count: 0 }, isLoading: false });
    render(<OrdersDetailTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" initialStatus="cancelado" />, { wrapper });

    const select = screen.getByTestId('status-filter') as HTMLSelectElement;
    expect(select.value).toBe('cancelado');
  });

  it('accepts initialOverdueOnly filter prop', () => {
    mockOrdersDetail.mockReturnValue({ data: { rows: [], total_count: 0 }, isLoading: false });
    render(<OrdersDetailTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" initialOverdueOnly={true} />, { wrapper });

    const checkbox = screen.getByTestId('overdue-filter') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });
});
