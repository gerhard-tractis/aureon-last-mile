import { create } from 'zustand';

interface ClientStore {
  isCreateFormOpen: boolean;
  isEditFormOpen: boolean;
  isDeleteConfirmOpen: boolean;
  selectedClientId: string | null;
  setCreateFormOpen: (open: boolean) => void;
  setEditFormOpen: (open: boolean, clientId?: string) => void;
  setDeleteConfirmOpen: (open: boolean, clientId?: string) => void;
  resetAll: () => void;
}

export const useClientStore = create<ClientStore>((set) => ({
  isCreateFormOpen: false,
  isEditFormOpen: false,
  isDeleteConfirmOpen: false,
  selectedClientId: null,
  setCreateFormOpen: (open) => set({ isCreateFormOpen: open }),
  setEditFormOpen: (open, clientId) => set({ isEditFormOpen: open, selectedClientId: clientId || null }),
  setDeleteConfirmOpen: (open, clientId) => set({ isDeleteConfirmOpen: open, selectedClientId: clientId || null }),
  resetAll: () => set({ isCreateFormOpen: false, isEditFormOpen: false, isDeleteConfirmOpen: false, selectedClientId: null }),
}));
