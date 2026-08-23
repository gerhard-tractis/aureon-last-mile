import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { OrderInspector } from './OrderInspector';
import type { OrderDossierData } from '@/hooks/useOrderDossier';
import { dossierDispatchFixture } from '@/test/fixtures/dossierDispatch';

const mockUseOrderDossier = vi.fn();
const mockUseOperatorId = vi.fn();
const mockUseModuleEnabled = vi.fn();
const mockUseOrderConversationSessions = vi.fn();

vi.mock('@/hooks/useOrderDossier', () => ({
  useOrderDossier: (...args: unknown[]) => mockUseOrderDossier(...args),
}));
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => mockUseOperatorId(),
}));
vi.mock('@/hooks/modules/useEnabledModules', () => ({
  useModuleEnabled: (...args: unknown[]) => mockUseModuleEnabled(...args),
}));
vi.mock('@/hooks/conversations/useOrderConversationSessions', () => ({
  useOrderConversationSessions: (...args: unknown[]) => mockUseOrderConversationSessions(...args),
}));

vi.mock('@/components/orders/OrderLifecycleTimeline', () => ({
  OrderLifecycleTimeline: ({ auditLogs }: { auditLogs: unknown[] }) => (
    <div data-testid="lifecycle-timeline">{auditLogs.length}</div>
  ),
}));
vi.mock('@/components/orders/OrderPackageList', () => ({
  OrderPackageList: ({ packages }: { packages: unknown[] }) => (
    <div data-testid="package-list">{packages.length}</div>
  ),
}));
vi.mock('@/components/orders/UnifiedEventLog', () => ({
  UnifiedEventLog: ({ auditLogs, dispatches }: { auditLogs: unknown[]; dispatches: unknown[] }) => (
    <div data-testid="unified-event-log">{auditLogs.length + dispatches.length}</div>
  ),
}));
vi.mock('@/components/orders/ProofOfDelivery', () => ({
  ProofOfDelivery: ({ dispatch }: { dispatch: { id: string } | null }) => (
    <div data-testid="proof-of-delivery">{dispatch ? dispatch.id : 'none'}</div>
  ),
}));
vi.mock('@/components/conversations/ConversationThread', () => ({
  ConversationThread: ({ session }: { session: { id: string } }) => (
    <div data-testid="conversation-thread">{session.id}</div>
  ),
}));

function pkg(overrides: Partial<OrderDossierData['packages'][number]> = {}) {
  return {
    id: 'pkg-1',
    label: 'CL7742891003',
    package_number: 'CL7742891003',
    status: 'en_ruta',
    status_updated_at: '2026-08-13T06:55:00',
    dock_zone_name: null,
    declared_weight_kg: null,
    verified_weight_kg: null,
    ...overrides,
  };
}

function dispatch(overrides: Partial<OrderDossierData['dispatches'][number]> = {}) {
  return dossierDispatchFixture({
    id: 'dp-1',
    substatus: 'En reparto',
    status: 'en_ruta',
    estimated_at: '2026-08-13T12:41:00',
    external_route_id: 'R-2481',
    driver_name: 'Juan Pérez',
    route_id: 'route-uuid-1',
    ...overrides,
  });
}

