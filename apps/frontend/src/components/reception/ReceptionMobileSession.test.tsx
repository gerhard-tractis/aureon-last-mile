import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceptionMobileSession, type ReceptionMobileSessionProps } from './ReceptionMobileSession';
import { timeLabel } from '@/lib/reception/reception-mobile-helpers';
import type { RouteReceptionSnapshot } from '@/hooks/reception/useRouteReceptionSnapshot';
import type { ReceptionScanValidationResult } from '@/lib/reception/reception-scan-validator';

/** Same rationale as ReceptionScanFeedback.test.tsx: read the expected
 *  "HH:MM" through the component's own formatter instead of hardcoding a
 *  timezone-shifted string. */
function expectedHourMinute(iso: string): string {
  const label = timeLabel(iso);
  if (label === null) throw new Error(`timeLabel(${iso}) returned null`);
  const match = label.match(/\d{2}:\d{2}/);
  if (match === null) throw new Error(`no HH:MM found in "${label}"`);
  return match[0];
}

// spec-62 chunk 3 (task 18) — the unloading screen itself (mock 3q). An
// operator at a truck scans box after box; this suite exercises the five
// findings called out in the task brief (reader-ready init, the duplicate
// first-scan lookup, the unknown-barcode fallback, no auto-hide timer, and
// the finalize/note gate) alongside the layout the mock specifies.

function baseSnapshot(overrides?: Partial<RouteReceptionSnapshot['route_reception']>): RouteReceptionSnapshot {
  return {
    route: {
      id: 'r1',
      code: 'PR-2026-0099',
      driver_id: 'd1',
      driver_name: 'Marcela Rojas',
      plate: 'AA-1234',
      status: 'in_transit',
      in_transit_at: null,
    },
    route_reception: {
      id: 'rr1',
      status: 'in_progress',
      expected_count: 88,
      received_count: 61,
      unexpected_count: 0,
      started_at: null,
      completed_at: null,
      discrepancy_notes: null,
      ...overrides,
    },
    manifests: [],
    expected_packages: [],
    scans: [],
    discrepancies: [],
  };
}

const recibido: ReceptionScanValidationResult = {
  scanResult: 'received',
  packageId: 'p1',
  packageLabel: 'CL7742891088',
};

const duplicado: ReceptionScanValidationResult = {
  scanResult: 'duplicate',
  packageId: null,
  packageLabel: 'CL7742891088',
};

const cuadrado = baseSnapshot({ expected_count: 10, received_count: 10, unexpected_count: 0 });
const conFaltantes = baseSnapshot({ expected_count: 10, received_count: 8, unexpected_count: 0 });

function makeProps(overrides?: Partial<ReceptionMobileSessionProps>): ReceptionMobileSessionProps {
  return {
    snapshot: baseSnapshot(),
    lastScanResult: null,
    syncStatus: 'online',
    queuedCount: 0,
    isScanPending: false,
    isFinalizePending: false,
    onScan: vi.fn(),
    onFinalize: vi.fn(),
    ...overrides,
  };
}

