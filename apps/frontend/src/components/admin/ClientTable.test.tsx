import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientTable } from './ClientTable';

vi.mock('@/lib/stores/clientStore', () => ({
  useClientStore: () => ({
    setEditFormOpen: vi.fn(),
    setDeleteConfirmOpen: vi.fn(),
  }),
}));

const mockClients = [
  { id: '1', name: 'Easy', slug: 'easy', is_active: true, pickup_point_count: 3, created_at: '2026-01-01', operator_id: 'op1', connector_type: null, updated_at: '2026-01-01', deleted_at: null },
  { id: '2', name: 'Flash', slug: 'flash', is_active: false, pickup_point_count: 0, created_at: '2026-01-02', operator_id: 'op1', connector_type: null, updated_at: '2026-01-02', deleted_at: null },
];

describe('ClientTable', () => {
  it('renders client rows', () => {
    render(<ClientTable clients={mockClients} isLoading={false} userRole="admin" />);
    expect(screen.getByText('Easy')).toBeDefined();
    expect(screen.getByText('Flash')).toBeDefined();
  });

  it('shows loading skeleton when loading', () => {
    render(<ClientTable clients={[]} isLoading={true} userRole="admin" />);
    expect(screen.queryByText('Easy')).toBeNull();
  });

  it('shows empty message when no clients', () => {
    render(<ClientTable clients={[]} isLoading={false} userRole="admin" />);
    expect(screen.getByText('No hay clientes')).toBeDefined();
  });

  it('hides delete button for operations_manager', () => {
    render(<ClientTable clients={mockClients} isLoading={false} userRole="operations_manager" />);
    expect(screen.queryByText('Eliminar')).toBeNull();
  });
});
