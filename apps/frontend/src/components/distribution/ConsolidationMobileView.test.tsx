import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConsolidationMobileView } from './ConsolidationMobileView';
import type { ConsolidationPackage } from '@/hooks/distribution/useConsolidation';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

const NOW = new Date('2026-08-25T15:00:00.000Z'); // Santiago: still 2026-08-25 civil date

function pkg(overrides: Partial<ConsolidationPackage> = {}): ConsolidationPackage {
  return {
    id: 'pkg-1',
    label: 'BULTO-1',
    dock_zone_id: 'zone-cons',
    order_id: 'order-1',
    delivery_date: '2026-08-25',
    comunaId: 'c-1',
    comunaName: 'Quilicura',
    ...overrides,
  };
}

const zoneA: DockZoneRecord = {
  id: 'zone-a1',
  name: 'Zona Norte',
  code: 'A3',
  is_consolidation: false,
  comunas: [{ id: 'c-1', nombre: 'Quilicura' }],
  is_active: true,
  operator_id: 'op-1',
  capacity: 180,
};

const consZone: DockZoneRecord = {
  id: 'zone-cons',
  name: 'Consolidación',
  code: 'CONS',
  is_consolidation: true,
  comunas: [],
  is_active: true,
  operator_id: 'op-1',
  capacity: null,
};

const zones = [zoneA, consZone];

function renderView(overrides: Partial<React.ComponentProps<typeof ConsolidationMobileView>> = {}) {
  const onToggleSelect = vi.fn();
  const utils = render(
    <ConsolidationMobileView
      packages={[]}
      zones={zones}
      selectedIds={new Set()}
      onToggleSelect={onToggleSelect}
      now={NOW}
      {...overrides}
    />,
  );
  return { ...utils, onToggleSelect };
}

