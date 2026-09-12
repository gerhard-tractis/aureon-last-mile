import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QuickSortMobileDock } from './QuickSortMobileDock';
import type { ZoneMatchResult } from '@/lib/distribution/sectorization-engine';
import type { QuickSortPackageInfo, QuickSortScanEvent } from '@/hooks/distribution/useQuickSortFlow';

/** spec-68 Fase 5.3/5.4 — `4h`/`4j`/`4i`, quicksort step 2 (one component, three states). */

const destination: ZoneMatchResult = {
  zone_id: 'zone-1',
  zone_name: 'Sur Oriente',
  zone_code: 'A3',
  is_consolidation: false,
  reason: 'matched',
  flagged: false,
};

const pkg: QuickSortPackageInfo = {
  id: 'pkg-1',
  label: 'PKG-001',
  orderNumber: 'ORD-2026-0007',
  comunaName: 'Las Condes',
};

function baseProps() {
  return {
    operatorName: 'M. Rojas',
    destination,
    currentPackage: pkg,
    siblingsPending: 0,
    zoneCount: 0,
    zoneCapacity: null as number | null,
    rejectedCode: null as string | null,
    scans: [] as QuickSortScanEvent[],
    onScanAnden: vi.fn(),
    onMarkException: vi.fn(),
    isMarkingException: false,
    exceptionError: null as string | null,
    onSendToConsolidation: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe('QuickSortMobileDock — 4h/4j normal destination', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // spec-96 Fase 1, Task 1.2 — the armed andén field must also submit from
  // a no-Enter scanner burst alone, same contract as the paso 1 field.
  it('submits a scanner burst with no Enter and no click (paso 2, 4j)', () => {
    vi.useFakeTimers();
    const props = baseProps();
    render(<QuickSortMobileDock {...props} />);
    const input = screen.getByLabelText(/escanear andén/i) as HTMLInputElement;

    const code = 'DOCK-003';
    for (let i = 1; i <= code.length; i++) {
      fireEvent.change(input, { target: { value: code.slice(0, i) } });
      act(() => vi.advanceTimersByTime(25));
    }
    act(() => vi.advanceTimersByTime(120));

    expect(props.onScanAnden).toHaveBeenCalledTimes(1);
    expect(props.onScanAnden).toHaveBeenCalledWith(code);
  });

  it('renders the andén code at 62px with comuna and package/order context', () => {
    render(<QuickSortMobileDock {...baseProps()} />);
    expect(screen.getByText('LLEVAR A')).toBeInTheDocument();
    const code = screen.getByText('A3');
    expect(code.className).toMatch(/text-\[62px\]/);
    expect(screen.getByText(/Las Condes · PKG-001 · orden ORD-2026-0007/)).toBeInTheDocument();
  });

  it('shows no incomplete-order notice when there are no pending siblings', () => {
    render(<QuickSortMobileDock {...baseProps()} />);
    expect(screen.queryByText(/falta/i)).not.toBeInTheDocument();
  });

  it('shows the incomplete-order notice, pluralized, when siblings remain (4j)', () => {
    render(<QuickSortMobileDock {...baseProps()} siblingsPending={1} />);
    expect(
      screen.getByText(/falta 1 paquete de esta orden · sale incompleta si cierras el andén/i),
    ).toBeInTheDocument();
  });

  it('pluralizes for more than one sibling', () => {
    render(<QuickSortMobileDock {...baseProps()} siblingsPending={3} />);
    expect(screen.getByText(/falta 3 paquetes de esta orden/i)).toBeInTheDocument();
  });

  it('renders no capacity block when the zone has no capacity configured', () => {
    render(<QuickSortMobileDock {...baseProps()} zoneCount={5} zoneCapacity={null} />);
    expect(screen.queryByTestId('dock-capacity-fill')).not.toBeInTheDocument();
  });

  it('renders the capacity block when capacity is configured (4j)', () => {
    render(<QuickSortMobileDock {...baseProps()} zoneCount={169} zoneCapacity={180} />);
    expect(screen.getByText('169 / 180')).toBeInTheDocument();
    expect(screen.getByTestId('dock-capacity-fill')).toBeInTheDocument();
  });

  // spec-96 Fase 1, Task 1.3 (4h/4j) — the capacity block's own container
  // must carry the same tone getDockCapacityStatus already computes, not a
  // constant neutral wrapper regardless of how full the zone is.
  it("carries the capacity block's tone from getDockCapacityStatus, not a fixed neutral wrapper", () => {
    const { rerender } = render(
      <QuickSortMobileDock {...baseProps()} zoneCount={169} zoneCapacity={180} />,
    );
    expect(screen.getByTestId('quicksort-capacity-block').dataset.tone).toBe('warning');

    rerender(<QuickSortMobileDock {...baseProps()} zoneCount={180} zoneCapacity={180} />);
    expect(screen.getByTestId('quicksort-capacity-block').dataset.tone).toBe('error');

    rerender(<QuickSortMobileDock {...baseProps()} zoneCount={5} zoneCapacity={180} />);
    expect(screen.getByTestId('quicksort-capacity-block').dataset.tone).toBe('neutral');
  });

  // spec-96 Fase 1 review finding #5 — `data-tone` alone doesn't prove the
  // fix: a tone-to-class map flattened to one class for every tone still
  // reports the right `data-tone` while the visible fix (the whole point
  // of the tone) is gone, and the test above stays green either way. This
  // pins that the three tones actually render three DIFFERENT classNames.
  it("renders three genuinely different classNames for the capacity block's three tones, not just three different data-tone values", () => {
    const { rerender } = render(
      <QuickSortMobileDock {...baseProps()} zoneCount={5} zoneCapacity={180} />,
    );
    const neutralClass = screen.getByTestId('quicksort-capacity-block').className;

    rerender(<QuickSortMobileDock {...baseProps()} zoneCount={169} zoneCapacity={180} />);
    const warningClass = screen.getByTestId('quicksort-capacity-block').className;

    rerender(<QuickSortMobileDock {...baseProps()} zoneCount={180} zoneCapacity={180} />);
    const errorClass = screen.getByTestId('quicksort-capacity-block').className;

    expect(neutralClass).not.toBe(warningClass);
    expect(warningClass).not.toBe(errorClass);
    expect(neutralClass).not.toBe(errorClass);
  });

  it('arms the andén field with the AHORA ESCANEA copy and the accepted-codes note', () => {
    render(<QuickSortMobileDock {...baseProps()} />);
    expect(screen.getByText('AHORA ESCANEA EL ANDÉN')).toBeInTheDocument();
    expect(
      screen.getByText('Solo acepta A3 o Consolidación · sin escaneo no queda asignado'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/escanear andén/i)).toBeInTheDocument();
  });

  it('forwards a scanned andén code', () => {
    const props = baseProps();
    render(<QuickSortMobileDock {...props} />);
    const input = screen.getByLabelText(/escanear andén/i);
    fireEvent.change(input, { target: { value: 'A3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onScanAnden).toHaveBeenCalledWith('A3');
  });

  it('shows the non-rejected footer: Enviar a consolidación / Cancelar', () => {
    const props = baseProps();
    render(<QuickSortMobileDock {...props} />);
    fireEvent.click(screen.getByText('Enviar a consolidación'));
    expect(props.onSendToConsolidation).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Cancelar y volver al paso 1'));
    expect(props.onCancel).toHaveBeenCalled();
    expect(screen.queryByText('Marcar excepción y seguir')).not.toBeInTheDocument();
  });
});

describe('QuickSortMobileDock — unmapped comuna (flagged)', () => {
  // Review fix (finding #4) — desktop shows this same banner
  // (QuickSortScanner.tsx) when destination.flagged; mobile was dropping
  // it entirely.
  it('shows the redirecting-to-consolidación banner when the destination is flagged', () => {
    const flagged = { ...destination, zone_code: 'CONSOL', zone_name: 'Consolidación', flagged: true };
    render(<QuickSortMobileDock {...baseProps()} destination={flagged} />);
    expect(
      screen.getByText('Comuna sin andén asignado — redirigiendo a Consolidación'),
    ).toBeInTheDocument();
  });

  it('shows no banner when the destination is not flagged', () => {
    render(<QuickSortMobileDock {...baseProps()} />);
    expect(screen.queryByText(/redirigiendo a Consolidación/)).not.toBeInTheDocument();
  });
});

describe('QuickSortMobileDock — 4i rejected andén', () => {
  it('flips the destination card to the error palette with struck-through scanned code', () => {
    render(<QuickSortMobileDock {...baseProps()} rejectedCode="B7" />);
    const card = screen.getByTestId('quicksort-destination-card');
    expect(card.dataset.tone).toBe('error');
    expect(screen.getByText('ASIGNACIÓN FALLIDA')).toBeInTheDocument();
    const struck = screen.getByText('B7');
    expect(struck.className).toMatch(/line-through/);
    expect(screen.getByText('Andén incorrecto')).toBeInTheDocument();
  });

  it('names the expected andén and states nothing moved', () => {
    render(<QuickSortMobileDock {...baseProps()} rejectedCode="B7" />);
    expect(screen.getByText('Esperado A3 o Consolidación')).toBeInTheDocument();
    expect(
      screen.getByText('PKG-001 sigue sin asignar · no se movió nada en el sistema'),
    ).toBeInTheDocument();
  });

  it('still shows the correct destination reminder and a re-armed field', () => {
    render(<QuickSortMobileDock {...baseProps()} rejectedCode="B7" />);
    expect(screen.getByText('Llevar a')).toBeInTheDocument();
    expect(screen.getAllByText('A3').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/escanear andén/i)).toBeInTheDocument();
  });

  it('shows the rejected footer: Marcar excepción y seguir / Cancelar', () => {
    const props = { ...baseProps(), rejectedCode: 'B7' };
    render(<QuickSortMobileDock {...props} />);
    fireEvent.click(screen.getByText('Marcar excepción y seguir'));
    expect(props.onMarkException).toHaveBeenCalled();
    expect(screen.queryByText('Enviar a consolidación')).not.toBeInTheDocument();
  });

  // Review fix (finding #1) — a failed exception write must be visible,
  // not silently treated as though it succeeded.
  it('shows the exception-write error banner when markException failed', () => {
    render(
      <QuickSortMobileDock
        {...baseProps()}
        rejectedCode="B7"
        exceptionError="No se pudo registrar la excepción — intenta de nuevo"
      />,
    );
    expect(screen.getByTestId('quicksort-exception-error')).toHaveTextContent(
      'No se pudo registrar la excepción — intenta de nuevo',
    );
  });

  it('shows no exception-error banner when nothing has failed', () => {
    render(<QuickSortMobileDock {...baseProps()} rejectedCode="B7" />);
    expect(screen.queryByTestId('quicksort-exception-error')).not.toBeInTheDocument();
  });
});

describe('QuickSortMobileDock — accessibility floor', () => {
  it('keeps both footer actions between 56 and 60px in every state', () => {
    const { rerender } = render(<QuickSortMobileDock {...baseProps()} />);
    for (const btn of screen.getAllByRole('button')) {
      if (btn.textContent?.match(/consolidación|cancelar/i)) {
        expect(btn.className).toMatch(/h-\[5[6-9]px\]|h-\[60px\]/);
      }
    }
    rerender(<QuickSortMobileDock {...baseProps()} rejectedCode="B7" />);
    for (const btn of screen.getAllByRole('button')) {
      if (btn.textContent?.match(/excepción|cancelar/i)) {
        expect(btn.className).toMatch(/h-\[5[6-9]px\]|h-\[60px\]/);
      }
    }
  });

  it('keeps recent-scan rows at or above 44px', () => {
    const scans: QuickSortScanEvent[] = [
      { code: 'PKG-002', zoneCode: 'A2', zoneName: 'Andén 2', at: new Date(), status: 'ok' },
    ];
    render(<QuickSortMobileDock {...baseProps()} scans={scans} />);
    expect(screen.getByTestId('quicksort-recent-scan').className).toMatch(/min-h-\[44px\]/);
  });

  // spec-68 Fase 6 accessibility sweep (6.3) — this component renders with
  // no `DistributionMobileHeader` at all (Decisión 4's geometry has none),
  // so `/app/distribution/quicksort` had ZERO top-level headings whenever
  // step 2 (this component) was the one on screen — QuickSortMobile (step
  // 1) carries the route's only <h1>, and the two states are mutually
  // exclusive within `QuickSortMobileView`. A visually-hidden <h1> keeps
  // Decisión 4's visual geometry untouched while giving the route exactly
  // one top-level heading in every state.
  it('carries exactly one <h1> naming the current state, in both the normal and rejected variants', () => {
    const { rerender } = render(<QuickSortMobileDock {...baseProps()} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    rerender(<QuickSortMobileDock {...baseProps()} rejectedCode="B7" />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  // spec-96 Fase 1, Task 1.1 (4h/4i) — the app used to render no visible
  // screen header on step 2 at all, only an sr-only <h1>. Both artboards
  // draw a real header row (back arrow, title, subtitle, status chip).
  it('renders a real, visible header on both the normal (4h) and rejected (4i) states — not sr-only', () => {
    const { rerender } = render(<QuickSortMobileDock {...baseProps()} />);
    let heading = screen.getByRole('heading', { level: 1 });
    expect(heading.closest('.sr-only')).toBeNull();
    expect(heading.className).not.toMatch(/sr-only/);

    rerender(<QuickSortMobileDock {...baseProps()} rejectedCode="B7" />);
    heading = screen.getByRole('heading', { level: 1 });
    expect(heading.closest('.sr-only')).toBeNull();
    expect(heading.className).not.toMatch(/sr-only/);
  });

  it('the header carries a back control that cancels back to step 1, same as the footer action', () => {
    const props = baseProps();
    render(<QuickSortMobileDock {...props} />);
    fireEvent.click(screen.getByLabelText('Volver'));
    expect(props.onCancel).toHaveBeenCalled();
  });
});
