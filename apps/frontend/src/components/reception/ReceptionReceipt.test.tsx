import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceptionReceipt } from './ReceptionReceipt';
import type { RouteReceptionSnapshot } from '@/hooks/reception/useRouteReceptionSnapshot';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';

// 88 expected · 86 received · 1 unexpected. finalizeRule's `matched` is
// received - unexpected = 85, so `missing` is 88 - 85 = 3 — NOT the naive
// 88 - 86 = 2 a bare subtraction would produce. This is the offsetting
// fixture the brief calls out: with unexpectedCount at 0 the naive formula
// and finalizeRule agree by accident and the test proves nothing.
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
  it('las cuatro cifras salen de route_receptions, no de un recuento propio', () => {
    render(<ReceptionReceipt {...props} />);
    expect(screen.getByTestId('acta-esperados')).toHaveTextContent('88');
    expect(screen.getByTestId('acta-recibidos')).toHaveTextContent('86');
    expect(screen.getByTestId('acta-faltantes')).toHaveTextContent('3'); // 86 - 1 ajeno vs 88
    expect(screen.getByTestId('acta-ajenos')).toHaveTextContent('1'); // unexpected_count
  });

  it('muestra la nota tal como quedó guardada', () => {
    render(<ReceptionReceipt {...props} />);
    expect(screen.getByText(/Faltan 2 paquetes de CARGA-99814/)).toBeInTheDocument();
  });

  it('sin nota no dibuja el bloque de discrepancia', () => {
    // A reception that reconciled has no discrepancy_notes. An empty block
    // titled "NOTA DE DISCREPANCIA" would suggest a note existed and was lost.
    render(<ReceptionReceipt {...props} snapshot={sinNota} />);
    expect(screen.queryByText(/NOTA DE DISCREPANCIA/)).not.toBeInTheDocument();
  });

  it('nombra lo que la recepción dejó hecho', () => {
    render(<ReceptionReceipt {...props} />);
    expect(screen.getByText(/3 cargas/)).toBeInTheDocument();
    expect(screen.getByText(/clasificación/i)).toBeInTheDocument();
  });

  it('reincorpora al flujo cuando queda otro camión esperando', () => {
    render(<ReceptionReceipt {...props} nextYardRoute={otraRuta} />);
    expect(screen.getByText(otraRuta.code)).toBeInTheDocument();
  });

  it('sin más camiones no inventa una siguiente ruta', () => {
    render(<ReceptionReceipt {...props} nextYardRoute={null} />);
    expect(screen.queryByText(/Queda 1 ruta en patio/)).not.toBeInTheDocument();
  });

  it('el botón primario vuelve a recepción y mide 60px', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<ReceptionReceipt {...props} onBack={onBack} />);
    const button = screen.getByRole('button', { name: /Volver a recepción/ });
    expect(button.className).toContain('h-[60px]');
    await user.click(button);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('el botón secundario abre el detalle de la ruta', async () => {
    const onOpenRoute = vi.fn();
    const user = userEvent.setup();
    render(<ReceptionReceipt {...props} onOpenRoute={onOpenRoute} />);
    const button = screen.getByRole('button', { name: /Ver detalle de la ruta/ });
    await user.click(button);
    expect(onOpenRoute).toHaveBeenCalledTimes(1);
  });
});