describe('ConsolidationMobileView (4f)', () => {
  it('shows an empty state when there is nothing in consolidation', () => {
    renderView();
    expect(screen.getByText('Sin paquetes en consolidación')).toBeInTheDocument();
  });

  it('splits packages into URGENTES (hoy/mañana) and PRÓXIMOS with their counts', () => {
    renderView({
      packages: [
        pkg({ id: 'a', delivery_date: '2026-08-25' }), // hoy
        pkg({ id: 'b', delivery_date: '2026-08-26' }), // mañana
        pkg({ id: 'c', delivery_date: '2026-09-01' }), // próximo
      ],
    });
    const urgentes = screen.getByTestId('consolidation-section-urgentes');
    expect(within(urgentes).getByText('URGENTES · HOY Y MAÑANA')).toBeInTheDocument();
    expect(within(urgentes).getByText('2')).toBeInTheDocument();

    const proximos = screen.getByTestId('consolidation-section-proximos');
    expect(within(proximos).getByText('PRÓXIMOS')).toBeInTheDocument();
    expect(within(proximos).getByText('1')).toBeInTheDocument();
  });

  it('counts an overdue package as urgente too — reuses isLeavingSoon, not a re-derived window', () => {
    renderView({ packages: [pkg({ id: 'a', delivery_date: '2026-08-20' })] });
    expect(screen.getByTestId('consolidation-section-urgentes')).toBeInTheDocument();
    expect(screen.queryByTestId('consolidation-section-proximos')).not.toBeInTheDocument();
  });

  it('omits a section entirely when it has no packages', () => {
    renderView({ packages: [pkg({ id: 'a', delivery_date: '2026-09-01' })] });
    expect(screen.queryByTestId('consolidation-section-urgentes')).not.toBeInTheDocument();
    expect(screen.getByTestId('consolidation-section-proximos')).toBeInTheDocument();
  });

  it('renders comuna → andén · entrega {fecha} using the comuna match, not dock_zone_id', () => {
    // dock_zone_id points at the consolidation zone itself (that's why the
    // package is here) — the destination line must come from the comuna
    // match against zoneA, not from dock_zone_id.
    renderView({ packages: [pkg({ id: 'a', delivery_date: '2026-08-25', comunaId: 'c-1', comunaName: 'Quilicura' })] });
    expect(screen.getByText('Quilicura → A3 · entrega hoy')).toBeInTheDocument();
  });

  it('tags a hoy package HOY and a mañana package MAÑANA', () => {
    renderView({
      packages: [
        pkg({ id: 'a', delivery_date: '2026-08-25' }),
        pkg({ id: 'b', delivery_date: '2026-08-26' }),
      ],
    });
    const rowA = screen.getByTestId('consolidation-row-a');
    const rowB = screen.getByTestId('consolidation-row-b');
    expect(within(rowA).getByText('HOY')).toBeInTheDocument();
    expect(within(rowB).getByText('MAÑANA')).toBeInTheDocument();
  });

  it('flags a package whose comuna has no matching andén as SIN ANDÉN, in the error palette', () => {
    renderView({
      packages: [pkg({ id: 'a', delivery_date: '2026-08-25', comunaId: 'c-999', comunaName: 'Til Til' })],
    });
    const row = screen.getByTestId('consolidation-row-a');
    expect(within(row).getByText('SIN ANDÉN')).toBeInTheDocument();
    expect(row).toHaveAttribute('data-tone', 'error');
  });

  it('flags a package with no comuna at all as SIN ANDÉN too', () => {
    renderView({
      packages: [pkg({ id: 'a', delivery_date: '2026-08-25', comunaId: null, comunaName: null })],
    });
    const row = screen.getByTestId('consolidation-row-a');
    expect(within(row).getByText('SIN ANDÉN')).toBeInTheDocument();
    expect(row).toHaveAttribute('data-tone', 'error');
  });

  it('SIN ANDÉN is a distinct palette from urgency — error wins even inside URGENTES', () => {
    renderView({
      packages: [pkg({ id: 'a', delivery_date: '2026-08-25', comunaId: null, comunaName: null })],
    });
    const row = screen.getByTestId('consolidation-row-a');
    expect(row.className).toContain('status-error');
    expect(row.className).not.toContain('status-warning');
  });

  it('a normal urgent (mapped) row gets the warning palette, not error', () => {
    renderView({ packages: [pkg({ id: 'a', delivery_date: '2026-08-25' })] });
    const row = screen.getByTestId('consolidation-row-a');
    expect(row).toHaveAttribute('data-tone', 'warning');
  });

  it('toggles selection on row click and calls back with the package id', async () => {
    const user = userEvent.setup();
    const { onToggleSelect } = renderView({ packages: [pkg({ id: 'a' })] });
    await user.click(screen.getByRole('checkbox', { name: /BULTO-1/i }));
    expect(onToggleSelect).toHaveBeenCalledWith('a');
  });

  it('shows the checkbox as checked when the id is in selectedIds', () => {
    renderView({ packages: [pkg({ id: 'a' })], selectedIds: new Set(['a']) });
    expect(screen.getByRole('checkbox', { name: /BULTO-1/i })).toBeChecked();
  });

  it('shows a running N SELECCIONADOS count only once something is selected', () => {
    const { rerender } = render(
      <ConsolidationMobileView
        packages={[pkg({ id: 'a' }), pkg({ id: 'b', label: 'BULTO-2' })]}
        zones={zones}
        selectedIds={new Set()}
        onToggleSelect={vi.fn()}
        now={NOW}
      />,
    );
    expect(screen.queryByTestId('consolidation-selection-count')).not.toBeInTheDocument();

    rerender(
      <ConsolidationMobileView
        packages={[pkg({ id: 'a' }), pkg({ id: 'b', label: 'BULTO-2' })]}
        zones={zones}
        selectedIds={new Set(['a', 'b'])}
        onToggleSelect={vi.fn()}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('consolidation-selection-count')).toHaveTextContent('2 SELECCIONADOS');
  });

  it('singularizes the selection count for exactly one', () => {
    renderView({ packages: [pkg({ id: 'a' })], selectedIds: new Set(['a']) });
    expect(screen.getByTestId('consolidation-selection-count')).toHaveTextContent('1 SELECCIONADO');
  });

  describe('accessibility floor', () => {
    it('urgent rows meet the 60px floor', () => {
      renderView({ packages: [pkg({ id: 'a', delivery_date: '2026-08-25' })] });
      expect(screen.getByTestId('consolidation-row-a').className).toMatch(/min-h-\[?(6\d|[7-9]\d)/);
    });

    it('próximos rows meet the 52px floor', () => {
      renderView({ packages: [pkg({ id: 'a', delivery_date: '2026-09-01' })] });
      expect(screen.getByTestId('consolidation-row-a').className).toMatch(/min-h-\[?(5[2-9]|[6-9]\d)/);
    });

    it('the checkbox glyph is at least 22px', () => {
      renderView({ packages: [pkg({ id: 'a' })] });
      const row = screen.getByTestId('consolidation-row-a');
      const glyph = row.querySelector('[aria-hidden="true"]')!;
      expect(glyph.className).toMatch(/h-\[?(2[2-9]|[3-9]\d)/);
    });
  });
});