describe('ReceptionMobileSession', () => {
  it('la cabecera muestra el avance sobre lo esperado', () => {
    render(<ReceptionMobileSession {...makeProps()} />);
    expect(screen.getByText('61')).toBeInTheDocument();
    expect(screen.getByText(/\/ 88/)).toBeInTheDocument();
    expect(screen.getByText('PR-2026-0099')).toBeInTheDocument();
    expect(screen.getByText(/Marcela Rojas/)).toBeInTheDocument();
  });

  it('el resultado del escaneo persiste hasta el siguiente', async () => {
    // El bloque NO se auto-oculta. Un operario que mira el bulto y vuelve a
    // la pantalla tiene que seguir viendo dónde quedó la última lectura; el
    // setTimeout de 3s que hacía esto se elimina en la task 19 — este
    // componente no debe añadir uno propio.
    const { rerender } = render(<ReceptionMobileSession {...makeProps({ lastScanResult: recibido })} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText(/RECIBIDO/)).toBeInTheDocument();
    rerender(<ReceptionMobileSession {...makeProps({ lastScanResult: duplicado })} />);
    expect(screen.getByText(/YA ESCANEADO/)).toBeInTheDocument();
  });

  it('avisa cuando el lector dejó de apuntar al campo', async () => {
    const user = userEvent.setup();
    render(<ReceptionMobileSession {...makeProps()} />);
    // ScanField focuses itself on mount for real — that focus event is what
    // flips readerReady, not a hardcoded initial `true` (finding 1).
    expect(screen.getByText(/Lector listo/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /código manual/i }));
    expect(await screen.findByText(/Toca para reactivar el lector/i)).toBeInTheDocument();
  });

  it('sin diferencias, Confirmar cierra sin pedir nota', async () => {
    const onFinalize = vi.fn();
    const user = userEvent.setup();
    render(<ReceptionMobileSession {...makeProps({ snapshot: cuadrado, onFinalize })} />);
    await user.click(screen.getByRole('button', { name: /^Confirmar/ }));
    expect(onFinalize).toHaveBeenCalledWith(null);
  });

  it('con diferencias, Confirmar abre la hoja y no cierra todavía', async () => {
    const onFinalize = vi.fn();
    const user = userEvent.setup();
    render(<ReceptionMobileSession {...makeProps({ snapshot: conFaltantes, onFinalize })} />);
    await user.click(screen.getByRole('button', { name: /^Confirmar/ }));
    expect(onFinalize).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('sin conexión dice qué pasa con el trabajo hecho, y no bloquea nada', () => {
    render(<ReceptionMobileSession {...makeProps({ syncStatus: 'offline', queuedCount: 14 })} />);
    expect(screen.getByText(/14/)).toBeInTheDocument();
    expect(screen.getByText(/se envían solos/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Confirmar/ })).toBeEnabled();
  });

  it('la hora de "ya escaneado" es la del primer escaneo recibido, no la de la fila duplicada que la mutación acaba de crear', () => {
    // Finding 2. `scans.find(barcode)` after invalidation would return the
    // duplicate row itself (13:04) and misreport it as "first scanned at".
    // `get_route_reception_snapshot` aggregates `scans` with no ORDER BY
    // (migration 20260813000005) — array order is NOT guaranteed
    // chronological. The duplicate row is listed FIRST here on purpose, so a
    // naive `.find(barcode)` (which returns the first array match) would
    // wrongly grab the duplicate's own 13:04 timestamp instead of the
    // earliest `received` one.
    const snapshot = baseSnapshot();
    snapshot.scans = [
      {
        id: 's2',
        barcode: 'CL7742891088',
        scan_result: 'duplicate',
        package_id: null,
        scanned_at: '2026-08-20T13:04:00Z',
      },
      {
        id: 's1',
        barcode: 'CL7742891088',
        scan_result: 'received',
        package_id: 'p1',
        scanned_at: '2026-08-20T12:58:00Z',
      },
    ];
    render(<ReceptionMobileSession {...makeProps({ snapshot, lastScanResult: duplicado })} />);
    // Scoped to the feedback block: the duplicate row itself (13:04) also
    // appears, correctly, in the plain history list below — the thing that
    // must never happen is the FEEDBACK block reporting 13:04 as "first".
    const feedback = within(screen.getByTestId('scan-feedback'));
    expect(feedback.getByText(new RegExp(expectedHourMinute('2026-08-20T12:58:00Z')))).toBeInTheDocument();
    expect(
      feedback.queryByText(new RegExp(expectedHourMinute('2026-08-20T13:04:00Z'))),
    ).not.toBeInTheDocument();
  });

  it('un código desconocido identifica el bulto por el código escaneado, no lo deja en blanco', async () => {
    // Finding 3. `not_found` returns `packageLabel: null` — the session must
    // carry the raw scanned barcode down as the fallback context so the
    // operator sees what they scanned, not a blank result.
    const user = userEvent.setup();
    const onScan = vi.fn();
    const { rerender } = render(<ReceptionMobileSession {...makeProps({ onScan })} />);

    await user.type(screen.getByRole('textbox', { name: /código de barras/i }), 'GHOST-999{Enter}');
    expect(onScan).toHaveBeenCalledWith('GHOST-999');

    rerender(
      <ReceptionMobileSession
        {...makeProps({
          onScan,
          lastScanResult: { scanResult: 'not_found', packageId: null, packageLabel: null },
        })}
      />,
    );
    expect(screen.getByText(/NO ESTÁ EN LA RUTA/)).toBeInTheDocument();
    expect(screen.getByText('GHOST-999')).toBeInTheDocument();
  });

  it('el historial marca los duplicados y los ajenos con sus chips', () => {
    const snapshot = baseSnapshot();
    snapshot.scans = [
      { id: 's1', barcode: 'CL001', scan_result: 'received', package_id: 'p1', scanned_at: '2026-08-20T12:00:00Z' },
      { id: 's2', barcode: 'CL001', scan_result: 'duplicate', package_id: null, scanned_at: '2026-08-20T12:01:00Z' },
      { id: 's3', barcode: 'BOGUS', scan_result: 'not_found', package_id: null, scanned_at: '2026-08-20T12:02:00Z' },
    ];
    render(<ReceptionMobileSession {...makeProps({ snapshot })} />);
    expect(screen.getByText('REPETIDO')).toBeInTheDocument();
    expect(screen.getByText('AJENO')).toBeInTheDocument();
  });

  it('no llama a open_route_reception ni monta ningún control que la invoque', () => {
    // Nothing on this screen may call the arrival-time RPC — that belongs to
    // a different screen entirely. Guarded here by name search: this
    // component's source has no RPC calls of any kind (it only takes
    // callbacks), so this is a structural check that no button/text mentions
    // starting or opening a reception.
    render(<ReceptionMobileSession {...makeProps()} />);
    expect(screen.queryByText(/iniciar conteo/i)).not.toBeInTheDocument();
  });
});
