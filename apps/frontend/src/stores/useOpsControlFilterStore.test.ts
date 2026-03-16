/**
 * Tests for Operations Control Filter Store (Zustand)
 * Manages filter state for Operations Control Center
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { OrderStatus } from '@/lib/types/pipeline';
import { useOpsControlFilterStore } from './useOpsControlFilterStore';

describe('useOpsControlFilterStore', () => {
  beforeEach(() => {
    useOpsControlFilterStore.getState().clearAllFilters();
  });

  describe('Default state', () => {
    it('has correct default values', () => {
      const state = useOpsControlFilterStore.getState();
      expect(state.search).toBe('');
      expect(state.datePreset).toBe('today');
      expect(state.dateRange).toBeNull();
      expect(state.statusFilter).toBe('all');
      expect(state.stageFilter).toBeNull();
    });
  });

  describe('setSearch', () => {
    it('updates search field', () => {
      const { setSearch } = useOpsControlFilterStore.getState();
      setSearch('ORDER-123');
      expect(useOpsControlFilterStore.getState().search).toBe('ORDER-123');
    });

    it('allows empty search', () => {
      const { setSearch } = useOpsControlFilterStore.getState();
      setSearch('test');
      setSearch('');
      expect(useOpsControlFilterStore.getState().search).toBe('');
    });

    it('allows whitespace in search', () => {
      const { setSearch } = useOpsControlFilterStore.getState();
      setSearch('  spaces  ');
      expect(useOpsControlFilterStore.getState().search).toBe('  spaces  ');
    });
  });

  describe('setDatePreset', () => {
    it('updates datePreset field', () => {
      const { setDatePreset } = useOpsControlFilterStore.getState();
      setDatePreset('tomorrow');
      expect(useOpsControlFilterStore.getState().datePreset).toBe('tomorrow');
    });

    it('accepts all valid presets', () => {
      const { setDatePreset } = useOpsControlFilterStore.getState();
      const presets: Array<'today' | 'tomorrow' | 'next7' | 'custom'> = [
        'today',
        'tomorrow',
        'next7',
        'custom',
      ];

      for (const preset of presets) {
        setDatePreset(preset);
        expect(useOpsControlFilterStore.getState().datePreset).toBe(preset);
      }
    });
  });

  describe('setDateRange', () => {
    it('sets custom date range', () => {
      const { setDateRange } = useOpsControlFilterStore.getState();
      const range = { from: '2026-03-10', to: '2026-03-20' };
      setDateRange(range);
      expect(useOpsControlFilterStore.getState().dateRange).toEqual(range);
    });

    it('sets dateRange to null', () => {
      const { setDateRange } = useOpsControlFilterStore.getState();
      setDateRange({ from: '2026-03-10', to: '2026-03-20' });
      setDateRange(null);
      expect(useOpsControlFilterStore.getState().dateRange).toBeNull();
    });

    it('updates existing dateRange', () => {
      const { setDateRange } = useOpsControlFilterStore.getState();
      setDateRange({ from: '2026-03-10', to: '2026-03-20' });
      const newRange = { from: '2026-03-01', to: '2026-03-15' };
      setDateRange(newRange);
      expect(useOpsControlFilterStore.getState().dateRange).toEqual(newRange);
    });
  });

  describe('setStatusFilter', () => {
    it('updates statusFilter field', () => {
      const { setStatusFilter } = useOpsControlFilterStore.getState();
      setStatusFilter('urgent');
      expect(useOpsControlFilterStore.getState().statusFilter).toBe('urgent');
    });

    it('accepts all valid status filters', () => {
      const { setStatusFilter } = useOpsControlFilterStore.getState();
      const statuses: Array<'all' | 'urgent' | 'alert' | 'ok' | 'late'> = [
        'all',
        'urgent',
        'alert',
        'ok',
        'late',
      ];

      for (const status of statuses) {
        setStatusFilter(status);
        expect(useOpsControlFilterStore.getState().statusFilter).toBe(status);
      }
    });
  });

  describe('setStageFilter', () => {
    it('sets stageFilter to an OrderStatus', () => {
      const { setStageFilter } = useOpsControlFilterStore.getState();
      setStageFilter('en_ruta');
      expect(useOpsControlFilterStore.getState().stageFilter).toBe('en_ruta');
    });

    it('sets stageFilter to null', () => {
      const { setStageFilter } = useOpsControlFilterStore.getState();
      setStageFilter('en_bodega');
      setStageFilter(null);
      expect(useOpsControlFilterStore.getState().stageFilter).toBeNull();
    });

    it('accepts various OrderStatus values', () => {
      const { setStageFilter } = useOpsControlFilterStore.getState();
      const statuses: OrderStatus[] = [
        'ingresado',
        'verificado',
        'en_bodega',
        'asignado',
        'en_carga',
        'listo',
        'en_ruta',
        'entregado',
        'cancelado',
      ];

      for (const status of statuses) {
        setStageFilter(status);
        expect(useOpsControlFilterStore.getState().stageFilter).toBe(status);
      }
    });
  });

  describe('clearAllFilters', () => {
    it('resets all filters to default values', () => {
      const { setSearch, setDatePreset, setDateRange, setStatusFilter, setStageFilter } =
        useOpsControlFilterStore.getState();

      // Set all filters to non-default values
      setSearch('search term');
      setDatePreset('custom');
      setDateRange({ from: '2026-03-10', to: '2026-03-20' });
      setStatusFilter('urgent');
      setStageFilter('en_ruta');

      // Clear all filters
      const { clearAllFilters } = useOpsControlFilterStore.getState();
      clearAllFilters();

      // Verify all are reset to defaults
      const state = useOpsControlFilterStore.getState();
      expect(state.search).toBe('');
      expect(state.datePreset).toBe('today');
      expect(state.dateRange).toBeNull();
      expect(state.statusFilter).toBe('all');
      expect(state.stageFilter).toBeNull();
    });

    it('clears multiple filters in sequence', () => {
      const state1 = useOpsControlFilterStore.getState();
      state1.setSearch('test1');
      state1.setStatusFilter('alert');

      const state2 = useOpsControlFilterStore.getState();
      expect(state2.search).toBe('test1');
      expect(state2.statusFilter).toBe('alert');

      state2.clearAllFilters();

      const state3 = useOpsControlFilterStore.getState();
      expect(state3.search).toBe('');
      expect(state3.statusFilter).toBe('all');
    });
  });

  describe('Multiple filter interactions', () => {
    it('allows independent filter updates', () => {
      const state = useOpsControlFilterStore.getState();

      state.setSearch('ORDER-123');
      expect(useOpsControlFilterStore.getState().statusFilter).toBe('all');

      state.setStatusFilter('urgent');
      expect(useOpsControlFilterStore.getState().search).toBe('ORDER-123');

      state.setStageFilter('en_ruta');
      expect(useOpsControlFilterStore.getState().search).toBe('ORDER-123');
      expect(useOpsControlFilterStore.getState().statusFilter).toBe('urgent');
    });

    it('preserves other filters when updating one', () => {
      const state = useOpsControlFilterStore.getState();
      state.setSearch('test');
      state.setDatePreset('tomorrow');
      state.setStatusFilter('urgent');

      state.setStageFilter('en_bodega');

      const finalState = useOpsControlFilterStore.getState();
      expect(finalState.search).toBe('test');
      expect(finalState.datePreset).toBe('tomorrow');
      expect(finalState.statusFilter).toBe('urgent');
      expect(finalState.stageFilter).toBe('en_bodega');
    });
  });
});
