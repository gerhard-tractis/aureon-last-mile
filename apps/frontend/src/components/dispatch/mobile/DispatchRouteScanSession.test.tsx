import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchRouteScanSession, type DispatchRouteScanSessionProps } from './DispatchRouteScanSession';
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

// The camera itself is exercised in DispatchRouteCameraViewfinder.test.tsx
// and useBarcodeCameraScan.test.ts; here it is stubbed so this file stays
// about the SESSION's own wiring (mode toggling, footer buttons), not
// html5-qrcode.
const cameraViewfinderProps: { active: boolean; onDecode: ((code: string) => void) | null } = {
  active: false,
  onDecode: null,
};
vi.mock('./DispatchRouteCameraViewfinder', () => ({
  DispatchRouteCameraViewfinder: (props: { active: boolean; onDecode: (code: string) => void }) => {
    cameraViewfinderProps.active = props.active;
    cameraViewfinderProps.onDecode = props.onDecode;
    return props.active ? <div data-testid="stub-camera-viewfinder" /> : null;
  },
}));

const onViewPackagesMock = vi.fn();

function renderSession(overrides: Partial<DispatchRouteScanSessionProps> = {}) {
  return render(
    <DispatchRouteScanSession
      routeId="r1"
      operatorId="op-1"
      routeCode="RUT-0099"
      loadPositionLabel={null}
      driverName={null}
      vehicleExternalId={null}
      onViewPackages={onViewPackagesMock}
      {...overrides}
    />,
  );
}

describe('DispatchRouteScanSession', () => {
  beforeEach(() => {
    submitScanMock.mockReset();
    pushMock.mockReset();
    onViewPackagesMock.mockReset();
    mockSession = baseSession();
    cameraViewfinderProps.active = false;
    cameraViewfinderProps.onDecode = null;
  });

  it('spec-76 2e — shows header, always-visible counter, and no confirmation dialog before any scan', () => {
    renderSession({
      loadPositionLabel: 'A3',
      driverName: 'Mario González',
      vehicleExternalId: 'JKPT-45',
    });
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
    renderSession();
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
    renderSession();
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
    renderSession();
    expect(screen.getByText('Retenido en consolidación')).toBeInTheDocument();
    expect(screen.getByText('1 RECHAZO')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /escanear paquete/i })).not.toBeDisabled();
  });

  it('spec-76 fase 4 #15 — Ingresar código opens the manual sheet and submits through submitScan', async () => {
    const user = userEvent.setup();
    renderSession();
    await user.click(screen.getByRole('button', { name: /ingresar código/i }));
    await user.type(screen.getByLabelText('Código del bulto'), 'CL7000');
    await user.click(screen.getByRole('button', { name: /registrar/i }));
    expect(submitScanMock).toHaveBeenCalledWith('CL7000');
  });

  it('Cerrar ruta stays disabled with its reason — spec-77, not this branch', () => {
    renderSession();
    const closeButton = screen.getByRole('button', { name: /cerrar ruta/i });
    expect(closeButton).toBeDisabled();
    expect(screen.getByText(/próxima pantalla — spec-77/i)).toBeInTheDocument();
  });

  it('spec-76 task 4 — Cámara and Ver los N are wired, not disabled placeholders any more', () => {
    renderSession();
    expect(screen.getByRole('button', { name: /^cámara$/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /ver los 148/i })).not.toBeDisabled();
  });

  it('spec-76 task 4 (2h) — "Ver los N" calls onViewPackages, not a navigation', async () => {
    const user = userEvent.setup();
    renderSession();
    await user.click(screen.getByRole('button', { name: /ver los 148/i }));
    expect(onViewPackagesMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('spec-76 task 4 (2g) — "Cámara" swaps the reader for the viewfinder in the SAME screen (same loop, same output)', async () => {
    const user = userEvent.setup();
    renderSession();
    expect(screen.getByRole('textbox', { name: /escanear paquete/i })).toBeInTheDocument();
    expect(cameraViewfinderProps.active).toBe(false);

    await user.click(screen.getByRole('button', { name: /^cámara$/i }));

    expect(screen.queryByRole('textbox', { name: /escanear paquete/i })).not.toBeInTheDocument();
    expect(cameraViewfinderProps.active).toBe(true);
    // The header, counter and route code stay put — 2g is a state of 2e,
    // not a different screen.
    expect(screen.getByText('RUT-0099')).toBeInTheDocument();
    expect(screen.getByTestId('dispatch-scan-counter')).toBeInTheDocument();
  });

  it('spec-76 task 4 (2g) — names the real throughput cost, does not present the two inputs as equivalent', async () => {
    const user = userEvent.setup();
    renderSession();
    await user.click(screen.getByRole('button', { name: /^cámara$/i }));
    expect(
      screen.getByText(/la cámara lee de una en una\. con el lector zebra el ritmo es de tres a cuatro veces mayor/i),
    ).toBeInTheDocument();
  });

  it('spec-76 task 4 (2g) — a camera decode reaches submitScan exactly like a handheld scan', async () => {
    const user = userEvent.setup();
    renderSession();
    await user.click(screen.getByRole('button', { name: /^cámara$/i }));
    cameraViewfinderProps.onDecode!('CL8841881');
    expect(submitScanMock).toHaveBeenCalledWith('CL8841881');
  });

  it('spec-76 task 4 (2g) — "Volver al lector" (footer) exits camera mode back to the handheld field', async () => {
    const user = userEvent.setup();
    renderSession();
    await user.click(screen.getByRole('button', { name: /^cámara$/i }));
    await user.click(screen.getByRole('button', { name: /volver al lector/i }));
    expect(screen.getByRole('textbox', { name: /escanear paquete/i })).toBeInTheDocument();
    // The viewfinder unmounts entirely rather than staying mounted with
    // active=false — DispatchRouteCameraViewfinder.test.tsx already covers
    // the hook not initialising while inactive (rule 7); here what matters
    // is that it is gone from THIS screen once we are back on the reader.
    expect(screen.queryByTestId('stub-camera-viewfinder')).not.toBeInTheDocument();
  });

  it('spec-76 task 4 (2g) — "Ingresar código" stays available as an exit while in camera mode', async () => {
    const user = userEvent.setup();
    renderSession();
    await user.click(screen.getByRole('button', { name: /^cámara$/i }));
    await user.click(screen.getByRole('button', { name: /ingresar código/i }));
    expect(screen.getByLabelText('Código del bulto')).toBeInTheDocument();
  });

  it('spec-76 review "spec deviations" — the remaining disabled footer reason is visible text, not a title= tooltip nobody sees on a touchscreen', () => {
    renderSession();
    expect(screen.getByText(/cierre de ruta es la próxima pantalla/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cerrar ruta/i })).not.toHaveAttribute('title');
  });

  it('spec-76 review "spec deviations" — header, counter and ScanField stay visible while the session scrolls (sticky)', () => {
    renderSession();
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
    renderSession();
    await user.click(screen.getByRole('button', { name: /ver ruta/i }));
    expect(pushMock).toHaveBeenCalledWith('/app/dispatch/route-2');
  });
});
