/**
 * DeleteConfirmationModal Component Tests
 * Tests deletion confirmation modal behavior
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteConfirmationModal } from './DeleteConfirmationModal';

// Create mock implementations that can be reconfigured
let mockDeleteUserReturn = {
  mutate: vi.fn(),
  isPending: false,
};

let mockAdminStoreReturn = {
  isDeleteConfirmOpen: true,
  selectedUserId: '123' as string | null,
  setDeleteConfirmOpen: vi.fn(),
};

// Mock the hooks at top level
vi.mock('@/hooks/useUsers', () => ({
  useDeleteUser: vi.fn(() => mockDeleteUserReturn),
}));

vi.mock('@/stores/adminStore', () => ({
  useAdminStore: vi.fn(() => mockAdminStoreReturn),
}));

describe('DeleteConfirmationModal', () => {
  beforeEach(() => {
    // Reset to default state
    mockDeleteUserReturn = {
      mutate: vi.fn(),
      isPending: false,
    };

    mockAdminStoreReturn = {
      isDeleteConfirmOpen: true,
      selectedUserId: '123' as string | null,
      setDeleteConfirmOpen: vi.fn(),
    };
  });

  describe('Visibility', () => {
    it('should not render when isDeleteConfirmOpen is false', () => {
      mockAdminStoreReturn.isDeleteConfirmOpen = false;
      mockAdminStoreReturn.selectedUserId = null;

      const { container } = render(<DeleteConfirmationModal />);
      expect(container.firstChild).toBeNull();
    });

    it('should render when isDeleteConfirmOpen is true', () => {
      render(<DeleteConfirmationModal />);
      expect(screen.getByText('Delete User')).toBeInTheDocument();
    });
  });

  describe('Content', () => {
    it('should display confirmation message', () => {
      render(<DeleteConfirmationModal />);
      expect(
        screen.getByText('Are you sure you want to delete this user?')
      ).toBeInTheDocument();
    });

    it('should display soft delete warning', () => {
      render(<DeleteConfirmationModal />);
      expect(screen.getByText(/Warning:/)).toBeInTheDocument();
      expect(
        screen.getByText(/User will be soft-deleted/)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/They can no longer log in/)
      ).toBeInTheDocument();
    });

    it('should display Cancel button', () => {
      render(<DeleteConfirmationModal />);
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('should display Delete button', () => {
      render(<DeleteConfirmationModal />);
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  describe('Cancel Action', () => {
    it('should call setDeleteConfirmOpen(false) when Cancel is clicked', () => {
      render(<DeleteConfirmationModal />);

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      expect(mockAdminStoreReturn.setDeleteConfirmOpen).toHaveBeenCalledWith(false);
    });
  });

  describe('Delete Action', () => {
    it('should call deleteUser mutation when Delete is clicked', () => {
      render(<DeleteConfirmationModal />);

      const deleteButton = screen.getByText('Delete');
      fireEvent.click(deleteButton);

      expect(mockDeleteUserReturn.mutate).toHaveBeenCalledWith(
        '123',
        expect.objectContaining({
          onSuccess: expect.any(Function),
        })
      );
    });

    it('should close modal on successful deletion', async () => {
      mockDeleteUserReturn.mutate = vi.fn((userId, { onSuccess }) => {
        onSuccess();
      });

      render(<DeleteConfirmationModal />);

      const deleteButton = screen.getByText('Delete');
      fireEvent.click(deleteButton);

      await waitFor(() => {
        expect(mockAdminStoreReturn.setDeleteConfirmOpen).toHaveBeenCalledWith(false);
      });
    });

    it('should not call deleteUser when selectedUserId is null', () => {
      mockAdminStoreReturn.selectedUserId = null;

      render(<DeleteConfirmationModal />);

      const deleteButton = screen.getByText('Delete');
      fireEvent.click(deleteButton);

      expect(mockDeleteUserReturn.mutate).not.toHaveBeenCalled();
    });
  });

  describe('Loading State', () => {
    it('should disable buttons when isPending is true', () => {
      mockDeleteUserReturn.isPending = true;

      render(<DeleteConfirmationModal />);

      const cancelButton = screen.getByText('Cancel');
      const deleteButton = screen.getByText('Deleting...');

      expect(cancelButton).toBeDisabled();
      expect(deleteButton).toBeDisabled();
    });

    it('should show "Deleting..." text when isPending is true', () => {
      mockDeleteUserReturn.isPending = true;

      render(<DeleteConfirmationModal />);

      expect(screen.getByText('Deleting...')).toBeInTheDocument();
    });

    it('should show spinner icon when isPending is true', () => {
      mockDeleteUserReturn.isPending = true;

      const { container } = render(<DeleteConfirmationModal />);

      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeTruthy();
    });

    it('should show "Delete" text when isPending is false', () => {
      render(<DeleteConfirmationModal />);

      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('should have red background on Delete button', () => {
      render(<DeleteConfirmationModal />);

      const deleteButton = screen.getByText('Delete');
      expect(deleteButton.className).toContain('bg-red-600');
    });

    it('should have amber warning box', () => {
      const { container } = render(<DeleteConfirmationModal />);

      const warningBox = container.querySelector('.bg-amber-50');
      expect(warningBox).toBeTruthy();
    });

    it('should have modal overlay', () => {
      const { container } = render(<DeleteConfirmationModal />);

      const overlay = container.querySelector('.bg-black.bg-opacity-50');
      expect(overlay).toBeTruthy();
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading', () => {
      render(<DeleteConfirmationModal />);

      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading).toHaveTextContent('Delete User');
    });

    it('should have clickable buttons', () => {
      render(<DeleteConfirmationModal />);

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });
  });
});
