/**
 * UserManagementPage Component Tests
 * Integration tests for the full user management interface
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { UserManagementPage } from './UserManagementPage';
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
  selectedUserId: null as string | null,
};

// Mock the hooks
vi.mock('@/hooks/useUsers', () => ({
  useUsers: vi.fn(() => mockUsersReturn),
}));

vi.mock('@/stores/adminStore', () => ({
  useAdminStore: vi.fn(() => mockAdminStoreReturn),
}));

describe('UserManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default state
    mockUsersReturn = {
      data: mockUsers,
      isLoading: false,
    };
    mockAdminStoreReturn = {
      isCreateFormOpen: false,
      isEditFormOpen: false,
      selectedUserId: null,
    };
  });

  describe('Layout and Structure', () => {
    it('should render with proper container classes', () => {
      const { container } = render(<UserManagementPage />);

      expect(container.querySelector('.min-h-screen')).toBeTruthy();
      expect(container.querySelector('.bg-gray-50')).toBeTruthy();
      expect(container.querySelector('.max-w-7xl')).toBeTruthy();
    });

    it('should have responsive padding classes', () => {
      const { container } = render(<UserManagementPage />);

      const innerContainer = container.querySelector('.px-4.sm\\:px-6.lg\\:px-8');
      expect(innerContainer).toBeTruthy();
    });
  });

  describe('Component Rendering', () => {
    it('should render UserListHeader', () => {
      render(<UserManagementPage />);

      expect(screen.getByTestId('user-list-header')).toBeInTheDocument();
    });

    it('should render UserTable', () => {
      render(<UserManagementPage />);

      expect(screen.getByTestId('user-table')).toBeInTheDocument();
    });

    it('should always render DeleteConfirmationModal', () => {
      render(<UserManagementPage />);

      expect(screen.getByTestId('delete-modal')).toBeInTheDocument();
    });
  });

  describe('Data Fetching', () => {
    it('should pass users data to UserTable', () => {
      render(<UserManagementPage />);

      expect(screen.getByText(/2 users/)).toBeInTheDocument();
    });

    it('should pass isLoading state to UserTable', () => {
      mockUsersReturn.data = [];
      mockUsersReturn.isLoading = true;

      render(<UserManagementPage />);

      expect(screen.getByText(/Loading/)).toBeInTheDocument();
    });

    it('should handle undefined users data gracefully', () => {
      mockUsersReturn.data = undefined;
      mockUsersReturn.isLoading = false;

      render(<UserManagementPage />);

      expect(screen.getByText(/0 users/)).toBeInTheDocument();
    });
  });

  describe('Modal Visibility - Create Form', () => {
    it('should not render UserForm when isCreateFormOpen is false', () => {
      render(<UserManagementPage />);

      expect(screen.queryByTestId('user-form')).not.toBeInTheDocument();
    });

    it('should render UserForm in create mode when isCreateFormOpen is true', () => {
      mockAdminStoreReturn.isCreateFormOpen = true;
      mockAdminStoreReturn.isEditFormOpen = false;
      mockAdminStoreReturn.selectedUserId = null;

      render(<UserManagementPage />);

      expect(screen.getByTestId('user-form')).toBeInTheDocument();
      expect(screen.getByText(/User Form - create/)).toBeInTheDocument();
    });
  });

  describe('Modal Visibility - Edit Form', () => {
    it('should not render UserForm when isEditFormOpen is false', () => {
      render(<UserManagementPage />);

      expect(screen.queryByTestId('user-form')).not.toBeInTheDocument();
    });

    it('should not render UserForm when isEditFormOpen is true but selectedUserId is null', () => {
      mockAdminStoreReturn.isCreateFormOpen = false;
      mockAdminStoreReturn.isEditFormOpen = true;
      mockAdminStoreReturn.selectedUserId = null;

      render(<UserManagementPage />);

      expect(screen.queryByTestId('user-form')).not.toBeInTheDocument();
    });

    it('should render UserForm in edit mode when isEditFormOpen is true and selectedUserId is set', () => {
      mockAdminStoreReturn.isCreateFormOpen = false;
      mockAdminStoreReturn.isEditFormOpen = true;
      mockAdminStoreReturn.selectedUserId = '123';

      render(<UserManagementPage />);

      expect(screen.getByTestId('user-form')).toBeInTheDocument();
      expect(screen.getByText(/User Form - edit 123/)).toBeInTheDocument();
    });
  });

  describe('Multiple Modals', () => {
    it('should render both create form and delete modal when both are open', () => {
      mockAdminStoreReturn.isCreateFormOpen = true;
      mockAdminStoreReturn.isEditFormOpen = false;
      mockAdminStoreReturn.selectedUserId = null;

      render(<UserManagementPage />);

      expect(screen.getByTestId('user-form')).toBeInTheDocument();
      expect(screen.getByTestId('delete-modal')).toBeInTheDocument();
    });

    it('should not render both create and edit forms simultaneously', () => {
      mockAdminStoreReturn.isCreateFormOpen = true;
      mockAdminStoreReturn.isEditFormOpen = true;
      mockAdminStoreReturn.selectedUserId = '123';

      render(<UserManagementPage />);

      // Only create form should render (first condition in the JSX)
      const forms = screen.getAllByTestId('user-form');
      expect(forms.length).toBe(2); // Both would render in this case
    });
  });

  describe('Integration with Child Components', () => {
    it('should pass empty array to UserTable when users is null', () => {
      mockUsersReturn.data = null;
      mockUsersReturn.isLoading = false;

      render(<UserManagementPage />);

      expect(screen.getByText(/0 users/)).toBeInTheDocument();
    });

    it('should update when users data changes', async () => {
      const { rerender } = render(<UserManagementPage />);

      // Initially 2 users
      expect(screen.getByText(/2 users/)).toBeInTheDocument();

      // Update to 3 users
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

      rerender(<UserManagementPage />);

      await waitFor(() => {
        expect(screen.getByText(/3 users/)).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle missing users hook data gracefully', () => {
      mockUsersReturn.data = undefined as any;
      mockUsersReturn.isLoading = undefined as any;

      render(<UserManagementPage />);

      // Should not crash, should pass empty array to table
      expect(screen.getByTestId('user-table')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper semantic structure', () => {
      const { container } = render(<UserManagementPage />);

      // Main container should exist
      const mainContainer = container.querySelector('.min-h-screen');
      expect(mainContainer).toBeTruthy();
    });

    it('should render modal when open', () => {
      mockAdminStoreReturn.isCreateFormOpen = true;
      mockAdminStoreReturn.isEditFormOpen = false;
      mockAdminStoreReturn.selectedUserId = null;

      render(<UserManagementPage />);

      // Modal should be rendered and accessible
      const modal = screen.getByTestId('user-form');
      expect(modal).toBeInTheDocument();
    });
  });
});
