import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DockZoneList } from './DockZoneList';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

vi.mock('@/hooks/distribution/useDockZones', () => ({
  useUpdateDockZone: vi.fn(() => ({ mutate: vi.fn() })),
  useDeleteDockZone: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock('bwip-js/browser', () => ({
  default: { toSVG: () => '<svg data-testid="bwipjs-svg"></svg>' },
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

  describe('print-label modal', () => {
    it('renders an Imprimir button per zone row', () => {
      render(<DockZoneList zones={zones} operatorId="op-1" onEdit={() => {}} />);
      expect(screen.getByRole('button', { name: /imprimir CONSOL/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /imprimir DOCK-001/i })).toBeInTheDocument();
    });

    it('opens a dialog showing the zone label preview when Imprimir is clicked', () => {
      render(<DockZoneList zones={zones} operatorId="op-1" onEdit={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: /imprimir DOCK-001/i }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      // title shows code · name
      expect(screen.getByRole('heading', { name: /DOCK-001/i })).toBeInTheDocument();
    });

    it('dialog Imprimir button opens the print page with the correct zone id', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      render(<DockZoneList zones={zones} operatorId="op-1" onEdit={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: /imprimir DOCK-001/i }));
      // The dialog footer Imprimir button is the one without an aria-label
      const buttons = screen.getAllByRole('button', { name: /^imprimir$/i });
      fireEvent.click(buttons[buttons.length - 1]);
      expect(openSpy).toHaveBeenCalledWith(
        '/app/distribution/settings/labels/print?zoneIds=zone-1',
        '_blank',
        'noopener,noreferrer',
      );
      openSpy.mockRestore();
    });

    it('renders Imprimir todos button when there are printable zones', () => {
      render(<DockZoneList zones={zones} operatorId="op-1" onEdit={() => {}} onAdd={() => {}} />);
      expect(screen.getByRole('button', { name: /imprimir todos/i })).toBeInTheDocument();
    });

    it('does not render Imprimir todos when no active non-consolidation zones', () => {
      const onlyConsol: DockZoneRecord[] = [zones[0]];
      render(<DockZoneList zones={onlyConsol} operatorId="op-1" onEdit={() => {}} onAdd={() => {}} />);
      expect(screen.queryByRole('button', { name: /imprimir todos/i })).not.toBeInTheDocument();
    });

    it('Imprimir todos dialog opens print page with all active non-consolidation ids', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      const manyZones: DockZoneRecord[] = [
        ...zones,
        { id: 'zone-2', name: 'Andén 2', code: 'DOCK-002', is_consolidation: false, comunas: [], is_active: true, operator_id: 'op-1' },
        { id: 'zone-3', name: 'Andén 3', code: 'DOCK-003', is_consolidation: false, comunas: [], is_active: false, operator_id: 'op-1' },
      ];
      render(<DockZoneList zones={manyZones} operatorId="op-1" onEdit={() => {}} onAdd={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: /imprimir todos/i }));
      const buttons = screen.getAllByRole('button', { name: /^imprimir$/i });
      fireEvent.click(buttons[buttons.length - 1]);
      expect(openSpy).toHaveBeenCalledWith(
        '/app/distribution/settings/labels/print?zoneIds=zone-1,zone-2',
        '_blank',
        'noopener,noreferrer',
      );
      openSpy.mockRestore();
    });
  });
});
