import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchScanLastRead } from './DispatchScanLastRead';
import { buildAcceptedEntry, buildRejectedEntry } from '@/lib/dispatch/mobile/scan-session';

describe('DispatchScanLastRead', () => {
  it('spec-76 2e — an accepted read shows the barcode, timestamp, stop, order, recipient, address, client and box count — no per-package confirmation dialog', () => {
    const entry = buildAcceptedEntry({
      id: '1',
      code: 'CL8841873',
      atIso: '2026-09-03T12:19:04.000Z',
      response: {
        order_id: 'o1',
        order_number: 'ORD-3311',
        contact_name: 'Javiera Muñoz',
        contact_address: 'Los Aromos 442, Ñuñoa',
      },
      orderContext: { comuna: 'Ñuñoa', retailerName: 'Falabella', stopIndex: 9 },
      boxes: { loaded: 2, total: 3 },
    });
    render(<DispatchScanLastRead entry={entry} onViewRoute={vi.fn()} />);

    expect(screen.getByText('Cargado en la ruta')).toBeInTheDocument();
    expect(screen.getByText('CL8841873')).toBeInTheDocument();
    expect(screen.getByText(/ORD-3311/)).toBeInTheDocument();
    expect(screen.getByText(/Javiera Muñoz/)).toBeInTheDocument();
    expect(screen.getByText(/Los Aromos 442, Ñuñoa/)).toBeInTheDocument();
    expect(screen.getByText(/Falabella/)).toBeInTheDocument();
    expect(screen.getByText(/paquete 2 de 3/)).toBeInTheDocument();
    expect(screen.getByText(/parada 09/)).toBeInTheDocument();
    // No modal / dialog role anywhere — decision 5, never a blocking dialog.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirmar/i })).not.toBeInTheDocument();
  });

  it('omits stop/paquete lines honestly when the order context has not resolved yet, instead of a fabricated 09', () => {
    const entry = buildAcceptedEntry({
      id: '2',
      code: 'CL2',
      atIso: '2026-09-03T12:00:00.000Z',
      response: { order_id: 'o2', order_number: 'ORD-2', contact_name: null, contact_address: null },
    });
    render(<DispatchScanLastRead entry={entry} onViewRoute={vi.fn()} />);
    expect(screen.queryByText(/parada/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/paquete \d/i)).not.toBeInTheDocument();
  });

  it('spec-76 2f decision 5 — ALREADY_IN_ROUTE names the route, says the package was NOT added, and offers to view (not move) it', async () => {
    const user = userEvent.setup();
    const onViewRoute = vi.fn();
    const entry = buildRejectedEntry({
      id: '3',
      code: 'CL9999',
      atIso: '2026-09-03T12:20:00.000Z',
      failure: { code: 'ALREADY_IN_ROUTE', message: 'Paquete ya asignado a otra ruta activa', conflictingRouteId: 'route-abc' },
      conflictingRouteCode: 'RUT-0087',
    });
    render(<DispatchScanLastRead entry={entry} onViewRoute={onViewRoute} />);

    expect(screen.getByText(/RUT-0087/)).toBeInTheDocument();
    expect(screen.getByText(/no fue agregado/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mover/i })).not.toBeInTheDocument();

    const viewButton = screen.getByRole('button', { name: /ver ruta/i });
    await user.click(viewButton);
    expect(onViewRoute).toHaveBeenCalledWith('route-abc');
  });

  it('the field stays armed — no button here disables the scan field or navigates away except the explicit "Ver ruta" action', () => {
    const entry = buildRejectedEntry({
      id: '4',
      code: 'CL1',
      atIso: 't',
      failure: { code: 'NOT_FOUND', message: 'Código no encontrado' },
    });
    render(<DispatchScanLastRead entry={entry} onViewRoute={vi.fn()} />);
    expect(screen.getByText('Código no encontrado en este operador')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('IN_CONSOLIDATION renders its own reason, not the ALREADY_IN_ROUTE explanation', () => {
    const entry = buildRejectedEntry({
      id: '5',
      code: 'CL1',
      atIso: 't',
      failure: { code: 'IN_CONSOLIDATION', message: 'Paquete en andén de consolidación: reasígnalo a un andén de reparto antes de cargarlo' },
    });
    render(<DispatchScanLastRead entry={entry} onViewRoute={vi.fn()} />);
    expect(screen.getByText('Retenido en consolidación')).toBeInTheDocument();
    expect(screen.queryByText(/no fue agregado/i)).not.toBeInTheDocument();
  });
});
