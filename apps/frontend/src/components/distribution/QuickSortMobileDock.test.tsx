import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    onSendToConsolidation: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe('QuickSortMobileDock — 4h/4j normal destination', () => {
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
});
