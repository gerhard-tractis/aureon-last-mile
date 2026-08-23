import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FichaHeader } from './FichaHeader';
import type { OrderDossierData, DossierDispatch } from '@/hooks/useOrderDossier';

function dispatch(overrides: Partial<DossierDispatch> = {}): DossierDispatch {
  return {
    id: 'd-1',
    substatus: null,
    substatus_code: null,
    status: 'en_ruta',
    completed_at: null,
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
    ...overrides,
  };
}

const BASE_ORDER: OrderDossierData = {
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
    { id: 'p-2', label: 'CL2', package_number: 'CL2', status: 'en_ruta', status_updated_at: null, dock_zone_name: null, declared_weight_kg: null, verified_weight_kg: null },
  ],
  auditLogs: [],
  manifestId: null,
  dispatches: [],
};

function renderHeader(overrides: Partial<Parameters<typeof FichaHeader>[0]> = {}) {
  return render(
    <FichaHeader
      order={BASE_ORDER}
      lastUpdated={'2026-08-13T12:41:00'}
      deliveryDispatch={dispatch()}
      breadcrumbHref="/app/orders"
      {...overrides}
    />,
  );
}

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe('FichaHeader', () => {
  it('renders the order number and leading status badge', () => {
    renderHeader();
    expect(screen.getByText('ORD-48213')).toBeInTheDocument();
    expect(screen.getByText('En reparto')).toBeInTheDocument();
  });

  it('renders the customer name and retailer chip', () => {
    renderHeader();
    expect(screen.getByText(/Camila Fernández Soto/)).toBeInTheDocument();
    expect(screen.getByText('Falabella')).toBeInTheDocument();
  });

  it('renders the package count chip from real data, not a placeholder', () => {
    renderHeader();
    expect(screen.getByText(/paquetes/)).toHaveTextContent('2 paquetes');
  });

  it('renders promise date and delivery window', () => {
    renderHeader();
    expect(screen.getByText(/2026-08-13/)).toBeInTheDocument();
    expect(screen.getByText(/09:00.*14:00/)).toBeInTheDocument();
  });

  it('renders route and driver from the delivery dispatch', () => {
    renderHeader();
    expect(screen.getByText(/R-2481/)).toBeInTheDocument();
    expect(screen.getByText(/M\. Rojas/)).toBeInTheDocument();
  });

  it('omits the route chip when there is no delivery dispatch', () => {
    renderHeader({ deliveryDispatch: null });
    expect(screen.queryByText(/R-2481/)).toBeNull();
  });

  it('shows the last-updated time when provided', () => {
    renderHeader();
    expect(screen.getByText(/actualizado/i)).toHaveTextContent('12:41');
  });

  it('omits the last-updated chip when null', () => {
    renderHeader({ lastUpdated: null });
    expect(screen.queryByText(/actualizado/i)).toBeNull();
  });

  it('does not render a courier guide number chip — not in the dossier query', () => {
    renderHeader();
    expect(screen.queryByText(/guía courier/i)).toBeNull();
  });

  it('does not render an SLA delta badge', () => {
    renderHeader();
    expect(screen.queryByText(/SLA/)).toBeNull();
  });

  it('does not render a customer RUT anywhere', () => {
    renderHeader();
    expect(screen.queryByText(/\d{1,2}\.\d{3}\.\d{3}-[\dkK]/)).toBeNull();
  });

  it('does not render unbacked header actions (Notificar cliente, Enviar a reingreso, Reintentar entrega)', () => {
    renderHeader();
    expect(screen.queryByText(/Notificar cliente/)).toBeNull();
    expect(screen.queryByText(/Enviar a reingreso/)).toBeNull();
    expect(screen.queryByText(/Reintentar entrega/)).toBeNull();
  });

  it('does not render a paginator ("N de M")', () => {
    renderHeader();
    expect(screen.queryByText(/\d+ de \d+/)).toBeNull();
  });

  it('links "Pedidos" back to the incoming breadcrumb href', () => {
    renderHeader({ breadcrumbHref: '/app/orders?vista=sla-en-riesgo&pagina=2' });
    expect(screen.getByRole('link', { name: /Pedidos/i })).toHaveAttribute(
      'href',
      '/app/orders?vista=sla-en-riesgo&pagina=2',
    );
  });

  it('links "Auditoría" to the audit logs page', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: /Auditoría/i })).toHaveAttribute('href', '/app/audit-logs');
  });

  it('copies the current URL when "Copiar enlace" is clicked', async () => {
    renderHeader();
    screen.getByRole('button', { name: /Copiar enlace/i }).click();
    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(window.location.href);
  });
});
