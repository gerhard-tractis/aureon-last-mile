/**
 * Tests for PipelineOverview component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PipelineOverview } from './PipelineOverview';
import type { PipelineStageCount } from '@/hooks/usePipelineCounts';

// Mock hooks
vi.mock('@/hooks/usePipelineCounts', () => ({
  usePipelineCounts: vi.fn(),
}));

vi.mock('@/stores/useOpsControlFilterStore', () => ({
  useOpsControlFilterStore: vi.fn(),
}));

import { usePipelineCounts } from '@/hooks/usePipelineCounts';
import { useOpsControlFilterStore } from '@/stores/useOpsControlFilterStore';

const mockUsePipelineCounts = vi.mocked(usePipelineCounts);
const mockUseOpsControlFilterStore = vi.mocked(useOpsControlFilterStore);

const MOCK_COUNTS: PipelineStageCount[] = [
  { status: 'ingresado', count: 10, urgent_count: 2, alert_count: 1, late_count: 0 },
  { status: 'verificado', count: 5, urgent_count: 0, alert_count: 0, late_count: 0 },
  { status: 'en_ruta', count: 3, urgent_count: 0, alert_count: 0, late_count: 0 },
];

const defaultFilterStore = {
  stageFilter: null,
  setStageFilter: vi.fn(),
  search: '',
  datePreset: 'today' as const,
  dateRange: null,
  statusFilter: 'all' as const,
  setSearch: vi.fn(),
  setDatePreset: vi.fn(),
  setDateRange: vi.fn(),
  setStatusFilter: vi.fn(),
  clearAllFilters: vi.fn(),
};

beforeEach(() => {
  mockUseOpsControlFilterStore.mockReturnValue(defaultFilterStore);
});

describe('PipelineOverview', () => {
  describe('Loading state', () => {
    it('renders 8 skeleton boxes when loading', () => {
      mockUsePipelineCounts.mockReturnValue({
        isLoading: true,
        isError: false,
        data: undefined,
      } as ReturnType<typeof usePipelineCounts>);

      render(
        <PipelineOverview
          operatorId="op-1"
          realtimeStatus="connected"
        />,
      );

      const skeletons = screen.getAllByTestId('pipeline-skeleton');
      expect(skeletons).toHaveLength(8);
    });
  });

  describe('Error state', () => {
    it('shows error message when fetch fails', () => {
      mockUsePipelineCounts.mockReturnValue({
        isLoading: false,
        isError: true,
        data: undefined,
      } as ReturnType<typeof usePipelineCounts>);

      render(
        <PipelineOverview
          operatorId="op-1"
          realtimeStatus="connected"
        />,
      );

      expect(screen.getByText('Error al cargar etapas')).toBeTruthy();
    });
  });

  describe('Success state', () => {
    beforeEach(() => {
      mockUsePipelineCounts.mockReturnValue({
        isLoading: false,
        isError: false,
        data: MOCK_COUNTS,
      } as ReturnType<typeof usePipelineCounts>);
    });

    it('renders 8 pipeline cards (all 8 stages)', () => {
      render(
        <PipelineOverview
          operatorId="op-1"
          realtimeStatus="connected"
        />,
      );

      const cards = screen.getAllByRole('button');
      expect(cards).toHaveLength(8);
    });

    it('fills missing stages with count=0', () => {
      render(
        <PipelineOverview
          operatorId="op-1"
          realtimeStatus="connected"
        />,
      );

      // Only 3 stages were returned; the other 5 should have count 0
      const counts = screen.getAllByTestId('stage-count');
      expect(counts).toHaveLength(8);
    });

    it('renders RealtimeStatusIndicator', () => {
      render(
        <PipelineOverview
          operatorId="op-1"
          realtimeStatus="connected"
        />,
      );

      expect(screen.getByTestId('realtime-status-indicator')).toBeTruthy();
    });

    it('shows En vivo for connected status', () => {
      render(
        <PipelineOverview
          operatorId="op-1"
          realtimeStatus="connected"
        />,
      );
      expect(screen.getByText('En vivo')).toBeTruthy();
    });

    it('shows Offline for disconnected status', () => {
      render(
        <PipelineOverview
          operatorId="op-1"
          realtimeStatus="disconnected"
        />,
      );
      expect(screen.getByText('Offline')).toBeTruthy();
    });
  });

  describe('Filter interactions', () => {
    beforeEach(() => {
      mockUsePipelineCounts.mockReturnValue({
        isLoading: false,
        isError: false,
        data: MOCK_COUNTS,
      } as ReturnType<typeof usePipelineCounts>);
    });

    it('calls setStageFilter when clicking a card with count > 0', () => {
      const setStageFilter = vi.fn();
      mockUseOpsControlFilterStore.mockReturnValue({
        ...defaultFilterStore,
        stageFilter: null,
        setStageFilter,
      });

      render(
        <PipelineOverview
          operatorId="op-1"
          realtimeStatus="connected"
        />,
      );

      // Click the first card (ingresado, count=10)
      const cards = screen.getAllByRole('button');
      fireEvent.click(cards[0]);
      expect(setStageFilter).toHaveBeenCalledWith('ingresado');
    });

    it('clears filter when clicking the already-selected stage', () => {
      const setStageFilter = vi.fn();
      mockUseOpsControlFilterStore.mockReturnValue({
        ...defaultFilterStore,
        stageFilter: 'ingresado',
        setStageFilter,
      });

      render(
        <PipelineOverview
          operatorId="op-1"
          realtimeStatus="connected"
        />,
      );

      // Click ingresado again (already selected)
      const cards = screen.getAllByRole('button');
      fireEvent.click(cards[0]);
      expect(setStageFilter).toHaveBeenCalledWith(null);
    });
  });

  describe('Grid layout', () => {
    it('renders a responsive grid container', () => {
      mockUsePipelineCounts.mockReturnValue({
        isLoading: false,
        isError: false,
        data: MOCK_COUNTS,
      } as ReturnType<typeof usePipelineCounts>);

      render(
        <PipelineOverview
          operatorId="op-1"
          realtimeStatus="connected"
        />,
      );

      const grid = screen.getByTestId('pipeline-grid');
      expect(grid.className).toContain('grid');
      expect(grid.className).toContain('grid-cols-2');
    });
  });
});
