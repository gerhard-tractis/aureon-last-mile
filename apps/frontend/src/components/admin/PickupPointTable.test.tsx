import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PickupPointTable } from './PickupPointTable';

vi.mock('@/lib/stores/pickupPointStore', () => ({
  usePickupPointStore: () => ({
    setEditFormOpen: vi.fn(),
    setDeleteConfirmOpen: vi.fn(),
  }),
}));

const mockPoints = [
  { id: '1', name: 'Bodega Central', code: 'BC-001', client_name: 'Easy', is_active: true, pickup_locations: [{ name: 'Main', address: 'Av Libertador 123' }], operator_id: 'op1', tenant_client_id: 'c1', intake_method: 'manual', created_at: '2026-01-01', updated_at: '2026-01-01', deleted_at: null },
];

describe('PickupPointTable', () => {
  it('renders pickup point rows', () => {
    render(<PickupPointTable pickupPoints={mockPoints} isLoading={false} userRole="admin" />);
    expect(screen.getByText('Bodega Central')).toBeDefined();
    expect(screen.getByText('BC-001')).toBeDefined();
    expect(screen.getByText('Easy')).toBeDefined();
  });

  it('shows empty message', () => {
    render(<PickupPointTable pickupPoints={[]} isLoading={false} userRole="admin" />);
    expect(screen.getByText('No hay puntos de retiro')).toBeDefined();
  });

  it('hides delete button for operations_manager', () => {
    render(<PickupPointTable pickupPoints={mockPoints} isLoading={false} userRole="operations_manager" />);
    expect(screen.queryByText('Eliminar')).toBeNull();
  });
});
