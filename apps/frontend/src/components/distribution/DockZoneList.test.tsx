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
});
