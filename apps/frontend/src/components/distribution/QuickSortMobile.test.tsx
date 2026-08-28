import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickSortMobile } from './QuickSortMobile';
import type { QuickSortScanEvent } from '@/hooks/distribution/useQuickSortFlow';

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
  // `mode: 'stage'` is a `Tabs` in the header row; this screen has no such
  // row, so the switch is its own segmented pill instead of a `Tabs` drop-in.
  describe('mode toggle (spec-71 phase 3 mobile)', () => {
    it('renders no toggle when onModeChange is not passed (every other caller unaffected)', () => {
      render(<QuickSortMobile {...baseProps()} />);
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    it('defaults to Sectorizar selected, and shows the andén copy, when mode is omitted', () => {
      render(<QuickSortMobile {...baseProps()} onModeChange={vi.fn()} />);
      expect(screen.getByRole('tab', { name: 'Sectorizar' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: 'Estibar' })).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByText('Clasificación en andén')).toBeInTheDocument();
      expect(
        screen.getByText('El sistema te dirá a qué andén va antes de que lo muevas'),
      ).toBeInTheDocument();
    });

    it('shows the Estibar tab selected and the posición copy when mode="stage"', () => {
      render(<QuickSortMobile {...baseProps()} mode="stage" onModeChange={vi.fn()} />);
      expect(screen.getByRole('tab', { name: 'Estibar' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Carga a posición')).toBeInTheDocument();
      expect(
        screen.getByText('El sistema te dirá a qué posición va antes de que lo muevas'),
      ).toBeInTheDocument();
    });

    it('calls onModeChange with the tapped mode', () => {
      const onModeChange = vi.fn();
      render(<QuickSortMobile {...baseProps()} onModeChange={onModeChange} />);
      fireEvent.click(screen.getByRole('tab', { name: 'Estibar' }));
      expect(onModeChange).toHaveBeenCalledWith('stage');
    });

    it('keeps both toggle buttons at the 44px touch-target floor', () => {
      render(<QuickSortMobile {...baseProps()} onModeChange={vi.fn()} />);
      for (const tab of screen.getAllByRole('tab')) {
        expect(tab.className).toMatch(/h-11/);
      }
    });
  });
});
