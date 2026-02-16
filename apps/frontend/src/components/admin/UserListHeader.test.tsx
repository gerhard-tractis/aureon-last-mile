/**
 * UserListHeader Component Tests
 * Tests header rendering and Create User button
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserListHeader } from './UserListHeader';

// Mock the adminStore at top level
const mockSetCreateFormOpen = vi.fn();

vi.mock('@/stores/adminStore', () => ({
  useAdminStore: vi.fn(() => ({
    setCreateFormOpen: mockSetCreateFormOpen,
  })),
}));

describe('UserListHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the page title', () => {
      render(<UserListHeader />);
      expect(screen.getByText('User Management')).toBeInTheDocument();
    });

    it('should render the page description', () => {
      render(<UserListHeader />);
      expect(
        screen.getByText('Create and manage user accounts and roles')
      ).toBeInTheDocument();
    });

    it('should render the Create User button', () => {
      render(<UserListHeader />);
      expect(screen.getByText('Create User')).toBeInTheDocument();
    });
  });

  describe('Create User Button', () => {
    it('should call setCreateFormOpen when clicked', () => {
      render(<UserListHeader />);

      const createButton = screen.getByText('Create User');
      fireEvent.click(createButton);

      expect(mockSetCreateFormOpen).toHaveBeenCalledWith(true);
    });

    it('should have Tractis gold background color', () => {
      render(<UserListHeader />);

      const createButton = screen.getByText('Create User');
      expect(createButton.className).toContain('bg-[#e6c15c]');
    });

    it('should have hover state', () => {
      render(<UserListHeader />);

      const createButton = screen.getByText('Create User');
      expect(createButton.className).toContain('hover:bg-[#d4b04a]');
    });

    it('should have minimum touch target size', () => {
      render(<UserListHeader />);

      const createButton = screen.getByText('Create User');
      // Check for min-height CSS property (not minHeight in style object)
      expect(createButton.getAttribute('style')).toContain('min-height');
    });
  });

  describe('Layout', () => {
    it('should have proper flex layout for desktop', () => {
      const { container } = render(<UserListHeader />);

      const header = container.querySelector('.flex.items-center.justify-between');
      expect(header).toBeInTheDocument();
    });

    it('should have proper text hierarchy', () => {
      render(<UserListHeader />);

      const title = screen.getByText('User Management');
      expect(title.tagName).toBe('H1');
      expect(title.className).toContain('text-2xl');
      expect(title.className).toContain('font-semibold');

      const description = screen.getByText(
        'Create and manage user accounts and roles'
      );
      expect(description.tagName).toBe('P');
      expect(description.className).toContain('text-sm');
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', () => {
      render(<UserListHeader />);

      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent('User Management');
    });

    it('should have clickable button', () => {
      render(<UserListHeader />);

      const button = screen.getByRole('button', { name: 'Create User' });
      expect(button).toBeInTheDocument();
    });
  });
});
