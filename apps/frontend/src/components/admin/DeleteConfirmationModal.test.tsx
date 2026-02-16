/**
 * DeleteConfirmationModal Component Tests
 * Tests deletion confirmation modal behavior
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteConfirmationModal } from './DeleteConfirmationModal';

// Mock the hooks
vi.mock('@/hooks/useUsers', () => ({
  useDeleteUser: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

vi.mock('@/stores/adminStore', () => ({
  useAdminStore: vi.fn(() => ({
    isDeleteConfirmOpen: true,
    selectedUserId: '123',
    setDeleteConfirmOpen: vi.fn(),
  })),
}));

describe('DeleteConfirmationModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Visibility', () => {
    it('should not render when isDeleteConfirmOpen is false', () => {
      const { useAdminStore } = require('@/stores/adminStore');
      useAdminStore.mockReturnValue({
        isDeleteConfirmOpen: false,
        selectedUserId: null,
        setDeleteConfirmOpen: vi.fn(),
      });

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
      const mockSetDeleteConfirmOpen = vi.fn();
      const { useAdminStore } = require('@/stores/adminStore');
      useAdminStore.mockReturnValue({
        isDeleteConfirmOpen: true,
        selectedUserId: '123',
        setDeleteConfirmOpen: mockSetDeleteConfirmOpen,
      });

      render(<DeleteConfirmationModal />);

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      expect(mockSetDeleteConfirmOpen).toHaveBeenCalledWith(false);
    });
  });

  describe('Delete Action', () => {
    it('should call deleteUser mutation when Delete is clicked', () => {
      const mockMutate = vi.fn();
      const { useDeleteUser } = require('@/hooks/useUsers');
      useDeleteUser.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      render(<DeleteConfirmationModal />);

      const deleteButton = screen.getByText('Delete');
      fireEvent.click(deleteButton);

      expect(mockMutate).toHaveBeenCalledWith(
        '123',
        expect.objectContaining({
          onSuccess: expect.any(Function),
        })
      );
    });

    it('should close modal on successful deletion', async () => {
      const mockSetDeleteConfirmOpen = vi.fn();
      const mockMutate = vi.fn((userId, { onSuccess }) => {
        // Simulate successful deletion
        onSuccess();
      });

      const { useAdminStore } = require('@/stores/adminStore');
      const { useDeleteUser } = require('@/hooks/useUsers');

      useAdminStore.mockReturnValue({
        isDeleteConfirmOpen: true,
        selectedUserId: '123',
        setDeleteConfirmOpen: mockSetDeleteConfirmOpen,
      });

      useDeleteUser.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      render(<DeleteConfirmationModal />);

      const deleteButton = screen.getByText('Delete');
      fireEvent.click(deleteButton);

      await waitFor(() => {
        expect(mockSetDeleteConfirmOpen).toHaveBeenCalledWith(false);
      });
    });

    it('should not call deleteUser when selectedUserId is null', () => {
      const mockMutate = vi.fn();
      const { useAdminStore } = require('@/stores/adminStore');
      const { useDeleteUser } = require('@/hooks/useUsers');

      useAdminStore.mockReturnValue({
        isDeleteConfirmOpen: true,
        selectedUserId: null,
        setDeleteConfirmOpen: vi.fn(),
      });

      useDeleteUser.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      render(<DeleteConfirmationModal />);

      const deleteButton = screen.getByText('Delete');
      fireEvent.click(deleteButton);

      expect(mockMutate).not.toHaveBeenCalled();
    });
  });

  describe('Loading State', () => {
    it('should disable buttons when isPending is true', () => {
      const { useDeleteUser } = require('@/hooks/useUsers');
      useDeleteUser.mockReturnValue({
        mutate: vi.fn(),
        isPending: true,
      });

      render(<DeleteConfirmationModal />);

      const cancelButton = screen.getByText('Cancel');
      const deleteButton = screen.getByText('Deleting...');

      expect(cancelButton).toBeDisabled();
      expect(deleteButton).toBeDisabled();
    });

    it('should show "Deleting..." text when isPending is true', () => {
      const { useDeleteUser } = require('@/hooks/useUsers');
      useDeleteUser.mockReturnValue({
        mutate: vi.fn(),
        isPending: true,
      });

      render(<DeleteConfirmationModal />);

      expect(screen.getByText('Deleting...')).toBeInTheDocument();
    });

    it('should show spinner icon when isPending is true', () => {
      const { useDeleteUser } = require('@/hooks/useUsers');
      useDeleteUser.mockReturnValue({
        mutate: vi.fn(),
        isPending: true,
      });

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
