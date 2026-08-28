import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickSortMobileStagePosition } from './QuickSortMobileStagePosition';
import type { ExpectedLoadPosition } from '@/lib/dispatch/expected-load-position';
import type { QuickSortPackageInfo, QuickSortScanEvent } from '@/hooks/distribution/useQuickSortFlow';

/**
 * spec-71 phase 3 mobile — quicksort step 2, `mode: 'stage'`. Sibling suite
 * to QuickSortMobileDock.test.tsx (the sectorize-mode step 2), covering the
 * `load_positions` destination shape instead of `dock_zones`.
 */

const positionDestination: ExpectedLoadPosition = {
  dispatchId: 'd1',
  routeId: 'route-1',
  positionId: 'lp-1',
  positionCode: 'POS-04',
  positionLabel: 'Zona frente a Andén 4',
};

const pkg: QuickSortPackageInfo = {
  id: 'pkg-1',
  label: 'PKG-001',
  orderNumber: 'ORD-2026-0007',
  comunaName: 'Las Condes',
};

function baseProps() {
  return {
    positionDestination,
    currentPackage: pkg,
    rejectedCode: null as string | null,
    scans: [] as QuickSortScanEvent[],
    onScanPosition: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe('QuickSortMobileStagePosition — destination shown', () => {
  it('renders the position code at 62px with package/order context', () => {
    render(<QuickSortMobileStagePosition {...baseProps()} />);
    expect(screen.getByText('LLEVAR A')).toBeInTheDocument();
    const code = screen.getByText('POS-04');
    expect(code.className).toMatch(/text-\[62px\]/);
    expect(screen.getByText(/PKG-001 · orden ORD-2026-0007/)).toBeInTheDocument();
    expect(screen.getByText('Zona frente a Andén 4')).toBeInTheDocument();
  });

  it('arms the position field with the AHORA ESCANEA copy and no consolidation mention', () => {
    render(<QuickSortMobileStagePosition {...baseProps()} />);
    expect(screen.getByText('AHORA ESCANEA LA POSICIÓN')).toBeInTheDocument();
    expect(
      screen.getByText('Solo acepta POS-04 · sin escaneo no queda asignado'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/escanear posición/i)).toBeInTheDocument();
  });

  it('forwards a scanned position code', () => {
    const props = baseProps();
    render(<QuickSortMobileStagePosition {...props} />);
    const input = screen.getByLabelText(/escanear posición/i);
    fireEvent.change(input, { target: { value: 'POS-04' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onScanPosition).toHaveBeenCalledWith('POS-04');
  });

  it('shows only Cancelar in the footer — no consolidation fallback, no exception marking', () => {
    const props = baseProps();
    render(<QuickSortMobileStagePosition {...props} />);
    expect(screen.queryByText('Enviar a consolidación')).not.toBeInTheDocument();
    expect(screen.queryByText('Marcar excepción y seguir')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancelar y volver al paso 1'));
    expect(props.onCancel).toHaveBeenCalled();
  });
});

describe('QuickSortMobileStagePosition — rejected position', () => {
  it('flips the destination card to the error palette with the struck-through scanned code', () => {
    render(<QuickSortMobileStagePosition {...baseProps()} rejectedCode="POS-99" />);
    const card = screen.getByTestId('quicksort-destination-card');
    expect(card.dataset.tone).toBe('error');
    expect(screen.getByText('ASIGNACIÓN FALLIDA')).toBeInTheDocument();
    const struck = screen.getByText('POS-99');
    expect(struck.className).toMatch(/line-through/);
    expect(screen.getByText('Posición incorrecta')).toBeInTheDocument();
  });

  it('names the expected position and states nothing moved', () => {
    render(<QuickSortMobileStagePosition {...baseProps()} rejectedCode="POS-99" />);
    expect(screen.getByText('Esperado POS-04')).toBeInTheDocument();
    expect(
      screen.getByText('PKG-001 sigue sin asignar · no se movió nada en el sistema'),
    ).toBeInTheDocument();
  });

  it('still shows the correct destination reminder and a re-armed field, and no exception button', () => {
    render(<QuickSortMobileStagePosition {...baseProps()} rejectedCode="POS-99" />);
    expect(screen.getByText('Llevar a')).toBeInTheDocument();
    expect(screen.getAllByText('POS-04').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/escanear posición/i)).toBeInTheDocument();
    expect(screen.queryByText('Marcar excepción y seguir')).not.toBeInTheDocument();
  });
});

describe('QuickSortMobileStagePosition — accessibility floor', () => {
  it('keeps the footer action between 56 and 60px', () => {
    render(<QuickSortMobileStagePosition {...baseProps()} />);
    const btn = screen.getByText('Cancelar y volver al paso 1').closest('button')!;
    expect(btn.className).toMatch(/h-\[5[6-9]px\]|h-\[60px\]/);
  });

  it('keeps recent-scan rows at or above 44px', () => {
    const scans: QuickSortScanEvent[] = [
      { code: 'PKG-002', zoneCode: 'POS-04', zoneName: 'Zona frente a Andén 4', at: new Date(), status: 'ok' },
    ];
    render(<QuickSortMobileStagePosition {...baseProps()} scans={scans} />);
    expect(screen.getByTestId('quicksort-recent-scan').className).toMatch(/min-h-\[44px\]/);
  });

  // spec-68 Fase 6 accessibility sweep (6.3), same contract as
  // QuickSortMobileDock — this screen has no visible title, so it needs
  // exactly one top-level heading whenever it is the only content on the
  // route.
  it('carries exactly one visually-hidden <h1> naming the current state, in both variants', () => {
    const { rerender } = render(<QuickSortMobileStagePosition {...baseProps()} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/POS-04/);

    rerender(<QuickSortMobileStagePosition {...baseProps()} rejectedCode="POS-99" />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/incorrecta/i);
  });
});
