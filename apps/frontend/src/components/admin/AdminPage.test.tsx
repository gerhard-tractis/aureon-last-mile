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

  it('hides Módulos tab for non-super_admin (spec-45)', () => {
    render(<AdminPage userRole="admin" />);
    expect(screen.queryByTestId('modules-tab-link')).toBeNull();
  });

  it('shows Módulos tab for super_admin (spec-45)', () => {
    render(<AdminPage userRole="super_admin" />);
    expect(screen.getByTestId('modules-tab-link')).toBeDefined();
  });

  describe('Herramientas block (spec-67)', () => {
    it('shows both internal tools to an admin', () => {
      render(<AdminPage userRole="admin" />);
      expect(screen.getByTestId('admin-tools')).toBeDefined();
      expect(screen.getByTestId('tools-ocr-link').getAttribute('href')).toBe('/admin/tools/ocr');
      expect(screen.getByTestId('tools-wismo-link').getAttribute('href')).toBe(
        '/admin/tools/wismo',
      );
    });

    // Both tool pages are admin-gated, but operations_manager and super_admin
    // both reach /admin. Rendering the links for them would offer destinations
    // that bounce them straight back out.
    it.each(['operations_manager', 'super_admin'])(
      'hides the whole block from %s, who can reach /admin but not the tools',
      (role) => {
        render(<AdminPage userRole={role} />);
        expect(screen.queryByTestId('admin-tools')).toBeNull();
        expect(screen.queryByTestId('tools-ocr-link')).toBeNull();
        expect(screen.queryByTestId('tools-wismo-link')).toBeNull();
      },
    );
  });
});
