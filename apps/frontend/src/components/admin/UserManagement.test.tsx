/**
 * UserManagement Component Tests
 * Integration tests for the user management interface (no outer layout wrappers)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { UserManagement } from './UserManagement';
import type { User } from '@/lib/api/users';

// Mock all the child components
vi.mock('./UserListHeader', () => ({
  UserListHeader: () => <div data-testid="user-list-header">User List Header</div>,
}));

vi.mock('./UserTable', () => ({
  UserTable: ({ users, isLoading }: any) => (
    <div data-testid="user-table">
      User Table - {isLoading ? 'Loading' : `${users?.length || 0} users`}
    </div>
  ),
}));

vi.mock('./UserForm', () => ({
  UserForm: ({ mode, userId }: any) => (
    <div data-testid="user-form">
      User Form - {mode} {userId || ''}
    </div>
  ),
}));

vi.mock('./DeleteConfirmationModal', () => ({
  DeleteConfirmationModal: () => (
    <div data-testid="delete-modal">Delete Confirmation Modal</div>
  ),
}));

// Mock users data
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
];

// Create mock return objects that can be reconfigured
let mockUsersReturn = {
  data: mockUsers as User[] | undefined | null,
  isLoading: false,
};

let mockAdminStoreReturn = {
  isCreateFormOpen: false,
  isEditFormOpen: false,
  isDeleteConfirmOpen: false,
  selectedUserId: null as string | null,
  setDeleteConfirmOpen: vi.fn(),
};

// Mock the hooks
vi.mock('@/hooks/useUsers', () => ({
  useUsers: vi.fn(() => mockUsersReturn),
  useDeleteUser: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/lib/stores/adminStore', () => ({
  useAdminStore: vi.fn(() => mockAdminStoreReturn),
}));

describe('UserManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsersReturn = {
      data: mockUsers,
      isLoading: false,
    };
    mockAdminStoreReturn = {
      isCreateFormOpen: false,
      isEditFormOpen: false,
      isDeleteConfirmOpen: false,
      selectedUserId: null,
      setDeleteConfirmOpen: vi.fn(),
    };
  });

  describe('Layout and Structure', () => {
    it('should NOT render outer min-h-screen wrapper (AdminPage handles layout)', () => {
      const { container } = render(<UserManagement userRole="admin" />);

      expect(container.querySelector('.min-h-screen')).toBeFalsy();
      expect(container.querySelector('.max-w-7xl')).toBeFalsy();
    });
  });

  describe('Component Rendering', () => {
    it('should render UserListHeader', () => {
      render(<UserManagement userRole="admin" />);

      expect(screen.getByTestId('user-list-header')).toBeInTheDocument();
    });

    it('should render UserTable', () => {
      render(<UserManagement userRole="admin" />);

      expect(screen.getByTestId('user-table')).toBeInTheDocument();
    });

    it('should always render DeleteConfirmationModal', () => {
      render(<UserManagement userRole="admin" />);

      expect(screen.getByTestId('delete-modal')).toBeInTheDocument();
    });
  });

  describe('Data Fetching', () => {
    it('should pass users data to UserTable', () => {
      render(<UserManagement userRole="admin" />);

      expect(screen.getByText(/2 users/)).toBeInTheDocument();
    });

    it('should pass isLoading state to UserTable', () => {
      mockUsersReturn.data = [];
      mockUsersReturn.isLoading = true;

      render(<UserManagement userRole="admin" />);

      expect(screen.getByText(/Loading/)).toBeInTheDocument();
    });

    it('should handle undefined users data gracefully', () => {
      mockUsersReturn.data = undefined;
      mockUsersReturn.isLoading = false;

      render(<UserManagement userRole="admin" />);

      expect(screen.getByText(/0 users/)).toBeInTheDocument();
    });
  });

  describe('Modal Visibility - Create Form', () => {
    it('should not render UserForm when isCreateFormOpen is false', () => {
      render(<UserManagement userRole="admin" />);

      expect(screen.queryByTestId('user-form')).not.toBeInTheDocument();
    });

    it('should render UserForm in create mode when isCreateFormOpen is true', () => {
      mockAdminStoreReturn.isCreateFormOpen = true;
      mockAdminStoreReturn.isEditFormOpen = false;
      mockAdminStoreReturn.selectedUserId = null;

      render(<UserManagement userRole="admin" />);

      expect(screen.getByTestId('user-form')).toBeInTheDocument();
      expect(screen.getByText(/User Form - create/)).toBeInTheDocument();
    });
  });

  describe('Modal Visibility - Edit Form', () => {
    it('should not render UserForm when isEditFormOpen is false', () => {
      render(<UserManagement userRole="admin" />);

      expect(screen.queryByTestId('user-form')).not.toBeInTheDocument();
    });

    it('should not render UserForm when isEditFormOpen is true but selectedUserId is null', () => {
      mockAdminStoreReturn.isCreateFormOpen = false;
      mockAdminStoreReturn.isEditFormOpen = true;
      mockAdminStoreReturn.selectedUserId = null;

      render(<UserManagement userRole="admin" />);

      expect(screen.queryByTestId('user-form')).not.toBeInTheDocument();
    });

    it('should render UserForm in edit mode when isEditFormOpen is true and selectedUserId is set', () => {
      mockAdminStoreReturn.isCreateFormOpen = false;
      mockAdminStoreReturn.isEditFormOpen = true;
      mockAdminStoreReturn.selectedUserId = '123';

      render(<UserManagement userRole="admin" />);

      expect(screen.getByTestId('user-form')).toBeInTheDocument();
      expect(screen.getByText(/User Form - edit 123/)).toBeInTheDocument();
    });
  });

  describe('Integration with Child Components', () => {
    it('should pass empty array to UserTable when users is null', () => {
      mockUsersReturn.data = null;
      mockUsersReturn.isLoading = false;

      render(<UserManagement userRole="admin" />);

      expect(screen.getByText(/0 users/)).toBeInTheDocument();
    });

    it('should update when users data changes', async () => {
      const { rerender } = render(<UserManagement userRole="admin" />);

      expect(screen.getByText(/2 users/)).toBeInTheDocument();

      mockUsersReturn.data = [
        ...mockUsers,
        {
          id: '3',
          email: 'new@test.com',
          full_name: 'New User',
          role: 'pickup_crew',
          operator_id: 'op-1',
          created_at: '2026-02-17T12:00:00Z',
          deleted_at: null,
        },
      ];
      mockUsersReturn.isLoading = false;

      rerender(<UserManagement userRole="admin" />);

      await waitFor(() => {
        expect(screen.getByText(/3 users/)).toBeInTheDocument();
      });
    });
  });
});
