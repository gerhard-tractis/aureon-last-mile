import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceptionReceipt } from './ReceptionReceipt';
import type { RouteReceptionSnapshot } from '@/hooks/reception/useRouteReceptionSnapshot';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';

// 88 expected · 86 received · 1 unexpected. finalizeRule's `matched` is
// received - unexpected = 85, so `missing` is 88 - 85 = 3 — NOT the naive
// 88 - 86 = 2 a bare subtraction would produce. This is the offsetting
// fixture: with unexpectedCount at 0 the naive formula and finalizeRule
// agree by accident and the test proves nothing.
const snapshot: RouteReceptionSnapshot = {
  route: {
    id: 'r1',
    code: 'PR-2026-0148',
    driver_id: 'd1',
    driver_name: 'Marcela Rojas',
    plate: 'JKLM-42',
    status: 'received',
    in_transit_at: '2026-08-20T12:00:00Z',
  },
  route_reception: {
    id: 'rr1',
    status: 'completed',
    expected_count: 88,
    received_count: 86,
    unexpected_count: 1,
    started_at: '2026-08-20T12:05:00Z',
    completed_at: '2026-08-20T12:40:00Z',
    discrepancy_notes: 'Faltan 2 paquetes de CARGA-99814, revisar con el chofer.',
  },
  manifests: [
    { id: 'm1', external_load_id: 'CARGA-001', retailer_name: 'Easy' },
    { id: 'm2', external_load_id: 'CARGA-002', retailer_name: 'Sodimac' },
    { id: 'm3', external_load_id: 'CARGA-99814', retailer_name: 'Falabella' },
  ],
  expected_packages: [],
  scans: [],
  discrepancies: [],
};

const sinNota: RouteReceptionSnapshot = {
  ...snapshot,
  route_reception: {
    ...snapshot.route_reception,
    expected_count: 3,
    received_count: 3,
    unexpected_count: 0,
    discrepancy_notes: null,
  },
};

// A single-manifest route is not an edge case — most receptions close one
// load, not three. Agreement bugs ("1 cargas cerradas") hide behind a
// fixture that always has more than one manifest.
const unaCarga: RouteReceptionSnapshot = {
  ...snapshot,
  manifests: [snapshot.manifests[0]],
};

const otraRuta: IncomingRoute = {
  id: 'r2',
  code: 'PR-2026-0149',
  driver_id: 'd2',
  driver_name: 'Luis Paredes',
  plate: 'ZZZZ-99',
  in_transit_at: '2026-08-20T13:00:00Z',
  started_at: null,
  manifest_count: 2,
  expected_packages: 40,
};

const props = {
  snapshot,
  nextYardRoute: null as IncomingRoute | null,
  onBack: vi.fn(),
  onOpenRoute: vi.fn(),
};

describe('ReceptionReceipt', () => {
  it('the four figures come from route_receptions, not a recount', () => {
    render(<ReceptionReceipt {...props} />);
    expect(screen.getByTestId('acta-esperados')).toHaveTextContent(/^Esperados88$/);
    expect(screen.getByTestId('acta-recibidos')).toHaveTextContent(/^Recibidos86$/);
    // Anchored, not a substring match — a loose 'toHaveTextContent(\'3\')'
    // would also pass on 13 or 30. The naive-subtraction failure mode this
    // fixture exists to catch produces 2, which this still rejects.
    expect(screen.getByTestId('acta-faltantes')).toHaveTextContent(/^Faltantes3$/); // 86 - 1 ajeno vs 88
    expect(screen.getByTestId('acta-ajenos')).toHaveTextContent(/^Ajenos a la ruta1$/); // unexpected_count
  });

  it('shows the note exactly as it was saved', () => {
    render(<ReceptionReceipt {...props} />);
    expect(screen.getByText(/Faltan 2 paquetes de CARGA-99814/)).toBeInTheDocument();
  });

  it('with no note, does not draw the discrepancy block', () => {
    // A reception that reconciled has no discrepancy_notes. An empty block
    // titled "NOTA DE DISCREPANCIA" would suggest a note existed and was lost.
    render(<ReceptionReceipt {...props} snapshot={sinNota} />);
    expect(screen.queryByText(/NOTA DE DISCREPANCIA/)).not.toBeInTheDocument();
  });

  it('names what the reception left done', () => {
    render(<ReceptionReceipt {...props} />);
    expect(screen.getByText(/3 cargas/)).toBeInTheDocument();
    expect(screen.getByText(/clasificación/i)).toBeInTheDocument();
  });

  it('agrees in number: one closed manifest reads "1 carga cerrada", not "1 cargas cerradas"', () => {
    render(<ReceptionReceipt {...props} snapshot={unaCarga} />);
    expect(screen.getByText(/1 carga cerrada,/)).toBeInTheDocument();
    expect(screen.queryByText(/1 cargas/)).not.toBeInTheDocument();
    expect(screen.queryByText(/carga cerradas/)).not.toBeInTheDocument();
  });

  it('re-enters the flow when another truck is still waiting', () => {
    render(<ReceptionReceipt {...props} nextYardRoute={otraRuta} />);
    expect(screen.getByText(otraRuta.code)).toBeInTheDocument();
  });

  it('with no more trucks, does not invent a next route', () => {
    render(<ReceptionReceipt {...props} nextYardRoute={null} />);
    expect(screen.queryByText(/QUEDA 1 RUTA EN PATIO/)).not.toBeInTheDocument();
  });

  it('the primary button returns to reception and measures 60px', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<ReceptionReceipt {...props} onBack={onBack} />);
    const button = screen.getByRole('button', { name: /Volver a recepción/ });
    expect(button.className).toContain('h-[60px]');
    await user.click(button);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('the secondary button opens the route detail', async () => {
    const onOpenRoute = vi.fn();
    const user = userEvent.setup();
    render(<ReceptionReceipt {...props} onOpenRoute={onOpenRoute} />);
    const button = screen.getByRole('button', { name: /Ver detalle de la ruta/ });
    await user.click(button);
    expect(onOpenRoute).toHaveBeenCalledTimes(1);
  });
});
