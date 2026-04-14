import { create } from 'zustand';

interface PickupPointStore {
  isCreateFormOpen: boolean;
  isEditFormOpen: boolean;
  isDeleteConfirmOpen: boolean;
  selectedPickupPointId: string | null;
  setCreateFormOpen: (open: boolean) => void;
  setEditFormOpen: (open: boolean, pointId?: string) => void;
  setDeleteConfirmOpen: (open: boolean, pointId?: string) => void;
  resetAll: () => void;
}

export const usePickupPointStore = create<PickupPointStore>((set) => ({
  isCreateFormOpen: false,
  isEditFormOpen: false,
  isDeleteConfirmOpen: false,
  selectedPickupPointId: null,
  setCreateFormOpen: (open) => set({ isCreateFormOpen: open }),
  setEditFormOpen: (open, pointId) => set({ isEditFormOpen: open, selectedPickupPointId: pointId || null }),
  setDeleteConfirmOpen: (open, pointId) => set({ isDeleteConfirmOpen: open, selectedPickupPointId: pointId || null }),
  resetAll: () => set({ isCreateFormOpen: false, isEditFormOpen: false, isDeleteConfirmOpen: false, selectedPickupPointId: null }),
}));