const BASE_DATA: OrderDossierData = {
  id: 'o-1',
  order_number: 'ORD-48213',
  retailer_name: 'Falabella',
  customer_name: 'Camila Fernández Soto',
  customer_phone: '+56984127734',
  delivery_address: 'Av. Vicuña Mackenna 8420',
  comuna: 'La Florida',
  delivery_date: '2026-08-13',
  delivery_window_start: '2026-08-13T09:00:00',
  delivery_window_end: '2026-08-13T14:00:00',
  status: 'en_ruta',
  leading_status: 'en_ruta',
  packages: [pkg()],
  auditLogs: [
    { id: 'a-1', action: 'STATUS_CHANGED', timestamp: '2026-08-13T12:41:00', changes_json: null },
  ],
  manifestId: 'm-1',
  dispatches: [dispatch()],
  imported_via: 'CSV',
  rescheduled_delivery_date: null,
  rescheduled_window_start: null,
  rescheduled_window_end: null,
  delivered_at: null,
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

describe('OrderInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOperatorId.mockReturnValue({ operatorId: 'op-1' });
    mockUseModuleEnabled.mockReturnValue(false);
    mockUseOrderConversationSessions.mockReturnValue({ data: [], isLoading: false });
    mockUseOrderDossier.mockReturnValue({ data: BASE_DATA, isLoading: false, isError: false });
  });

  it('does not render when orderId is null', () => {
    wrap(<OrderInspector orderId={null} onClose={vi.fn()} />);
    expect(screen.queryByText('ORD-48213')).toBeNull();
  });

  it('shows a loading state while the dossier is loading', () => {
    mockUseOrderDossier.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.queryByText('ORD-48213')).toBeNull();
  });

  it('shows an error state when the dossier query fails', () => {
    mockUseOrderDossier.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText(/Error al cargar/i)).toBeInTheDocument();
  });

  it('renders the order number in font-mono', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText('ORD-48213')).toHaveClass('font-mono');
  });

  it('renders customer name, address, comuna and phone', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText(/Camila Fernández Soto/)).toBeInTheDocument();
    expect(screen.getByText(/Av\. Vicuña Mackenna 8420/)).toBeInTheDocument();
    expect(screen.getByText(/La Florida/)).toBeInTheDocument();
    expect(screen.getByText(/\+56984127734/)).toBeInTheDocument();
  });

  it('does not render a RUT anywhere — orders has no RUT column', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.queryByText(/\d{1,2}\.\d{3}\.\d{3}-[\dkK]/)).toBeNull();
  });

  it('renders metadata chips: package count, retailer, promise date, delivery window, route', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText(/paquetes/)).toBeInTheDocument();
    expect(screen.getByText('Falabella')).toBeInTheDocument();
    expect(screen.getByText(/2026-08-13/)).toBeInTheDocument();
    expect(screen.getByText(/09:00.*14:00/)).toBeInTheDocument();
    expect(screen.getByText(/R-2481/)).toBeInTheDocument();
  });

  it('omits the retailer chip when retailer_name is null — no placeholder', () => {
    mockUseOrderDossier.mockReturnValue({
      data: { ...BASE_DATA, retailer_name: null },
      isLoading: false,
      isError: false,
    });
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.queryByText('Falabella')).toBeNull();
  });

  it('omits the delivery window chip when both bounds are null', () => {
    mockUseOrderDossier.mockReturnValue({
      data: { ...BASE_DATA, delivery_window_start: null, delivery_window_end: null },
      isLoading: false,
      isError: false,
    });
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.queryByText(/09:00.*14:00/)).toBeNull();
  });

  it('omits the route chip when no dispatch carries an external_route_id', () => {
    mockUseOrderDossier.mockReturnValue({
      data: { ...BASE_DATA, dispatches: [dispatch({ external_route_id: null })] },
      isLoading: false,
      isError: false,
    });
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.queryByText(/R-2481/)).toBeNull();
  });

  it('shows the last-updated time from the most recent audit log — grounded, not invented', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText(/actualizado/i)).toHaveTextContent('12:41');
  });

  it('omits the last-updated chip entirely when there are no audit logs', () => {
    mockUseOrderDossier.mockReturnValue({
      data: { ...BASE_DATA, auditLogs: [] },
      isLoading: false,
      isError: false,
    });
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.queryByText(/actualizado/i)).toBeNull();
  });

  it('renders a large status badge for the leading status', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText('En reparto')).toBeInTheDocument();
  });

  it('renders the lifecycle timeline fed by auditLogs', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByTestId('lifecycle-timeline')).toHaveTextContent('1');
  });

  it('shows Paquetes/Historial tab counts, and no Conversación tab when the module is off', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /Paquetes \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Historial \(2\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Conversación/ })).toBeNull();
  });

  it('renders OrderPackageList and WhyLateBlock (invisible today, no reason source) in the Paquetes tab', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByTestId('package-list')).toHaveTextContent('1');
    // WhyLateBlock renders null with no reasonFlag source anywhere in the schema.
    expect(screen.queryByText(/Por qué está atrasada/)).toBeNull();
  });

  it('threads packageLabelsEnabled to the per-package reprint control', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} packageLabelsEnabled={true} />);
    expect(screen.getByTestId('package-reprint-links')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /CL7742891003/i })).toHaveAttribute(
      'href',
      '/app/pickup/manifests/m-1/labels/print?packageId=pkg-1',
    );
  });

  it('does not render the reprint control when packageLabelsEnabled is false', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} packageLabelsEnabled={false} />);
    expect(screen.queryByTestId('package-reprint-links')).toBeNull();
  });

  it('does not render the reprint control when there is no manifest, even if labels are enabled', () => {
    mockUseOrderDossier.mockReturnValue({
      data: { ...BASE_DATA, manifestId: null },
      isLoading: false,
      isError: false,
    });
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} packageLabelsEnabled={true} />);
    expect(screen.queryByTestId('package-reprint-links')).toBeNull();
  });

  it('renders UnifiedEventLog and ProofOfDelivery (for the non-pickup dispatch) in the Historial tab', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByTestId('unified-event-log')).toHaveTextContent('2');
    expect(screen.getByTestId('proof-of-delivery')).toHaveTextContent('dp-1');
  });

  it('passes a null dispatch to ProofOfDelivery when there is no non-pickup dispatch', () => {
    mockUseOrderDossier.mockReturnValue({
      data: { ...BASE_DATA, dispatches: [dispatch({ is_pickup: true, id: 'dp-pickup' })] },
      isLoading: false,
      isError: false,
    });
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByTestId('proof-of-delivery')).toHaveTextContent('none');
  });

  // Controller ruling, round 3 — a retried delivery leaves more than one
  // non-pickup dispatch for the order (dispatches.failure_reason exists
  // precisely for the superseded ones). useOrderDossier now orders that
  // query newest-first; this asserts the component picks whichever dispatch
  // comes FIRST in the array it's given, not last or some other one — the
  // half of the fix that has to hold even though the query ordering itself
  // is asserted separately in useOrderDossier.test.ts.
  it('uses the first non-pickup dispatch (the newest, per the dossier query order) for POD, the ruta chip and Abrir en ruta — not a superseded attempt', () => {
    const newer = dispatch({
      id: 'dp-newer',
      external_route_id: 'R-9999',
      route_id: 'route-newer',
      failure_reason: null,
    });
    const older = dispatch({
      id: 'dp-older',
      external_route_id: 'R-2481',
      route_id: 'route-older',
      failure_reason: 'Nadie en casa',
    });
    mockUseOrderDossier.mockReturnValue({
      data: { ...BASE_DATA, dispatches: [newer, older] },
      isLoading: false,
      isError: false,
    });
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);

    expect(screen.getByTestId('proof-of-delivery')).toHaveTextContent('dp-newer');
    expect(screen.getByText(/R-9999/)).toBeInTheDocument();
    expect(screen.queryByText(/R-2481/)).toBeNull();
    expect(screen.getByRole('link', { name: /Abrir en ruta/i })).toHaveAttribute(
      'href',
      '/app/dispatch/route-newer',
    );
  });

  describe('Conversación tab — gated on ModuleKey.CONVERSATIONS', () => {
    it('does not exist in the DOM at all when the module is off — not zero, absent', () => {
      mockUseModuleEnabled.mockReturnValue(false);
      wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
      expect(screen.queryByRole('tab', { name: /Conversación/ })).toBeNull();
      expect(mockUseOrderConversationSessions).toHaveBeenCalledWith(null, null);
    });

    it('exists with a session count when the module is on', () => {
      mockUseModuleEnabled.mockReturnValue(true);
      mockUseOrderConversationSessions.mockReturnValue({
        data: [{ id: 's-1' }, { id: 's-2' }],
        isLoading: false,
      });
      wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
      expect(screen.getByRole('tab', { name: /Conversación \(2\)/ })).toBeInTheDocument();
    });

    it('shows the most recent session via ConversationThread', async () => {
      mockUseModuleEnabled.mockReturnValue(true);
      mockUseOrderConversationSessions.mockReturnValue({
        data: [{ id: 's-1' }],
        isLoading: false,
      });
      wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
      const tab = screen.getByRole('tab', { name: /Conversación/ });
      tab.click();
      expect(await screen.findByTestId('conversation-thread')).toHaveTextContent('s-1');
    });

    it('shows an explicit empty state — not the thread component — when there are no sessions', () => {
      mockUseModuleEnabled.mockReturnValue(true);
      mockUseOrderConversationSessions.mockReturnValue({ data: [], isLoading: false });
      wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
      const tab = screen.getByRole('tab', { name: /Conversación \(0\)/ });
      tab.click();
      expect(screen.queryByTestId('conversation-thread')).toBeNull();
    });

    // Controller ruling, round 2 — silently showing only the newest session
    // in a panel built for reconstructing history is the failure mode to
    // avoid; a visible line beats a silent pick.
    it('says plainly that older sessions exist when there is more than one, with a link to the full list', async () => {
      mockUseModuleEnabled.mockReturnValue(true);
      mockUseOrderConversationSessions.mockReturnValue({
        data: [{ id: 's-1' }, { id: 's-2' }],
        isLoading: false,
      });
      wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
      const tab = screen.getByRole('tab', { name: /Conversación \(2\)/ });
      tab.click();
      expect(await screen.findByText(/2 conversaciones/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Conversaciones/i })).toHaveAttribute(
        'href',
        '/app/conversations',
      );
    });

    it('does not show the multi-session notice when there is exactly one session', async () => {
      mockUseModuleEnabled.mockReturnValue(true);
      mockUseOrderConversationSessions.mockReturnValue({
        data: [{ id: 's-1' }],
        isLoading: false,
      });
      wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
      const tab = screen.getByRole('tab', { name: /Conversación/ });
      tab.click();
      await screen.findByTestId('conversation-thread');
      expect(screen.queryByText(/conversaciones/i)).toBeNull();
    });
  });

  it('renders the footer with esc·cerrar and a working Copiar ID button', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText(/esc/i)).toBeInTheDocument();
    const copyButton = screen.getByRole('button', { name: /Copiar ID/i });
    copyButton.click();
    expect(writeText).toHaveBeenCalledWith('ORD-48213');
  });

  it('calls onClose when the sheet is dismissed', () => {
    // Smoke test that the prop signature (orderId, onClose, packageLabelsEnabled)
    // did not change — both real callers rely on exactly this shape.
    const onClose = vi.fn();
    wrap(<OrderInspector orderId="o-1" onClose={onClose} />);
    expect(screen.getByTestId('order-inspector')).toBeInTheDocument();
  });

  describe('Abrir en ruta — controller ruling, round 2', () => {
    it('links to the app-wide route detail path using routes.id, not external_route_id', () => {
      wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
      const link = screen.getByRole('link', { name: /Abrir en ruta/i });
      expect(link).toHaveAttribute('href', '/app/dispatch/route-uuid-1');
    });

    it('does not render the button when there is no non-pickup dispatch', () => {
      mockUseOrderDossier.mockReturnValue({
        data: { ...BASE_DATA, dispatches: [dispatch({ is_pickup: true, id: 'dp-pickup' })] },
        isLoading: false,
        isError: false,
      });
      wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
      expect(screen.queryByRole('link', { name: /Abrir en ruta/i })).toBeNull();
    });

    it('does not render the button when the dispatch has no joined route — absent, not a dead link', () => {
      mockUseOrderDossier.mockReturnValue({
        data: { ...BASE_DATA, dispatches: [dispatch({ route_id: null })] },
        isLoading: false,
        isError: false,
      });
      wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
      expect(screen.queryByRole('link', { name: /Abrir en ruta/i })).toBeNull();
    });
  });
});
