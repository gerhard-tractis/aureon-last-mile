import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FichaHeader } from './FichaHeader';
import type { OrderDossierData, DossierDispatch } from '@/hooks/useOrderDossier';
import { dossierDispatchFixture } from '@/test/fixtures/dossierDispatch';

function dispatch(overrides: Partial<DossierDispatch> = {}): DossierDispatch {
  return dossierDispatchFixture({
    external_route_id: 'R-2481',
    driver_name: 'M. Rojas',
    route_id: 'route-1',
    external_dispatch_id: 'DT-9910442',
    ...overrides,
  });
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
  imported_via: 'API',
  rescheduled_delivery_date: null,
  rescheduled_window_start: null,
  rescheduled_window_end: null,
  delivered_at: null,
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

  it('renders the courier guide number chip from the delivery dispatch\'s external_dispatch_id', () => {
    renderHeader();
    expect(screen.getByText(/DT-9910442/)).toBeInTheDocument();
  });

  it('omits the guide number chip when the delivery dispatch has no external_dispatch_id', () => {
    renderHeader({ deliveryDispatch: dispatch({ external_dispatch_id: null }) });
    expect(screen.queryByText(/DT-9910442/)).toBeNull();
  });

  it('omits the guide number chip when there is no delivery dispatch at all', () => {
    renderHeader({ deliveryDispatch: null });
    expect(screen.queryByText(/guía courier/i)).toBeNull();
  });

  describe('SLA delta badge', () => {
    it('shows an "ATRASADO" delta when the delivery window has already passed', () => {
      renderHeader({ now: new Date('2026-08-13T15:40:00') });
      expect(screen.getByTestId('sla-delta-badge')).toHaveTextContent('ATRASADO 1h 40m');
    });

    it('shows a "restantes" delta when still within the at-risk window', () => {
      renderHeader({ now: new Date('2026-08-13T10:00:00') });
      expect(screen.getByTestId('sla-delta-badge')).toHaveTextContent('4h 0m restantes');
    });

    it('omits the badge entirely when the order has no delivery window', () => {
      renderHeader({
        order: { ...BASE_ORDER, delivery_window_start: null, delivery_window_end: null },
        now: new Date('2026-08-13T15:40:00'),
      });
      expect(screen.queryByTestId('sla-delta-badge')).toBeNull();
    });

    it('omits the badge when the order is already delivered — classifyRisk returns "none"', () => {
      renderHeader({
        order: { ...BASE_ORDER, delivered_at: '2026-08-13T13:00:00' },
        now: new Date('2026-08-13T15:40:00'),
      });
      expect(screen.queryByTestId('sla-delta-badge')).toBeNull();
    });

    it('uses the rescheduled window instead of the original one when all three reschedule columns are set', () => {
      renderHeader({
        order: {
          ...BASE_ORDER,
          rescheduled_delivery_date: '2026-08-14',
          rescheduled_window_start: '09:00:00',
          rescheduled_window_end: '10:00:00',
        },
        // Past the ORIGINAL window (13/08 14:00) but well before the
        // rescheduled one (14/08 09:00–10:00) — if this showed "ATRASADO"
        // the reschedule columns were ignored.
        now: new Date('2026-08-13T20:00:00'),
      });
      expect(screen.getByTestId('sla-delta-badge')).not.toHaveTextContent('ATRASADO');
    });
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
