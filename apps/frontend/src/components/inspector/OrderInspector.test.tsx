import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { OrderInspector } from './OrderInspector';

const MOCK_DATA = {
  id: 'o-1',
  order_number: 'ORD-001',
  retailer_name: 'Falabella',
  customer_name: 'María González',
  customer_phone: '+56912345678',
  delivery_address: 'Av. Las Condes 1234',
  comuna: 'Las Condes',
  delivery_date: '2026-05-10',
  delivery_window_start: null,
  delivery_window_end: null,
  status: 'en_ruta',
  leading_status: 'en_ruta',
  packages: [
    { id: 'p-1', label: 'PKG-001', package_number: null, status: 'en_ruta', status_updated_at: null },
  ],
  auditLogs: [
    { id: 'a-1', action: 'STATUS_CHANGED', timestamp: '2026-05-05T09:00:00', changes_json: null },
  ],
};

vi.mock('@/hooks/useOrderDetail', () => ({
  useOrderDetail: (id: string | null) => ({
    data: id ? MOCK_DATA : null,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/components/operations-control/PackageStatusBreakdown', () => ({
  PackageStatusBreakdown: ({ packages }: { packages: { label: string }[] }) => (
    <div data-testid="package-breakdown">
      {packages.map((p) => <span key={p.label}>{p.label}</span>)}
    </div>
  ),
}));

vi.mock('@/components/operations-control/StatusTimeline', () => ({
  StatusTimeline: () => <div data-testid="status-timeline">Timeline</div>,
}));

vi.mock('@/components/inspector/OrderLifecycleRibbon', () => ({
  OrderLifecycleRibbon: ({ leadingStatus }: { leadingStatus: string }) => (
    <div data-testid="lifecycle-ribbon">{leadingStatus}</div>
  ),
}));

vi.mock('@/components/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span data-testid="status-badge">{status}</span>,
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

describe('OrderInspector', () => {
  it('renders order number when open', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText('ORD-001')).toBeTruthy();
  });

  it('renders customer name', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText(/María González/)).toBeTruthy();
  });

  it('renders retailer chip', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText('Falabella')).toBeTruthy();
  });

  it('renders package label in packages tab area', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText('PKG-001')).toBeTruthy();
  });

  it('does not render when orderId is null', () => {
    wrap(<OrderInspector orderId={null} onClose={vi.fn()} />);
    expect(screen.queryByText('ORD-001')).toBeNull();
  });

  it('renders delivery address', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText(/Av\. Las Condes 1234/)).toBeTruthy();
  });
});
