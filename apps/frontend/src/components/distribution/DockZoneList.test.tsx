// apps/frontend/src/components/distribution/DockZoneList.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DockZoneList } from './DockZoneList';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

vi.mock('@/hooks/distribution/useDockZones', () => ({
  useUpdateDockZone: vi.fn(() => ({ mutate: vi.fn() })),
  useDeleteDockZone: vi.fn(() => ({ mutate: vi.fn() })),
}));

const zones: DockZoneRecord[] = [
  { id: 'consol', name: 'Consolidación', code: 'CONSOL', is_consolidation: true, comunas: [], is_active: true, operator_id: 'op-1' },
  { id: 'zone-1', name: 'Andén 1', code: 'DOCK-001', is_consolidation: false, comunas: ['las condes', 'vitacura'], is_active: true, operator_id: 'op-1' },
];

describe('DockZoneList', () => {
  it('renders list of zones', () => {
    render(<DockZoneList zones={zones} operatorId="op-1" onEdit={() => {}} />);
    expect(screen.getByText('Consolidación')).toBeInTheDocument();
    expect(screen.getByText('Andén 1')).toBeInTheDocument();
  });

  it('shows empty state when no zones', () => {
    render(<DockZoneList zones={[]} operatorId="op-1" onEdit={() => {}} />);
    expect(screen.getByText(/no hay andenes/i)).toBeInTheDocument();
  });

  it('shows zone codes', () => {
    render(<DockZoneList zones={zones} operatorId="op-1" onEdit={() => {}} />);
    expect(screen.getByText('DOCK-001')).toBeInTheDocument();
    expect(screen.getByText('CONSOL')).toBeInTheDocument();
  });

  it('does not show delete button for consolidation zone', () => {
    render(<DockZoneList zones={zones} operatorId="op-1" onEdit={() => {}} />);
    // Only the non-consolidation zone should have a delete option
    const deleteButtons = screen.queryAllByText(/eliminar/i);
    expect(deleteButtons).toHaveLength(1);
  });

  it('shows Agregar andén button when onAdd is provided', () => {
    render(<DockZoneList zones={zones} operatorId="op-1" onEdit={() => {}} onAdd={() => {}} />);
    expect(screen.getByRole('button', { name: /agregar andén/i })).toBeInTheDocument();
  });

  it('shows Agregar andén button in empty state when onAdd is provided', () => {
    render(<DockZoneList zones={[]} operatorId="op-1" onEdit={() => {}} onAdd={() => {}} />);
    expect(screen.getByRole('button', { name: /agregar andén/i })).toBeInTheDocument();
  });

  it('does not show Agregar andén button when onAdd is not provided', () => {
    render(<DockZoneList zones={zones} operatorId="op-1" onEdit={() => {}} />);
    expect(screen.queryByRole('button', { name: /agregar andén/i })).not.toBeInTheDocument();
  });

  it('calls onAdd when Agregar andén button is clicked', () => {
    const onAdd = vi.fn();
    render(<DockZoneList zones={zones} operatorId="op-1" onEdit={() => {}} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /agregar andén/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  describe('print-label links', () => {
    it('renders an Imprimir link per row with the correct href and target', () => {
      render(<DockZoneList zones={zones} operatorId="op-1" onEdit={() => {}} />);
      const consolLink = screen.getByRole('link', { name: /imprimir DOCK-001|imprimir andén 1/i });
      expect(consolLink).toHaveAttribute(
        'href',
        '/app/distribution/settings/labels/print?zoneIds=zone-1',
      );
      expect(consolLink).toHaveAttribute('target', '_blank');
      expect(consolLink).toHaveAttribute('rel', expect.stringContaining('noopener'));
    });

    it('also renders an Imprimir link for the consolidation zone (single-row print is allowed)', () => {
      render(<DockZoneList zones={zones} operatorId="op-1" onEdit={() => {}} />);
      // Two rows, two per-row links
      const links = screen.getAllByRole('link', { name: /imprimir DOCK-001|imprimir CONSOL|imprimir andén|imprimir consolidación/i });
      const hrefs = links.map((l) => l.getAttribute('href'));
      expect(hrefs).toContain('/app/distribution/settings/labels/print?zoneIds=zone-1');
      expect(hrefs).toContain('/app/distribution/settings/labels/print?zoneIds=consol');
    });

    it('renders an Imprimir todos link in the header with all active non-consolidation zone ids', () => {
      const manyZones: DockZoneRecord[] = [
        ...zones,
        { id: 'zone-2', name: 'Andén 2', code: 'DOCK-002', is_consolidation: false, comunas: [], is_active: true, operator_id: 'op-1' },
        { id: 'zone-3', name: 'Andén 3 (inactivo)', code: 'DOCK-003', is_consolidation: false, comunas: [], is_active: false, operator_id: 'op-1' },
      ];
      render(<DockZoneList zones={manyZones} operatorId="op-1" onEdit={() => {}} onAdd={() => {}} />);
      const link = screen.getByRole('link', { name: /imprimir todos/i });
      // Should include zone-1 and zone-2 (active non-consolidation), exclude consol (is_consolidation) and zone-3 (inactive)
      expect(link).toHaveAttribute(
        'href',
        '/app/distribution/settings/labels/print?zoneIds=zone-1,zone-2',
      );
      expect(link).toHaveAttribute('target', '_blank');
    });

    it('does not render Imprimir todos when there are no printable zones', () => {
      const onlyConsol: DockZoneRecord[] = [zones[0]]; // just the consolidation zone
      render(<DockZoneList zones={onlyConsol} operatorId="op-1" onEdit={() => {}} onAdd={() => {}} />);
      expect(screen.queryByRole('link', { name: /imprimir todos/i })).not.toBeInTheDocument();
    });
  });
});
