/**
 * UserForm Component Tests
 * Tests form rendering, validation, and submission in both create and edit modes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserForm } from './UserForm';
import type { User } from '@/lib/api/users';

// Create mock return objects that can be reconfigured
let mockUsersReturn = {
  data: [
    {
      id: '1',
      email: 'existing@test.com',
      full_name: 'Existing User',
      role: 'admin',
      operator_id: 'op-1',
      created_at: '2026-02-16T14:30:00Z',
      deleted_at: null,
    },
  ],
};

let mockCreateUserReturn = {
  mutate: vi.fn(),
  isPending: false,
};

let mockUpdateUserReturn = {
  mutate: vi.fn(),
  isPending: false,
};

let mockAdminStoreReturn = {
  setCreateFormOpen: vi.fn(),
  setEditFormOpen: vi.fn(),
};

// Mock the hooks
vi.mock('@/hooks/useUsers', () => ({
  useUsers: vi.fn(() => mockUsersReturn),
  useCreateUser: vi.fn(() => mockCreateUserReturn),
  useUpdateUser: vi.fn(() => mockUpdateUserReturn),
}));

vi.mock('@/stores/adminStore', () => ({
  useAdminStore: vi.fn(() => mockAdminStoreReturn),
}));

describe('UserForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default state
    mockUsersReturn = {
      data: [
        {
          id: '1',
          email: 'existing@test.com',
          full_name: 'Existing User',
          role: 'admin',
          operator_id: 'op-1',
          created_at: '2026-02-16T14:30:00Z',
          deleted_at: null,
        },
      ],
    };
    mockCreateUserReturn = {
      mutate: vi.fn(),
      isPending: false,
    };
    mockUpdateUserReturn = {
      mutate: vi.fn(),
      isPending: false,
    };
    mockAdminStoreReturn = {
      setCreateFormOpen: vi.fn(),
      setEditFormOpen: vi.fn(),
    };
  });

  describe('Create Mode', () => {
    it('should render form title as "Create New User"', () => {
      render(<UserForm mode="create" />);
      expect(screen.getByText('Create New User')).toBeInTheDocument();
    });

    it('should render all form fields for create mode', () => {
      render(<UserForm mode="create" />);

      expect(screen.getByLabelText(/Email/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Full Name/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Role/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Operator ID/)).toBeInTheDocument();
    });

    it('should have editable email field in create mode', () => {
      render(<UserForm mode="create" />);

      const emailInput = screen.getByLabelText(/Email/) as HTMLInputElement;
      expect(emailInput).not.toBeDisabled();
      expect(emailInput.type).toBe('email');
    });

    it('should have editable operator_id field in create mode', () => {
      render(<UserForm mode="create" />);

      const operatorInput = screen.getByLabelText(/Operator ID/) as HTMLInputElement;
      expect(operatorInput).not.toBeDisabled();
      expect(operatorInput.type).toBe('text');
    });

    it('should display password setup hint', () => {
      render(<UserForm mode="create" />);

      expect(
        screen.getByText('User will receive a password setup email')
      ).toBeInTheDocument();
    });

    it('should render "Create User" submit button', () => {
      render(<UserForm mode="create" />);

      expect(screen.getByText('Create User')).toBeInTheDocument();
    });

    it('should call createUser mutation on valid form submission', async () => {
      const mockMutate = vi.fn();
      mockCreateUserReturn.mutate = mockMutate;

      render(<UserForm mode="create" />);

      const emailInput = screen.getByLabelText(/Email/);
      const fullNameInput = screen.getByLabelText(/Full Name/);
      const roleSelect = screen.getByLabelText(/Role/);
      const operatorInput = screen.getByLabelText(/Operator ID/);

      await userEvent.type(emailInput, 'newuser@test.com');
      await userEvent.type(fullNameInput, 'New User');
      await userEvent.selectOptions(roleSelect, 'admin');
      await userEvent.type(operatorInput, '550e8400-e29b-41d4-a716-446655440000');

      const submitButton = screen.getByText('Create User');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            email: 'newuser@test.com',
            full_name: 'New User',
            role: 'admin',
            operator_id: '550e8400-e29b-41d4-a716-446655440000',
          }),
          expect.any(Object)
        );
      });
    });

    it('should validate email uniqueness asynchronously', async () => {
      render(<UserForm mode="create" />);

      const emailInput = screen.getByLabelText(/Email/);
      await userEvent.type(emailInput, 'existing@test.com');

      // Wait for debounce (500ms)
      await waitFor(
        () => {
          expect(screen.getByText('Email already in use')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });

    it('should not submit form when email is not unique', async () => {
      const mockMutate = vi.fn();
      mockCreateUserReturn.mutate = mockMutate;

      render(<UserForm mode="create" />);

      const emailInput = screen.getByLabelText(/Email/);
      await userEvent.type(emailInput, 'existing@test.com');

      // Wait for debounce
      await waitFor(
        () => {
          expect(screen.getByText('Email already in use')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      const submitButton = screen.getByText('Create User');
      expect(submitButton).toBeDisabled();

      fireEvent.click(submitButton);
      expect(mockMutate).not.toHaveBeenCalled();
    });

    it('should close modal on successful creation', async () => {
      const mockSetCreateFormOpen = vi.fn();
      const mockMutate = vi.fn((data, { onSuccess }) => {
        onSuccess();
      });

      mockAdminStoreReturn.setCreateFormOpen = mockSetCreateFormOpen;
      mockCreateUserReturn.mutate = mockMutate;

      render(<UserForm mode="create" />);

      const emailInput = screen.getByLabelText(/Email/);
      const fullNameInput = screen.getByLabelText(/Full Name/);
      const roleSelect = screen.getByLabelText(/Role/);
      const operatorInput = screen.getByLabelText(/Operator ID/);

      await userEvent.type(emailInput, 'newuser@test.com');
      await userEvent.type(fullNameInput, 'New User');
      await userEvent.selectOptions(roleSelect, 'admin');
      await userEvent.type(operatorInput, '550e8400-e29b-41d4-a716-446655440000');

      const submitButton = screen.getByText('Create User');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockSetCreateFormOpen).toHaveBeenCalledWith(false);
      });
    });
  });

  describe('Edit Mode', () => {
    const mockUser: User = {
      id: '123',
      email: 'edit@test.com',
      full_name: 'Edit User',
      role: 'operations_manager',
      operator_id: 'op-1',
      created_at: '2026-02-16T14:30:00Z',
      deleted_at: null,
    };

    beforeEach(() => {
      mockUsersReturn.data = [mockUser];
    });

    it('should render form title as "Edit User"', () => {
      render(<UserForm mode="edit" userId="123" />);
      expect(screen.getByText('Edit User')).toBeInTheDocument();
    });

    it('should display email as read-only', () => {
      render(<UserForm mode="edit" userId="123" />);

      expect(screen.getByText('edit@test.com')).toBeInTheDocument();
      expect(screen.getByText('Email cannot be changed')).toBeInTheDocument();
    });

    it('should display operator_id as read-only', () => {
      render(<UserForm mode="edit" userId="123" />);

      expect(screen.getByText('op-1')).toBeInTheDocument();
      expect(screen.getByText('Operator ID cannot be changed')).toBeInTheDocument();
    });

    it('should pre-fill form with user data', async () => {
      render(<UserForm mode="edit" userId="123" />);

      await waitFor(() => {
        const fullNameInput = screen.getByLabelText(/Full Name/) as HTMLInputElement;
        const roleSelect = screen.getByLabelText(/Role/) as HTMLSelectElement;

        expect(fullNameInput.value).toBe('Edit User');
        expect(roleSelect.value).toBe('operations_manager');
      });
    });

    it('should render "Save Changes" submit button', () => {
      render(<UserForm mode="edit" userId="123" />);

      expect(screen.getByText('Save Changes')).toBeInTheDocument();
    });

    it('should call updateUser mutation on valid form submission', async () => {
      const mockMutate = vi.fn();
      mockUpdateUserReturn.mutate = mockMutate;

      render(<UserForm mode="edit" userId="123" />);

      const fullNameInput = screen.getByLabelText(/Full Name/);
      const roleSelect = screen.getByLabelText(/Role/);

      await userEvent.clear(fullNameInput);
      await userEvent.type(fullNameInput, 'Updated User');
      await userEvent.selectOptions(roleSelect, 'admin');

      const submitButton = screen.getByText('Save Changes');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            id: '123',
            full_name: 'Updated User',
            role: 'admin',
          }),
          expect.any(Object)
        );
      });
    });

    it('should close modal on successful update', async () => {
      const mockSetEditFormOpen = vi.fn();
      const mockMutate = vi.fn((data, { onSuccess }) => {
        onSuccess();
      });

      mockAdminStoreReturn.setEditFormOpen = mockSetEditFormOpen;
      mockUpdateUserReturn.mutate = mockMutate;

      render(<UserForm mode="edit" userId="123" />);

      const fullNameInput = screen.getByLabelText(/Full Name/);
      await userEvent.clear(fullNameInput);
      await userEvent.type(fullNameInput, 'Updated User');

      const submitButton = screen.getByText('Save Changes');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockSetEditFormOpen).toHaveBeenCalledWith(false);
      });
    });
  });

  describe('Form Validation', () => {
    it('should prevent submission with invalid email (browser validation)', async () => {
      const mockMutate = vi.fn();
      mockCreateUserReturn.mutate = mockMutate;

      render(<UserForm mode="create" />);

      const emailInput = screen.getByLabelText(/Email/) as HTMLInputElement;
      await userEvent.type(emailInput, 'invalid-email');

      const submitButton = screen.getByText('Create User');
      fireEvent.click(submitButton);

      // Browser validation should prevent submission
      await waitFor(() => {
        // Mutation should not be called for invalid email
        expect(mockMutate).not.toHaveBeenCalled();
      });
    });

    it('should prevent submission with short name (Zod validation)', async () => {
      const mockMutate = vi.fn();
      mockCreateUserReturn.mutate = mockMutate;

      render(<UserForm mode="create" />);

      const fullNameInput = screen.getByLabelText(/Full Name/);
      await userEvent.type(fullNameInput, 'A');

      const submitButton = screen.getByText('Create User');
      fireEvent.click(submitButton);

      await waitFor(() => {
        // Mutation should not be called for invalid name
        expect(mockMutate).not.toHaveBeenCalled();
      });
    });

    it('should prevent submission with invalid UUID (Zod validation)', async () => {
      const mockMutate = vi.fn();
      mockCreateUserReturn.mutate = mockMutate;

      render(<UserForm mode="create" />);

      const operatorInput = screen.getByLabelText(/Operator ID/);
      await userEvent.type(operatorInput, 'not-a-uuid');

      const submitButton = screen.getByText('Create User');
      fireEvent.click(submitButton);

      await waitFor(() => {
        // Mutation should not be called for invalid operator ID
        expect(mockMutate).not.toHaveBeenCalled();
      });
    });

    it('should have aria-invalid attribute on form fields', async () => {
      render(<UserForm mode="create" />);

      const emailInput = screen.getByLabelText(/Email/);

      // Fields start with aria-invalid="false"
      expect(emailInput).toHaveAttribute('aria-invalid', 'false');
    });
  });

  describe('Cancel Action', () => {
    it('should close create modal when Cancel is clicked', () => {
      const mockSetCreateFormOpen = vi.fn();
      mockAdminStoreReturn.setCreateFormOpen = mockSetCreateFormOpen;

      render(<UserForm mode="create" />);

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      expect(mockSetCreateFormOpen).toHaveBeenCalledWith(false);
    });

    it('should close edit modal when Cancel is clicked', () => {
      const mockSetEditFormOpen = vi.fn();
      mockAdminStoreReturn.setEditFormOpen = mockSetEditFormOpen;

      render(<UserForm mode="edit" userId="123" />);

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      expect(mockSetEditFormOpen).toHaveBeenCalledWith(false);
    });
  });

  describe('Loading State', () => {
    it('should disable form fields when isPending is true', () => {
      mockCreateUserReturn.isPending = true;

      render(<UserForm mode="create" />);

      const emailInput = screen.getByLabelText(/Email/);
      const fullNameInput = screen.getByLabelText(/Full Name/);
      const roleSelect = screen.getByLabelText(/Role/);

      expect(emailInput).toBeDisabled();
      expect(fullNameInput).toBeDisabled();
      expect(roleSelect).toBeDisabled();
    });

    it('should show "Creating..." text when creating', () => {
      mockCreateUserReturn.isPending = true;

      render(<UserForm mode="create" />);

      expect(screen.getByText('Creating...')).toBeInTheDocument();
    });

    it('should show "Saving..." text when editing', () => {
      mockUpdateUserReturn.isPending = true;

      render(<UserForm mode="edit" userId="123" />);

      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });

    it('should show spinner when isPending is true', () => {
      mockCreateUserReturn.isPending = true;

      const { container } = render(<UserForm mode="create" />);

      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeTruthy();
    });
  });

  describe('Role Options', () => {
    it('should render all 5 role options', () => {
      render(<UserForm mode="create" />);

      const roleSelect = screen.getByLabelText(/Role/);
      const options = roleSelect.querySelectorAll('option');

      // 1 placeholder + 5 roles = 6 options
      expect(options.length).toBe(6);
      expect(options[0].textContent).toBe('Select a role');
      expect(options[1].textContent).toBe('Pickup Crew');
      expect(options[2].textContent).toBe('Warehouse Staff');
      expect(options[3].textContent).toBe('Loading Crew');
      expect(options[4].textContent).toBe('Operations Manager');
      expect(options[5].textContent).toBe('Administrator');
    });
  });

  describe('Styling', () => {
    it('should have Tractis gold submit button', () => {
      render(<UserForm mode="create" />);

      const submitButton = screen.getByText('Create User');
      expect(submitButton.className).toContain('bg-[#e6c15c]');
    });

    it('should have focus ring on inputs', () => {
      render(<UserForm mode="create" />);

      const emailInput = screen.getByLabelText(/Email/);
      expect(emailInput.className).toContain('focus:ring-[#e6c15c]');
    });

    it('should have modal overlay', () => {
      const { container } = render(<UserForm mode="create" />);

      const overlay = container.querySelector('.bg-black.bg-opacity-50');
      expect(overlay).toBeTruthy();
    });
  });
});
