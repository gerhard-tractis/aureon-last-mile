import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrderFichaContent } from './_ficha-content';
import type { OrderDossierData } from '@/hooks/useOrderDossier';

let currentSearch = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const mockUseOperatorId = vi.fn();
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => mockUseOperatorId(),
}));

const mockUseOrderDossier = vi.fn();
vi.mock('@/hooks/useOrderDossier', () => ({
  useOrderDossier: (...args: unknown[]) => mockUseOrderDossier(...args),
}));

vi.mock('@/components/orders/OrderLifecycleTimeline', () => ({
  OrderLifecycleTimeline: ({ auditLogs }: { auditLogs: unknown[] }) => (
    <div data-testid="lifecycle-timeline">{auditLogs.length}</div>
  ),
}));
vi.mock('@/components/orders/ProofOfDelivery', () => ({
  ProofOfDelivery: ({ dispatch }: { dispatch: { id: string } | null }) => (
    <div data-testid="proof-of-delivery">{dispatch ? dispatch.id : 'none'}</div>
  ),
}));
vi.mock('@/components/orders/WhyLateBlock', () => ({
  WhyLateBlock: () => null,
}));

const BASE_DATA: OrderDossierData = {
  id: 'o-1',
  order_number: 'ORD-48213',
  retailer_name: 'Falabella',
  customer_name: 'Camila Fernández Soto',
  customer_phone: '+56984127734',
  delivery_address: 'Av. Vicuña Mackenna 8420',
  comuna: 'La Florida',
  delivery_date: '2026-08-13',
  delivery_window_start: '09:00:00',
  delivery_window_end: '14:00:00',
  status: 'en_ruta',
  leading_status: 'en_ruta',
  packages: [
    { id: 'p-1', label: 'CL1', package_number: 'CL1', status: 'en_ruta', status_updated_at: null, dock_zone_name: null, declared_weight_kg: null, verified_weight_kg: null },
  ],
  auditLogs: [
    { id: 'a-1', action: 'STATUS_CHANGED', timestamp: '2026-08-13T12:41:00', changes_json: null },
  ],
  manifestId: null,
  dispatches: [
    {
      id: 'd-1',
      substatus: 'En reparto',
      substatus_code: null,
      status: 'en_ruta',
      completed_at: '2026-08-13T12:41:08',
      arrived_at: null,
      estimated_at: null,
      failure_reason: null,
      latitude: null,
      longitude: null,
      raw_data: {},
      is_pickup: false,
      external_route_id: 'R-2481',
      driver_name: 'M. Rojas',
      route_id: 'route-1',
      external_dispatch_id: 'DT-9910442',
    },
  ],
  imported_via: 'API',
  rescheduled_delivery_date: null,
  rescheduled_window_start: null,
  rescheduled_window_end: null,
  delivered_at: null,
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('OrderFichaContent', () => {
  beforeEach(() => {
    currentSearch = '';
    mockUseOperatorId.mockReturnValue({ operatorId: 'op-1' });
    mockUseOrderDossier.mockReturnValue({ data: BASE_DATA, isLoading: false, isError: false });
  });

  it('shows a loading state while the dossier query is in flight', () => {
    mockUseOrderDossier.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    wrap(<OrderFichaContent orderId="o-1" />);
    expect(screen.queryByText('ORD-48213')).toBeNull();
  });

  it('shows an error state when the dossier query fails', () => {
    mockUseOrderDossier.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    wrap(<OrderFichaContent orderId="o-1" />);
    expect(screen.getByText(/Error al cargar/i)).toBeInTheDocument();
  });

  it('renders the header, lifecycle rail and all three columns', () => {
    wrap(<OrderFichaContent orderId="o-1" />);
    expect(screen.getByText('ORD-48213')).toBeInTheDocument();
    expect(screen.getByTestId('lifecycle-timeline')).toHaveTextContent('1');
    expect(screen.getByTestId('order-package-list')).toBeInTheDocument();
    expect(screen.getByText('Bitácora unificada')).toBeInTheDocument();
    expect(screen.getByTestId('proof-of-delivery')).toHaveTextContent('d-1');
  });

  it('carries the incoming query string into the breadcrumb link', () => {
    currentSearch = 'vista=sla-en-riesgo&pagina=2';
    wrap(<OrderFichaContent orderId="o-1" />);
    expect(screen.getByRole('link', { name: /Pedidos/i })).toHaveAttribute(
      'href',
      '/app/orders?vista=sla-en-riesgo&pagina=2',
    );
  });

  it('links back to plain /app/orders when there is no incoming query string', () => {
    wrap(<OrderFichaContent orderId="o-1" />);
    expect(screen.getByRole('link', { name: /Pedidos/i })).toHaveAttribute('href', '/app/orders');
  });

  it('does not render the PDF download button — no PDF generator exists', () => {
    wrap(<OrderFichaContent orderId="o-1" />);
    expect(screen.queryByText(/Descargar POD/i)).toBeNull();
  });

  it('queries the dossier with the given order id and operator id', () => {
    wrap(<OrderFichaContent orderId="o-1" />);
    expect(mockUseOrderDossier).toHaveBeenCalledWith('o-1', 'op-1');
  });
});
