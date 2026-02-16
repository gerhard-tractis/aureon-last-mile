/**
 * Admin Store - Zustand state management for admin UI
 * Handles local UI state (modals, sorting, selected items)
 */

import { create } from 'zustand';

interface AdminStore {
  // Modal visibility state
  isCreateFormOpen: boolean;
  isEditFormOpen: boolean;
  isDeleteConfirmOpen: boolean;
  selectedUserId: string | null;

  // Table sorting state
  sortBy: 'email' | 'full_name' | 'role' | 'created_at';
  sortOrder: 'asc' | 'desc';

  // Actions - Create form
  setCreateFormOpen: (open: boolean) => void;

  // Actions - Edit form
  setEditFormOpen: (open: boolean, userId?: string) => void;

  // Actions - Delete confirmation
  setDeleteConfirmOpen: (open: boolean, userId?: string) => void;

  // Actions - Sorting
  setSortOrder: (sortBy: AdminStore['sortBy']) => void;
  toggleSort: (sortBy: AdminStore['sortBy']) => void;
}

export const useAdminStore = create<AdminStore>((set, get) => ({
  // Initial state
  isCreateFormOpen: false,
  isEditFormOpen: false,
  isDeleteConfirmOpen: false,
  selectedUserId: null,
  sortBy: 'created_at',
  sortOrder: 'desc',

  // Create form actions
  setCreateFormOpen: (open) => set({ isCreateFormOpen: open }),

  // Edit form actions
  setEditFormOpen: (open, userId) =>
    set({
      isEditFormOpen: open,
      selectedUserId: userId || null
    }),

  // Delete confirmation actions
  setDeleteConfirmOpen: (open, userId) =>
    set({
      isDeleteConfirmOpen: open,
      selectedUserId: userId || null
    }),

  // Sorting actions
  setSortOrder: (sortBy) => {
    const currentSortBy = get().sortBy;
    const currentSortOrder = get().sortOrder;

    // If clicking same column, toggle order
    if (sortBy === currentSortBy) {
      set({ sortOrder: currentSortOrder === 'asc' ? 'desc' : 'asc' });
    } else {
      // New column, default to ascending
      set({ sortBy, sortOrder: 'asc' });
    }
  },

  // Toggle sort (same as setSortOrder)
  toggleSort: (sortBy) => {
    const currentSortBy = get().sortBy;
    const currentSortOrder = get().sortOrder;

    if (sortBy === currentSortBy) {
      set({ sortOrder: currentSortOrder === 'asc' ? 'desc' : 'asc' });
    } else {
      set({ sortBy, sortOrder: 'asc' });
    }
  }
}));
