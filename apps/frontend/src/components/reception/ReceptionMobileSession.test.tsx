import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
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

const receivedResult: ReceptionScanValidationResult = {
  scanResult: 'received',
  packageId: 'p1',
  packageLabel: 'CL7742891088',
};

const duplicateResult: ReceptionScanValidationResult = {
  scanResult: 'duplicate',
  packageId: null,
  packageLabel: 'CL7742891088',
};

const matchedSnapshot = baseSnapshot({ expected_count: 10, received_count: 10, unexpected_count: 0 });
const shortSnapshot = baseSnapshot({ expected_count: 10, received_count: 8, unexpected_count: 0 });

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
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the header shows progress against what was expected', () => {
    render(<ReceptionMobileSession {...makeProps()} />);
    expect(screen.getByText('61')).toBeInTheDocument();
    expect(screen.getByText(/\/ 88/)).toBeInTheDocument();
    expect(screen.getByText('PR-2026-0099')).toBeInTheDocument();
    expect(screen.getByText(/Marcela Rojas/)).toBeInTheDocument();
  });

  it('the scan result survives the real 3s auto-dismiss window of the screen it replaces', () => {
    // The block must NOT auto-hide. An operator who looks at the box and
    // back at the screen has to still see where the last read landed — the
    // 3s setTimeout that used to do this is removed in task 19, and this
    // component must not add one of its own. Fake timers so the assertion
    // genuinely covers the real 3s window, not an arbitrary short wait.
    vi.useFakeTimers();
    const { rerender } = render(<ReceptionMobileSession {...makeProps({ lastScanResult: receivedResult })} />);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText(/RECIBIDO/)).toBeInTheDocument();
    rerender(<ReceptionMobileSession {...makeProps({ lastScanResult: duplicateResult })} />);
    expect(screen.getByText(/YA ESCANEADO/)).toBeInTheDocument();
  });

  it('warns when the reader stopped pointing at the field', async () => {
    const user = userEvent.setup();
    render(<ReceptionMobileSession {...makeProps()} />);
    // ScanField focuses itself on mount for real — that focus event is what
    // flips readerReady, not a hardcoded initial `true` (finding 1).
    expect(screen.getByText(/Lector listo/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /código manual/i }));
    expect(await screen.findByText(/Toca para reactivar el lector/i)).toBeInTheDocument();
  });

  it('never claims the reader is ready while it mounts disabled — readerReady genuinely starts false', () => {
    // Finding 1. ScanField's mount effect short-circuits at
    // `if (!disabled)` — a disabled field never fires `onFocusStateChange`
    // at all. A session that initialised `readerReady` to `true` would show
    // "Lector listo" here regardless, lying about a trigger pull that
    // cannot land while the field is disabled.
    render(<ReceptionMobileSession {...makeProps({ isScanPending: true })} />);
    expect(screen.getByText(/Toca para reactivar el lector/i)).toBeInTheDocument();
    expect(screen.queryByText(/Lector listo/i)).not.toBeInTheDocument();
  });

  it('Confirmar closes without asking for a note when nothing is missing', async () => {
    const onFinalize = vi.fn();
    const user = userEvent.setup();
    render(<ReceptionMobileSession {...makeProps({ snapshot: matchedSnapshot, onFinalize })} />);
    await user.click(screen.getByRole('button', { name: /^Confirmar/ }));
    expect(onFinalize).toHaveBeenCalledWith(null);
  });

  it('Confirmar opens the note sheet and does not close yet when there is a discrepancy', async () => {
    const onFinalize = vi.fn();
    const user = userEvent.setup();
    render(<ReceptionMobileSession {...makeProps({ snapshot: shortSnapshot, onFinalize })} />);
    await user.click(screen.getByRole('button', { name: /^Confirmar/ }));
    expect(onFinalize).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('typing a note and confirming it hands the trimmed text to onFinalize — the third leg of the gate', async () => {
    // `handleConfirm` opening the sheet, and the "no note needed" branch,
    // are already covered above; this is the missing third leg —
    // `handleNoteConfirm` itself, the path that actually closes the
    // reception once the note comes back from DiscrepancyNoteSheet.
    const onFinalize = vi.fn();
    const user = userEvent.setup();
    render(<ReceptionMobileSession {...makeProps({ snapshot: shortSnapshot, onFinalize })} />);
    await user.click(screen.getByRole('button', { name: /^Confirmar/ }));
    await user.type(screen.getByRole('textbox'), '  Faltan 2 de CARGA-001  ');
    await user.click(screen.getByRole('button', { name: /Cerrar recepción/i }));
    expect(onFinalize).toHaveBeenCalledWith('Faltan 2 de CARGA-001');
  });

  it('offline says what happens to the work already done, and never blocks anything', () => {
    render(<ReceptionMobileSession {...makeProps({ syncStatus: 'offline', queuedCount: 14 })} />);
    expect(screen.getByText(/14/)).toBeInTheDocument();
    expect(screen.getByText(/se envían solos/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Confirmar/ })).toBeEnabled();
  });

  it('renders no sync chip online with nothing queued, but does once something is queued even while online', () => {
    // Finding 6. The chip used to gate on `syncStatus !== 'online'` alone,
    // so a `syncing` state with `queuedCount: 0` rendered a nonsensical
    // "0 escaneos guardados…". It must gate on actually having something to
    // report: a nonzero queue, or being outright offline.
    const { rerender } = render(<ReceptionMobileSession {...makeProps()} />);
    expect(screen.queryByText(/escaneos/i)).not.toBeInTheDocument();

    rerender(<ReceptionMobileSession {...makeProps({ syncStatus: 'syncing', queuedCount: 0 })} />);
    expect(screen.queryByText(/escaneos/i)).not.toBeInTheDocument();

    rerender(<ReceptionMobileSession {...makeProps({ syncStatus: 'syncing', queuedCount: 3 })} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/aún en cola/i)).toBeInTheDocument();
  });

  it('the "already scanned" time is the first received scan, never the duplicate row the mutation just created', () => {
    // Finding 2. `get_route_reception_snapshot` aggregates `scans` with no
    // ORDER BY (migration 20260813000005) — array order is NOT guaranteed
    // chronological. The duplicate row is listed FIRST here on purpose, so
    // a naive `.find(barcode)` (which returns the first array match) would
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
    render(<ReceptionMobileSession {...makeProps({ snapshot, lastScanResult: duplicateResult })} />);
    // Scoped to the feedback block: the duplicate row itself (13:04) also
    // appears, correctly, in the plain history list below — the thing that
    // must never happen is the FEEDBACK block reporting 13:04 as "first".
    const feedback = within(screen.getByTestId('scan-feedback'));
    expect(feedback.getByText(new RegExp(expectedHourMinute('2026-08-20T12:58:00Z')))).toBeInTheDocument();
    expect(
      feedback.queryByText(new RegExp(expectedHourMinute('2026-08-20T13:04:00Z'))),
    ).not.toBeInTheDocument();
  });

  it('an unknown barcode identifies the box by the code actually scanned, not a blank result', async () => {
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

  it('the history marks duplicates and ajenos with their chips', () => {
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

  it('orders the history newest-first without trusting the snapshot array order', () => {
    // Bug found in review: `get_route_reception_snapshot`'s `v_scans`
    // aggregate has no ORDER BY (migration 20260813000005:113-116 —
    // contrast :142, where the same author DID add one for
    // `v_discrepancies`). A plain `.reverse()` on the raw array only
    // produces "newest first" if the array happened to arrive
    // chronological; it does not. These fixture rows are deliberately out
    // of order — oldest listed first, newest listed last, with one in the
    // middle — so a `.reverse()` would misorder them.
    const snapshot = baseSnapshot();
    snapshot.scans = [
      { id: 'oldest', barcode: 'OLD', scan_result: 'received', package_id: 'p1', scanned_at: '2026-08-20T10:00:00Z' },
      { id: 'newest', barcode: 'NEW', scan_result: 'received', package_id: 'p2', scanned_at: '2026-08-20T12:00:00Z' },
      { id: 'middle', barcode: 'MID', scan_result: 'received', package_id: 'p3', scanned_at: '2026-08-20T11:00:00Z' },
    ];
    render(<ReceptionMobileSession {...makeProps({ snapshot })} />);
    const rows = screen.getAllByTestId('scan-history-row').map((row) => row.textContent);
    expect(rows[0]).toContain('NEW');
    expect(rows[1]).toContain('MID');
    expect(rows[2]).toContain('OLD');
  });
});
