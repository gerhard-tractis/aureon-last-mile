import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchRouteScanSession } from './DispatchRouteScanSession';
import { buildAcceptedEntry, buildRejectedEntry } from '@/lib/dispatch/mobile/scan-session';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

const submitScanMock = vi.fn();
let mockSession: ReturnType<typeof baseSession>;

function baseSession() {
  return {
    submitScan: submitScanMock,
    isSubmitting: false,
    lastEntry: null as ReturnType<typeof buildAcceptedEntry> | ReturnType<typeof buildRejectedEntry> | null,
    history: [] as unknown[],
    rejectionCount: 0,
    rejectionTally: [] as { code: string; label: string; count: number }[],
    packagesLoaded: 148,
    packagesTotal: 172,
    percent: 86,
  };
}

vi.mock('@/hooks/dispatch/mobile/useRouteScanSession', () => ({
  useRouteScanSession: () => mockSession,
}));

describe('DispatchRouteScanSession', () => {
  beforeEach(() => {
    submitScanMock.mockReset();
    pushMock.mockReset();
    mockSession = baseSession();
  });

  it('spec-76 2e — shows header, always-visible counter, and no confirmation dialog before any scan', () => {
    render(
      <DispatchRouteScanSession
        routeId="r1"
        operatorId="op-1"
        routeCode="RUT-0099"
        loadPositionLabel="A3"
        driverName="Mario González"
        vehicleExternalId="JKPT-45"
      />,
    );
    expect(screen.getByText('RUT-0099')).toBeInTheDocument();
    expect(screen.getByText('A3 · Mario González · JKPT-45')).toBeInTheDocument();
    expect(screen.getByText(/ZEBRA TC22/)).toBeInTheDocument();
    expect(screen.getByText('148 de 172 paquetes')).toBeInTheDocument();
    // Spec copy has a thin space before the percent sign ("86 %"), not
    // "86%" run together — matched by regex since a literal " " would not
    // match the actual thin-space (U+2009) character rendered.
    expect(screen.getByText(/86\s*%/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('spec-76 fase 4 #12 — a scan (Enter path) reaches submitScan through the shared ScanField', async () => {
    const user = userEvent.setup();
    render(
      <DispatchRouteScanSession
        routeId="r1" operatorId="op-1" routeCode="RUT-0099"
        loadPositionLabel={null} driverName={null} vehicleExternalId={null}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: /escanear paquete/i }), 'CL8841873{Enter}');
    expect(submitScanMock).toHaveBeenCalledWith('CL8841873');
  });

  it('spec-76 fase 4 #13 — an accepted read renders the last-read card', () => {
    mockSession.lastEntry = buildAcceptedEntry({
      id: '1',
      code: 'CL8841873',
      atIso: '2026-09-03T12:19:04.000Z',
      response: { order_id: 'o1', order_number: 'ORD-3311', contact_name: 'Javiera Muñoz', contact_address: 'Los Aromos 442' },
    });
    render(
      <DispatchRouteScanSession
        routeId="r1" operatorId="op-1" routeCode="RUT-0099"
        loadPositionLabel={null} driverName={null} vehicleExternalId={null}
      />,
    );
    expect(screen.getByTestId('dispatch-scan-last-read')).toBeInTheDocument();
    expect(screen.getByText('Cargado en la ruta')).toBeInTheDocument();
  });

  it('spec-76 fase 4 #14 — a rejected read renders in the SAME place, no navigation, field stays interactable', () => {
    mockSession.lastEntry = buildRejectedEntry({
      id: '2',
      code: 'CL9999',
      atIso: '2026-09-03T12:20:00.000Z',
      failure: { code: 'IN_CONSOLIDATION', message: 'x' },
    });
    mockSession.rejectionCount = 1;
    mockSession.rejectionTally = [{ code: 'IN_CONSOLIDATION', label: 'RETENIDO EN CONSOLIDACIÓN', count: 1 }];
    render(
      <DispatchRouteScanSession
        routeId="r1" operatorId="op-1" routeCode="RUT-0099"
        loadPositionLabel={null} driverName={null} vehicleExternalId={null}
      />,
    );
    expect(screen.getByText('Retenido en consolidación')).toBeInTheDocument();
    expect(screen.getByText('1 RECHAZO')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /escanear paquete/i })).not.toBeDisabled();
  });

  it('spec-76 fase 4 #15 — Ingresar código opens the manual sheet and submits through submitScan', async () => {
    const user = userEvent.setup();
    render(
      <DispatchRouteScanSession
        routeId="r1" operatorId="op-1" routeCode="RUT-0099"
        loadPositionLabel={null} driverName={null} vehicleExternalId={null}
      />,
    );
    await user.click(screen.getByRole('button', { name: /ingresar código/i }));
    await user.type(screen.getByLabelText('Código del bulto'), 'CL7000');
    await user.click(screen.getByRole('button', { name: /registrar/i }));
    expect(submitScanMock).toHaveBeenCalledWith('CL7000');
  });

  it('Cerrar ruta stays disabled with its reason — spec-77, not this branch', () => {
    render(
      <DispatchRouteScanSession
        routeId="r1" operatorId="op-1" routeCode="RUT-0099"
        loadPositionLabel={null} driverName={null} vehicleExternalId={null}
      />,
    );
    const closeButton = screen.getByRole('button', { name: /cerrar ruta/i });
    expect(closeButton).toBeDisabled();
    expect(screen.getByText(/próxima pantalla — spec-77/i)).toBeInTheDocument();
  });

  it('Cámara and Ver los N stay disabled — 2g/2h do not exist on this branch', () => {
    render(
      <DispatchRouteScanSession
        routeId="r1" operatorId="op-1" routeCode="RUT-0099"
        loadPositionLabel={null} driverName={null} vehicleExternalId={null}
      />,
    );
    expect(screen.getByRole('button', { name: /cámara/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /ver los 148/i })).toBeDisabled();
  });

  it('spec-76 review "spec deviations" — every disabled footer reason is visible text, not a title= tooltip nobody sees on a touchscreen', () => {
    render(
      <DispatchRouteScanSession
        routeId="r1" operatorId="op-1" routeCode="RUT-0099"
        loadPositionLabel={null} driverName={null} vehicleExternalId={null}
      />,
    );
    expect(screen.getByText(/cámara llega en la próxima pantalla \(2g\)/i)).toBeInTheDocument();
    expect(screen.getByText(/lista de paquetes por parada llega en la próxima pantalla \(2h\)/i)).toBeInTheDocument();
    expect(screen.getByText(/cierre de ruta es la próxima pantalla/i)).toBeInTheDocument();
    // None of the three disabled buttons carry title= any more.
    for (const name of [/cámara/i, /ver los 148/i, /cerrar ruta/i]) {
      expect(screen.getByRole('button', { name })).not.toHaveAttribute('title');
    }
  });

  it('spec-76 review "spec deviations" — header, counter and ScanField stay visible while the session scrolls (sticky)', () => {
    render(
      <DispatchRouteScanSession
        routeId="r1" operatorId="op-1" routeCode="RUT-0099"
        loadPositionLabel={null} driverName={null} vehicleExternalId={null}
      />,
    );
    const stickyRegion = screen.getByText('RUT-0099').closest('.sticky');
    expect(stickyRegion).not.toBeNull();
    expect(stickyRegion).toContainElement(screen.getByTestId('dispatch-scan-counter'));
    expect(stickyRegion).toContainElement(screen.getByRole('textbox', { name: /escanear paquete/i }));
  });

  it('clicking "Ver ruta" on an ALREADY_IN_ROUTE rejection navigates to that route', async () => {
    const user = userEvent.setup();
    // 'RUT-0087' is a readable fixture — routeCode() (crew-board.ts) really
    // emits an 8-char UUID slice, e.g. "ABCDEF12" (scan-rejection-copy.
    // test.ts's own note).
    mockSession.lastEntry = buildRejectedEntry({
      id: '3',
      code: 'CL1',
      atIso: '2026-09-03T09:00:00.000Z',
      failure: { code: 'ALREADY_IN_ROUTE', message: 'x', conflictingRouteId: 'route-2' },
      conflictingRouteCode: 'RUT-0087',
    });
    render(
      <DispatchRouteScanSession
        routeId="r1" operatorId="op-1" routeCode="RUT-0099"
        loadPositionLabel={null} driverName={null} vehicleExternalId={null}
      />,
    );
    await user.click(screen.getByRole('button', { name: /ver ruta/i }));
    expect(pushMock).toHaveBeenCalledWith('/app/dispatch/route-2');
  });
});
