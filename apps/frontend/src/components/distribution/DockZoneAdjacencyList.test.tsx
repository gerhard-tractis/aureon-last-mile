import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DockZoneAdjacencyList } from './DockZoneAdjacencyList';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

const mockPairs = [
  {
    id: 'pair-1',
    zoneAId: 'zone-a',
    zoneAName: 'Andén A',
    zoneACode: 'A',
    zoneBId: 'zone-b',
    zoneBName: 'Andén B',
    zoneBCode: 'B',
  },
];

const addMutate = vi.fn();
const removeMutate = vi.fn();

vi.mock('@/hooks/distribution/useDockZoneAdjacency', () => ({
  useDockZoneAdjacencyPairs: vi.fn(() => ({ data: mockPairs, isLoading: false })),
  useAddDockZoneAdjacencyPair: vi.fn(() => ({ mutate: addMutate, isPending: false, isError: false, error: null })),
  useRemoveDockZoneAdjacencyPair: vi.fn(() => ({ mutate: removeMutate, isPending: false })),
}));

const ZONES: DockZoneRecord[] = [
  { id: 'zone-a', name: 'Andén A', code: 'A', is_consolidation: false, comunas: [], is_active: true, operator_id: 'op-1', capacity: null },
  { id: 'zone-b', name: 'Andén B', code: 'B', is_consolidation: false, comunas: [], is_active: true, operator_id: 'op-1', capacity: null },
  { id: 'zone-c', name: 'Andén C', code: 'C', is_consolidation: false, comunas: [], is_active: true, operator_id: 'op-1', capacity: null },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DockZoneAdjacencyList — role gate', () => {
  it('shows the add form and a "Quitar" button for a manager role (ops_leader)', () => {
    render(<DockZoneAdjacencyList operatorId="op-1" zones={ZONES} role="ops_leader" />);
    expect(screen.getByRole('button', { name: /Agregar adyacencia/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quitar/i })).toBeInTheDocument();
  });

  it.each(['operations_manager', 'admin', 'super_admin'])(
    'shows the add form for %s',
    (role) => {
      render(<DockZoneAdjacencyList operatorId="op-1" zones={ZONES} role={role} />);
      expect(screen.getByRole('button', { name: /Agregar adyacencia/i })).toBeInTheDocument();
    },
  );

  it('hides the add form and the "Quitar" button for a non-manager role (warehouse_staff) — read-only list', () => {
    render(<DockZoneAdjacencyList operatorId="op-1" zones={ZONES} role="warehouse_staff" />);
    expect(screen.queryByRole('button', { name: /Agregar adyacencia/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Quitar/i })).not.toBeInTheDocument();
    // The pair itself is still visible — read-only, not hidden entirely.
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('hides the add form for a null role', () => {
    render(<DockZoneAdjacencyList operatorId="op-1" zones={ZONES} role={null} />);
    expect(screen.queryByRole('button', { name: /Agregar adyacencia/i })).not.toBeInTheDocument();
  });
});

describe('DockZoneAdjacencyList — list rendering', () => {
  it('renders each dedup\'d pair once', () => {
    render(<DockZoneAdjacencyList operatorId="op-1" zones={ZONES} role="admin" />);
    expect(screen.getAllByText('A')).toHaveLength(1);
    expect(screen.getAllByText('B')).toHaveLength(1);
  });
});

describe('DockZoneAdjacencyList — remove', () => {
  it('calls the remove mutation with the pair\'s zone ids when "Quitar" is clicked', () => {
    render(<DockZoneAdjacencyList operatorId="op-1" zones={ZONES} role="admin" />);
    fireEvent.click(screen.getByRole('button', { name: /Quitar/i }));
    expect(removeMutate).toHaveBeenCalledWith({ dockZoneId: 'zone-a', adjacentZoneId: 'zone-b' });
  });
});
