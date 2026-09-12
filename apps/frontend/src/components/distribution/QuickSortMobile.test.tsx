import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QuickSortMobile } from './QuickSortMobile';
import type { QuickSortScanEvent } from '@/hooks/distribution/useQuickSortFlow';
import type { ZoneMatchResult } from '@/lib/distribution/sectorization-engine';

/** spec-68 Fase 5.2 — `4g`, quicksort step 1. */

function baseProps() {
  return {
    operatorName: 'Marcela R.',
    sessionCount: 3,
    scans: [] as QuickSortScanEvent[],
    error: null,
    onScan: vi.fn(),
    onBack: vi.fn(),
    onEnterCode: vi.fn(),
    onCloseBatch: vi.fn(),
  };
}

describe('QuickSortMobile', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // spec-96 Fase 1, Task 1.2 — the QA scanner gun types the code and sends
  // no Enter. The armed package field must submit from that burst alone,
  // with no click and no keydown, exactly like ScanField's own guard test.
  it('submits a scanner burst with no Enter and no click (paso 1)', () => {
    vi.useFakeTimers();
    const props = baseProps();
    render(<QuickSortMobile {...props} />);
    const input = screen.getByLabelText(/escanear paquete/i) as HTMLInputElement;

    const code = 'CL7742891003';
    for (let i = 1; i <= code.length; i++) {
      fireEvent.change(input, { target: { value: code.slice(0, i) } });
      act(() => vi.advanceTimersByTime(25));
    }
    act(() => vi.advanceTimersByTime(120));

    expect(props.onScan).toHaveBeenCalledTimes(1);
    expect(props.onScan).toHaveBeenCalledWith(code);
  });

  it('renders the titled header with operator, step and session count', () => {
    render(<QuickSortMobile {...baseProps()} />);
    expect(screen.getByText('Clasificación en andén')).toBeInTheDocument();
    expect(screen.getByText(/Marcela R\. · paso 1 de 2 · 3 escaneos hoy/)).toBeInTheDocument();
    expect(screen.getByText('EN LÍNEA')).toBeInTheDocument();
  });

  // Review fix (finding #3) — the chip must reflect real connectivity, not
  // a hardcoded 'EN LÍNEA' literal that keeps lying once the device drops
  // Wi-Fi mid-loop and every scan starts failing with "Error de red".
  it('shows SIN CONEXIÓN when offline, not a hardcoded EN LÍNEA', () => {
    render(<QuickSortMobile {...baseProps()} isOnline={false} />);
    expect(screen.getByText('SIN CONEXIÓN')).toBeInTheDocument();
    expect(screen.queryByText('EN LÍNEA')).not.toBeInTheDocument();
  });

  it('renders the armed scan field with its eyebrow and helper copy', () => {
    render(<QuickSortMobile {...baseProps()} />);
    expect(screen.getByText('PASO 1 · PAQUETE')).toBeInTheDocument();
    expect(screen.getByText('Escanea el paquete')).toBeInTheDocument();
    expect(
      screen.getByText('El sistema te dirá a qué andén va antes de que lo muevas'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/escanear paquete/i)).toBeInTheDocument();
  });

  it('forwards a scanned code to onScan', () => {
    const props = baseProps();
    render(<QuickSortMobile {...props} />);
    const input = screen.getByLabelText(/escanear paquete/i);
    fireEvent.change(input, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onScan).toHaveBeenCalledWith('PKG-001');
  });

  it('shows an empty-state message with no scans yet', () => {
    render(<QuickSortMobile {...baseProps()} />);
    expect(screen.getByText(/los escaneos de esta sesión aparecen aquí/i)).toBeInTheDocument();
  });

  it('lists recent scans, newest visible, tagged ok/error', () => {
    const scans: QuickSortScanEvent[] = [
      { code: 'PKG-002', zoneCode: 'A2', zoneName: 'Andén 2', at: new Date(), status: 'ok' },
      { code: 'NOPE', zoneCode: null, zoneName: null, at: new Date(), status: 'error', reason: 'NO ENCONTRADO' },
    ];
    render(<QuickSortMobile {...baseProps()} scans={scans} />);
    const rows = screen.getAllByTestId('quicksort-recent-scan');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('A2')).toBeInTheDocument();
    expect(screen.getByText('NO ENCONTRADO')).toBeInTheDocument();
  });

  it('shows the error result when handlePackageScan reports one', () => {
    render(<QuickSortMobile {...baseProps()} error="Código no encontrado" />);
    expect(screen.getByText('Código no encontrado')).toBeInTheDocument();
  });

  it('wires the back arrow and both footer actions', () => {
    const props = baseProps();
    render(<QuickSortMobile {...props} />);
    fireEvent.click(screen.getByLabelText('Volver'));
    expect(props.onBack).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Ingresar código'));
    expect(props.onEnterCode).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Cerrar lote'));
    expect(props.onCloseBatch).toHaveBeenCalled();
  });

  it('keeps every touch target at or above 44px and both footer actions between 56 and 60px', () => {
    render(<QuickSortMobile {...baseProps()} />);
    const back = screen.getByLabelText('Volver');
    expect(back.className).toMatch(/h-11 w-11/); // 44px

    for (const label of ['Ingresar código', 'Cerrar lote']) {
      const btn = screen.getByText(label).closest('button')!;
      expect(btn.className).toMatch(/h-\[5[6-9]px\]|h-\[60px\]/);
    }
  });

  // spec-71 phase 3 mobile — the mode toggle. Desktop's entry point into
  // `mode: 'stage'` is a `Tabs` dropped into `/app/distribution/quicksort`'s
  // header row; this screen's own segmented pill mirrors that semantics
  // (`role="tablist"`). spec-96 Fase 1 moved it into
  // `DistributionMobileHeader`'s title row (`titleControl`) — it used to
  // render as its own row below the whole header.
  describe('mode toggle (spec-71 phase 3 mobile)', () => {
    it('renders no toggle when onModeChange is not passed (every other caller unaffected)', () => {
      render(<QuickSortMobile {...baseProps()} />);
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    // spec-96 Fase 1 review finding #2/#3 (4g) — the mock's control reads
    // SECT/ESTIB, not the full words; the app now matches it.
    it('defaults to SECT selected, and shows the andén copy, when mode is omitted', () => {
      render(<QuickSortMobile {...baseProps()} onModeChange={vi.fn()} />);
      expect(screen.getByRole('tab', { name: 'SECT' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: 'ESTIB' })).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByText('Clasificación en andén')).toBeInTheDocument();
      expect(
        screen.getByText('El sistema te dirá a qué andén va antes de que lo muevas'),
      ).toBeInTheDocument();
    });

    it('shows the ESTIB tab selected and the posición copy when mode="stage"', () => {
      render(<QuickSortMobile {...baseProps()} mode="stage" onModeChange={vi.fn()} />);
      expect(screen.getByRole('tab', { name: 'ESTIB' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Carga a posición')).toBeInTheDocument();
      expect(
        screen.getByText('El sistema te dirá a qué posición va antes de que lo muevas'),
      ).toBeInTheDocument();
    });

    it('calls onModeChange with the tapped mode', () => {
      const onModeChange = vi.fn();
      render(<QuickSortMobile {...baseProps()} onModeChange={onModeChange} />);
      fireEvent.click(screen.getByRole('tab', { name: 'ESTIB' }));
      expect(onModeChange).toHaveBeenCalledWith('stage');
    });

    // spec-96 Fase 1 review finding #3 — the artboard's visual box is
    // 91×23.5px, well under 44px; the reviewer's fix is to keep that visual
    // box and expand the HIT area instead, via `minHeight`/`minWidth`
    // rather than a visible `h-11` (a class-string assertion is itself the
    // implementation-detail check the spec forbids). Asserting inline
    // style, not a Tailwind class, is what makes this the touch-target
    // contract rather than a re-statement of one utility class.
    it('keeps both toggle buttons at the 44px touch-target floor via hit-area sizing, not visual height', () => {
      render(<QuickSortMobile {...baseProps()} onModeChange={vi.fn()} />);
      for (const tab of screen.getAllByRole('tab')) {
        expect(parseInt(tab.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
        expect(parseInt(tab.style.minWidth, 10)).toBeGreaterThanOrEqual(44);
      }
    });
  });

  // spec-71 phase 4, review finding #1 (HIGH). ScanField focuses on mount, and
  // SealPositionCard renders AFTER the package field — so an always-armed seal
  // field won the focus race and the gun's next PACKAGE barcode was typed into
  // it and POSTed to /load-positions/seal. On mobile the package field never
  // remounts, so focus never came back on its own: every later scan kept
  // landing in the seal field. The card is collapsed by default now; this test
  // is the permanent guard on that.
  it('leaves focus on the package field in stage mode — the seal card must not steal the gun', () => {
    render(<QuickSortMobile {...baseProps()} mode="stage" onModeChange={vi.fn()} />);

    expect(screen.queryByLabelText('Escanear posición a sellar')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText('Escanear paquete'));
  });

  // spec-96 Fase 1 review finding #1 (4j) — after a successful andén scan
  // the flow returns here with `state: 'confirmed'`, not a wiped step 1.
  // The destination/capacity/incomplete-order context must render, and the
  // package field must stay armed for the next scan.
  describe('confirmed context (4j)', () => {
    const confirmedDestination: ZoneMatchResult = {
      zone_id: 'zone-1',
      zone_name: 'La Florida',
      zone_code: 'A3',
      is_consolidation: false,
      reason: 'matched',
      flagged: false,
    };

    function confirmedProps() {
      return {
        destination: confirmedDestination,
        currentPackage: {
          id: 'pkg-1',
          label: 'CL7742891004',
          orderNumber: 'ORD-48213',
          comunaName: 'La Florida',
        },
        siblingsPending: 1,
        zoneCount: 169,
        zoneCapacity: 180,
      };
    }

    it('renders no confirmed context when omitted (every other caller unaffected)', () => {
      render(<QuickSortMobile {...baseProps()} />);
      expect(screen.queryByTestId('quicksort-confirmed-context')).not.toBeInTheDocument();
      expect(screen.queryByTestId('quicksort-confirmed-capacity')).not.toBeInTheDocument();
    });

    it('renders the kept destination and the incomplete-order notice', () => {
      render(<QuickSortMobile {...baseProps()} confirmed={confirmedProps()} />);
      const context = screen.getByTestId('quicksort-confirmed-context');
      expect(context).toBeInTheDocument();
      expect(screen.getByTestId('quicksort-confirmed-incomplete-order')).toBeInTheDocument();
    });

    it('shows no incomplete-order notice when there are no pending siblings', () => {
      render(
        <QuickSortMobile {...baseProps()} confirmed={{ ...confirmedProps(), siblingsPending: 0 }} />,
      );
      expect(screen.queryByTestId('quicksort-confirmed-incomplete-order')).not.toBeInTheDocument();
    });

    it('renders the capacity block, toned, when the zone has a capacity', () => {
      render(<QuickSortMobile {...baseProps()} confirmed={confirmedProps()} />);
      const capacity = screen.getByTestId('quicksort-confirmed-capacity');
      expect(capacity.dataset.tone).toBe('warning');
      expect(screen.getByTestId('dock-capacity-fill')).toBeInTheDocument();
    });

    it('renders no capacity block when the zone has no capacity configured', () => {
      render(
        <QuickSortMobile
          {...baseProps()}
          confirmed={{ ...confirmedProps(), zoneCapacity: null }}
        />,
      );
      expect(screen.queryByTestId('quicksort-confirmed-capacity')).not.toBeInTheDocument();
    });

    it('keeps the package field armed for the next scan', () => {
      const props = baseProps();
      render(<QuickSortMobile {...props} confirmed={confirmedProps()} />);
      const input = screen.getByLabelText(/escanear paquete/i);
      fireEvent.change(input, { target: { value: 'PKG-002' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(props.onScan).toHaveBeenCalledWith('PKG-002');
    });

    // The mock swaps the footer's second action for "Marcar excepción" —
    // its target action is an open product question (see the phase's
    // spec evidence): recordQuickSortException is scoped to a rejected
    // `rejectedCode`, which does not exist once the andén scan already
    // succeeded. Rendered present, disabled, rather than wired to a call
    // that would misrecord or silently no-op.
    it('replaces "Cerrar lote" with a disabled "Marcar excepción" in the footer', () => {
      render(<QuickSortMobile {...baseProps()} confirmed={confirmedProps()} />);
      expect(screen.queryByText('Cerrar lote')).not.toBeInTheDocument();
      const exceptionButton = screen.getByText('Marcar excepción').closest('button')!;
      expect(exceptionButton).toBeDisabled();
    });
  });
});
