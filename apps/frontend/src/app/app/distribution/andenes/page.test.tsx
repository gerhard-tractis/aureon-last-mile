import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AndenesPage from './page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1', userId: 'user-1', role: 'ops_leader' }),
}));

const zoneA = {
  id: 'zone-a1',
  name: 'Zona Norte',
  code: 'A1',
  is_consolidation: false,
  is_active: true,
  comunas: [{ id: 'c-1', nombre: 'Quilicura' }],
  operator_id: 'op-1',
  capacity: 180,
};

let mockZones: unknown[] = [zoneA];
let mockZonesLoading = false;
vi.mock('@/hooks/distribution/useDockZones', () => ({
  useDockZones: () => ({ data: mockZones, isLoading: mockZonesLoading }),
}));

vi.mock('@/hooks/distribution/useSectorizedByZone', () => ({
  useSectorizedByZone: () => ({ data: { 'zone-a1': 42 } }),
}));

describe('AndenesPage', () => {
  it('renders a titled header with back navigation', () => {
    render(<AndenesPage />);
    expect(screen.getByRole('heading', { name: 'Andenes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /volver/i })).toBeInTheDocument();
  });

  it('renders the dock list with zone data', () => {
    render(<AndenesPage />);
    expect(screen.getByTestId('dock-list-row-zone-a1')).toBeInTheDocument();
  });

  it('shows a loading skeleton while zones are loading', () => {
    mockZonesLoading = true;
    render(<AndenesPage />);
    expect(screen.queryByTestId('dock-list-row-zone-a1')).not.toBeInTheDocument();
    mockZonesLoading = false;
  });

  it('shows the empty state with no active zones', () => {
    mockZones = [];
    render(<AndenesPage />);
    expect(screen.getByText('Sin andenes configurados')).toBeInTheDocument();
    mockZones = [zoneA];
  });

  // spec-68 Fase 6 accessibility sweep (6.3).
  it('carries exactly one top-level heading', () => {
    render(<AndenesPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
