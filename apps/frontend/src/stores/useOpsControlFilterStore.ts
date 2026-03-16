/**
 * Operations Control Filter Store (Zustand)
 * Manages filter state shared between PipelineCard and OrdersFilterToolbar
 */

import { create } from 'zustand';
import type { OrderStatus } from '@/lib/types/pipeline';

export interface OpsControlFilterState {
  // State
  search: string; // searches order #, cliente, destino
  datePreset: 'today' | 'tomorrow' | 'next7' | 'custom'; // default: 'today'
  dateRange: { from: string; to: string } | null; // only for 'custom'
  statusFilter: 'all' | 'urgent' | 'alert' | 'ok' | 'late'; // default: 'all'
  stageFilter: OrderStatus | null; // default: null

  // Actions
  setSearch: (search: string) => void;
  setDatePreset: (preset: OpsControlFilterState['datePreset']) => void;
  setDateRange: (range: { from: string; to: string } | null) => void;
  setStatusFilter: (filter: OpsControlFilterState['statusFilter']) => void;
  setStageFilter: (stage: OrderStatus | null) => void;
  clearAllFilters: () => void;
}

export const useOpsControlFilterStore = create<OpsControlFilterState>((set) => ({
  // Initial state
  search: '',
  datePreset: 'today',
  dateRange: null,
  statusFilter: 'all',
  stageFilter: null,

  // Actions
  setSearch: (search) => set({ search }),
  setDatePreset: (datePreset) => set({ datePreset }),
  setDateRange: (dateRange) => set({ dateRange }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setStageFilter: (stageFilter) => set({ stageFilter }),

  clearAllFilters: () =>
    set({
      search: '',
      datePreset: 'today',
      dateRange: null,
      statusFilter: 'all',
      stageFilter: null,
    }),
}));
