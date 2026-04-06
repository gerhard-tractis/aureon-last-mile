/**
 * UserTable Component Tests
 * Tests DataTable rendering and action buttons
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserTable } from './UserTable';
import type { User } from '@/lib/api/users';

// Create mock return object that can be reconfigured
let mockAdminStoreReturn = {
  setEditFormOpen: vi.fn(),
  setDeleteConfirmOpen: vi.fn(),
};

// Mock the adminStore
vi.mock('@/lib/stores/adminStore', () => ({
  useAdminStore: vi.fn(() => mockAdminStoreReturn),
}));

// Mock dateFormat utility
vi.mock('@/lib/utils/dateFormat', () => ({
  formatDateTimeShort: vi.fn(() => '16/02/2026 14:30'),
}));

describe('UserTable', () => {
  const mockUsers: User[] = [
    {
      id: '1',
      email: 'admin@test.com',
      full_name: 'Admin User',
      role: 'admin',
      operator_id: 'op-1',
      created_at: '2026-02-16T14:30:00Z',
      deleted_at: null,
    },
    {
      id: '2',
      email: 'manager@test.com',
      full_name: 'Manager User',
      role: 'operations_manager',
      operator_id: 'op-1',
      created_at: '2026-02-15T10:00:00Z',
      deleted_at: null,
    },
    {
      id: '3',
      email: 'crew@test.com',
      full_name: 'Crew User',
      role: 'pickup_crew',
      operator_id: 'op-1',
      created_at: '2026-02-14T08:00:00Z',
      deleted_at: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminStoreReturn = {
      setEditFormOpen: vi.fn(),
      setDeleteConfirmOpen: vi.fn(),
    };
  });

  describe('Loading State', () => {
    it('should display loading skeleton when isLoading is true', () => {
      const { container } = render(<UserTable users={[]} isLoading={true} />);
      expect(container.querySelector('.animate-pulse')).toBeTruthy();
    });
  });

  describe('Empty State', () => {
    it('should display empty message when users array is empty', () => {
      render(<UserTable users={[]} isLoading={false} />);
      expect(screen.getByText('No hay usuarios')).toBeInTheDocument();
    });

    it('should display empty message when users is null', () => {
      render(<UserTable users={null as any} isLoading={false} />);
      expect(screen.getByText('No hay usuarios')).toBeInTheDocument();
    });
  });

  describe('Table Rendering', () => {
    it('should render column headers', () => {
      render(<UserTable users={mockUsers} isLoading={false} />);

      expect(screen.getByText('Nombre')).toBeInTheDocument();
      expect(screen.getByText('Email')).toBeInTheDocument();
      expect(screen.getByText('Rol')).toBeInTheDocument();
      expect(screen.getByText('Creado')).toBeInTheDocument();
      expect(screen.getByText('Acciones')).toBeInTheDocument();
    });

    it('should render all users in the table', () => {
      render(<UserTable users={mockUsers} isLoading={false} />);

      expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      expect(screen.getByText('Admin User')).toBeInTheDocument();
      expect(screen.getByText('manager@test.com')).toBeInTheDocument();
      expect(screen.getByText('Manager User')).toBeInTheDocument();
      expect(screen.getByText('crew@test.com')).toBeInTheDocument();
      expect(screen.getByText('Crew User')).toBeInTheDocument();
    });

    it('should render role badges with correct display names', () => {
      render(<UserTable users={mockUsers} isLoading={false} />);

      expect(screen.getByText('Administrator')).toBeInTheDocument();
      expect(screen.getByText('Operations Manager')).toBeInTheDocument();
      expect(screen.getByText('Pickup Crew')).toBeInTheDocument();
    });

    it('should format dates correctly', () => {
      render(<UserTable users={mockUsers} isLoading={false} />);

      // Should display formatted dates (mocked to return 16/02/2026 14:30)
      const formattedDates = screen.getAllByText('16/02/2026 14:30');
      expect(formattedDates).toHaveLength(3); // One for each user
    });
  });

  describe('Action Buttons', () => {
    it('should render Editar and Eliminar buttons for each user', () => {
      render(<UserTable users={mockUsers} isLoading={false} />);

      const editButtons = screen.getAllByText('Editar');
      const deleteButtons = screen.getAllByText('Eliminar');

      expect(editButtons).toHaveLength(3);
      expect(deleteButtons).toHaveLength(3);
    });

    it('should call setEditFormOpen when clicking Editar button', () => {
      const mockSetEditFormOpen = vi.fn();
      mockAdminStoreReturn.setEditFormOpen = mockSetEditFormOpen;

      render(<UserTable users={mockUsers} isLoading={false} />);

      const editButtons = screen.getAllByText('Editar');
      fireEvent.click(editButtons[0]); // Click first Editar button

      expect(mockSetEditFormOpen).toHaveBeenCalledWith(true, '1');
    });

    it('should call setDeleteConfirmOpen when clicking Eliminar button', () => {
      const mockSetDeleteConfirmOpen = vi.fn();
      mockAdminStoreReturn.setDeleteConfirmOpen = mockSetDeleteConfirmOpen;

      render(<UserTable users={mockUsers} isLoading={false} />);

      const deleteButtons = screen.getAllByText('Eliminar');
      fireEvent.click(deleteButtons[1]); // Click second Eliminar button

      expect(mockSetDeleteConfirmOpen).toHaveBeenCalledWith(true, '2');
    });
  });

  describe('Accessibility', () => {
    it('should have proper table structure', () => {
      const { container } = render(<UserTable users={mockUsers} isLoading={false} />);

      expect(container.querySelector('table')).toBeInTheDocument();
      expect(container.querySelector('thead')).toBeInTheDocument();
      expect(container.querySelector('tbody')).toBeInTheDocument();
    });

    it('should have scope attribute on th elements', () => {
      const { container } = render(<UserTable users={mockUsers} isLoading={false} />);

      const headers = container.querySelectorAll('th');
      expect(headers.length).toBeGreaterThan(0);
    });
  });
});
