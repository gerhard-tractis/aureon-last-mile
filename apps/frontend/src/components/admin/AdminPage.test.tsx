import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminPage } from './AdminPage';

vi.mock('./UserManagement', () => ({ UserManagement: () => <div data-testid="user-mgmt" /> }));
vi.mock('./ClientManagement', () => ({ ClientManagement: () => <div data-testid="client-mgmt" /> }));
vi.mock('./PickupPointManagement', () => ({ PickupPointManagement: () => <div data-testid="pp-mgmt" /> }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('tab=users'),
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('@/lib/stores/clientStore', () => ({
  useClientStore: () => ({ resetAll: vi.fn() }),
}));
vi.mock('@/lib/stores/pickupPointStore', () => ({
  usePickupPointStore: () => ({ resetAll: vi.fn() }),
}));
vi.mock('@/lib/stores/adminStore', () => ({
  useAdminStore: () => ({ setCreateFormOpen: vi.fn(), setEditFormOpen: vi.fn(), setDeleteConfirmOpen: vi.fn() }),
}));

describe('AdminPage', () => {
  it('renders tabs for all three entities', () => {
    render(<AdminPage userRole="admin" />);
    expect(screen.getByRole('tab', { name: /usuarios/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /clientes/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /puntos de retiro/i })).toBeDefined();
  });

  it('shows users tab content by default', () => {
    render(<AdminPage userRole="admin" />);
    expect(screen.getByTestId('user-mgmt')).toBeDefined();
  });
});
