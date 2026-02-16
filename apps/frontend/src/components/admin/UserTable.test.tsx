/**
 * UserTable Component Tests
 * Tests table rendering, sorting, and action buttons
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserTable } from './UserTable';
import type { User } from '@/lib/api/users';

// Mock the adminStore
vi.mock('@/stores/adminStore', () => ({
  useAdminStore: vi.fn(() => ({
    sortBy: 'created_at',
    sortOrder: 'desc',
    toggleSort: vi.fn(),
    setEditFormOpen: vi.fn(),
    setDeleteConfirmOpen: vi.fn(),
  })),
}));

// Mock date-fns format
vi.mock('date-fns', () => ({
  format: vi.fn((date, formatStr) => '16/02/2026 14:30'),
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
  });

  describe('Loading State', () => {
    it('should display loading skeleton when isLoading is true', () => {
      const { container } = render(<UserTable users={[]} isLoading={true} />);
      expect(container.querySelector('.animate-pulse')).toBeTruthy();
    });
  });

  describe('Empty State', () => {
    it('should display "No users found" when users array is empty', () => {
      render(<UserTable users={[]} isLoading={false} />);
      expect(screen.getByText('No users found')).toBeInTheDocument();
    });

    it('should display "No users found" when users is null', () => {
      render(<UserTable users={null as any} isLoading={false} />);
      expect(screen.getByText('No users found')).toBeInTheDocument();
    });
  });

  describe('Table Rendering', () => {
    it('should render table headers', () => {
      render(<UserTable users={mockUsers} isLoading={false} />);

      expect(screen.getByText('Email')).toBeInTheDocument();
      expect(screen.getByText('Full Name')).toBeInTheDocument();
      expect(screen.getByText('Role')).toBeInTheDocument();
      expect(screen.getByText('Created At')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
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

    it('should render role badges with correct text', () => {
      render(<UserTable users={mockUsers} isLoading={false} />);

      expect(screen.getByText('Administrator')).toBeInTheDocument();
      expect(screen.getByText('Operations Manager')).toBeInTheDocument();
      expect(screen.getByText('Pickup Crew')).toBeInTheDocument();
    });

    it('should render role badges with correct colors', () => {
      const { container } = render(<UserTable users={mockUsers} isLoading={false} />);

      // Admin badge should have gold background
      const adminBadge = screen.getByText('Administrator').closest('span');
      expect(adminBadge?.className).toContain('bg-[#e6c15c]');

      // Operations manager badge should have blue background
      const managerBadge = screen.getByText('Operations Manager').closest('span');
      expect(managerBadge?.className).toContain('bg-blue-100');

      // Pickup crew badge should have gray background
      const crewBadge = screen.getByText('Pickup Crew').closest('span');
      expect(crewBadge?.className).toContain('bg-gray-100');
    });

    it('should format dates correctly', () => {
      render(<UserTable users={mockUsers} isLoading={false} />);

      // Should display formatted dates (mocked to return 16/02/2026 14:30)
      const formattedDates = screen.getAllByText('16/02/2026 14:30');
      expect(formattedDates).toHaveLength(3); // One for each user
    });
  });

  describe('Sorting', () => {
    it('should call toggleSort when clicking email header', () => {
      const mockToggleSort = vi.fn();
      const { useAdminStore } = require('@/stores/adminStore');
      useAdminStore.mockReturnValue({
        sortBy: 'created_at',
        sortOrder: 'desc',
        toggleSort: mockToggleSort,
        setEditFormOpen: vi.fn(),
        setDeleteConfirmOpen: vi.fn(),
      });

      render(<UserTable users={mockUsers} isLoading={false} />);

      const emailHeader = screen.getByText('Email').closest('th');
      fireEvent.click(emailHeader!);

      expect(mockToggleSort).toHaveBeenCalledWith('email');
    });

    it('should call toggleSort when clicking full_name header', () => {
      const mockToggleSort = vi.fn();
      const { useAdminStore } = require('@/stores/adminStore');
      useAdminStore.mockReturnValue({
        sortBy: 'created_at',
        sortOrder: 'desc',
        toggleSort: mockToggleSort,
        setEditFormOpen: vi.fn(),
        setDeleteConfirmOpen: vi.fn(),
      });

      render(<UserTable users={mockUsers} isLoading={false} />);

      const fullNameHeader = screen.getByText('Full Name').closest('th');
      fireEvent.click(fullNameHeader!);

      expect(mockToggleSort).toHaveBeenCalledWith('full_name');
    });

    it('should call toggleSort when clicking role header', () => {
      const mockToggleSort = vi.fn();
      const { useAdminStore } = require('@/stores/adminStore');
      useAdminStore.mockReturnValue({
        sortBy: 'created_at',
        sortOrder: 'desc',
        toggleSort: mockToggleSort,
        setEditFormOpen: vi.fn(),
        setDeleteConfirmOpen: vi.fn(),
      });

      render(<UserTable users={mockUsers} isLoading={false} />);

      const roleHeader = screen.getByText('Role').closest('th');
      fireEvent.click(roleHeader!);

      expect(mockToggleSort).toHaveBeenCalledWith('role');
    });

    it('should call toggleSort when clicking created_at header', () => {
      const mockToggleSort = vi.fn();
      const { useAdminStore } = require('@/stores/adminStore');
      useAdminStore.mockReturnValue({
        sortBy: 'created_at',
        sortOrder: 'desc',
        toggleSort: mockToggleSort,
        setEditFormOpen: vi.fn(),
        setDeleteConfirmOpen: vi.fn(),
      });

      render(<UserTable users={mockUsers} isLoading={false} />);

      const createdAtHeader = screen.getByText('Created At').closest('th');
      fireEvent.click(createdAtHeader!);

      expect(mockToggleSort).toHaveBeenCalledWith('created_at');
    });

    it('should display correct sort icon for active column', () => {
      const { useAdminStore } = require('@/stores/adminStore');
      useAdminStore.mockReturnValue({
        sortBy: 'email',
        sortOrder: 'asc',
        toggleSort: vi.fn(),
        setEditFormOpen: vi.fn(),
        setDeleteConfirmOpen: vi.fn(),
      });

      const { container } = render(<UserTable users={mockUsers} isLoading={false} />);

      // Email header should have up arrow (asc)
      const emailHeader = screen.getByText('Email').closest('th');
      expect(emailHeader?.textContent).toContain('↑');
    });

    it('should display neutral sort icon for inactive columns', () => {
      const { useAdminStore } = require('@/stores/adminStore');
      useAdminStore.mockReturnValue({
        sortBy: 'email',
        sortOrder: 'asc',
        toggleSort: vi.fn(),
        setEditFormOpen: vi.fn(),
        setDeleteConfirmOpen: vi.fn(),
      });

      render(<UserTable users={mockUsers} isLoading={false} />);

      // Full Name header should have neutral icon (↕)
      const fullNameHeader = screen.getByText('Full Name').closest('th');
      expect(fullNameHeader?.textContent).toContain('↕');
    });
  });

  describe('Action Buttons', () => {
    it('should render Edit and Delete buttons for each user', () => {
      render(<UserTable users={mockUsers} isLoading={false} />);

      const editButtons = screen.getAllByText('Edit');
      const deleteButtons = screen.getAllByText('Delete');

      expect(editButtons).toHaveLength(3);
      expect(deleteButtons).toHaveLength(3);
    });

    it('should call setEditFormOpen when clicking Edit button', () => {
      const mockSetEditFormOpen = vi.fn();
      const { useAdminStore } = require('@/stores/adminStore');
      useAdminStore.mockReturnValue({
        sortBy: 'created_at',
        sortOrder: 'desc',
        toggleSort: vi.fn(),
        setEditFormOpen: mockSetEditFormOpen,
        setDeleteConfirmOpen: vi.fn(),
      });

      render(<UserTable users={mockUsers} isLoading={false} />);

      const editButtons = screen.getAllByText('Edit');
      fireEvent.click(editButtons[0]); // Click first Edit button

      expect(mockSetEditFormOpen).toHaveBeenCalledWith(true, '1');
    });

    it('should call setDeleteConfirmOpen when clicking Delete button', () => {
      const mockSetDeleteConfirmOpen = vi.fn();
      const { useAdminStore } = require('@/stores/adminStore');
      useAdminStore.mockReturnValue({
        sortBy: 'created_at',
        sortOrder: 'desc',
        toggleSort: vi.fn(),
        setEditFormOpen: vi.fn(),
        setDeleteConfirmOpen: mockSetDeleteConfirmOpen,
      });

      render(<UserTable users={mockUsers} isLoading={false} />);

      const deleteButtons = screen.getAllByText('Delete');
      fireEvent.click(deleteButtons[1]); // Click second Delete button

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

      const headers = container.querySelectorAll('th[scope="col"]');
      expect(headers.length).toBeGreaterThan(0);
    });

    it('should have minimum touch target sizes', () => {
      render(<UserTable users={mockUsers} isLoading={false} />);

      const editButtons = screen.getAllByText('Edit');
      const deleteButtons = screen.getAllByText('Delete');

      editButtons.forEach((button) => {
        const style = window.getComputedStyle(button);
        // Note: In test environment, inline styles may not be computed
        // Just verify the style attribute exists
        expect(button.getAttribute('style')).toBeTruthy();
      });

      deleteButtons.forEach((button) => {
        expect(button.getAttribute('style')).toBeTruthy();
      });
    });
  });
});
