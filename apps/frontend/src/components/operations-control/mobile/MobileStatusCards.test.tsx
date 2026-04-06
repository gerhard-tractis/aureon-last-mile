/**
 * Tests for MobileStatusCards component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileStatusCards } from './MobileStatusCards';

const mockSetStatusFilter = vi.fn();

const defaultStoreState = {
  search: '',
  datePreset: 'today' as const,
  dateRange: null,
  statusFilter: 'all' as const,
  stageFilter: null,
  setSearch: vi.fn(),
  setDatePreset: vi.fn(),
  setDateRange: vi.fn(),
  setStatusFilter: mockSetStatusFilter,
  setStageFilter: vi.fn(),
  clearAllFilters: vi.fn(),
};

vi.mock('@/lib/stores/useOpsControlFilterStore', () => ({
  useOpsControlFilterStore: vi.fn(() => defaultStoreState),
}));

import { useOpsControlFilterStore } from '@/lib/stores/useOpsControlFilterStore';

const defaultCounts = { urgent: 3, alert: 12, ok: 45, late: 2 };

describe('MobileStatusCards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useOpsControlFilterStore).mockReturnValue(defaultStoreState);
  });

  describe('Labels', () => {
    it('renders Urgentes label', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      expect(screen.getByText('Urgentes')).toBeTruthy();
    });

    it('renders Alertas label', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      expect(screen.getByText('Alertas')).toBeTruthy();
    });

    it('renders OK label', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      expect(screen.getByText('OK')).toBeTruthy();
    });

    it('renders Atrasados label', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      expect(screen.getByText('Atrasados')).toBeTruthy();
    });

    it('renders all 4 cards', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      expect(screen.getByTestId('status-card-urgent')).toBeTruthy();
      expect(screen.getByTestId('status-card-alert')).toBeTruthy();
      expect(screen.getByTestId('status-card-ok')).toBeTruthy();
      expect(screen.getByTestId('status-card-late')).toBeTruthy();
    });
  });

  describe('Count display', () => {
    it('displays correct urgent count', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      const card = screen.getByTestId('status-card-urgent');
      expect(card.textContent).toContain('3');
    });

    it('displays correct alert count', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      const card = screen.getByTestId('status-card-alert');
      expect(card.textContent).toContain('12');
    });

    it('displays correct ok count', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      const card = screen.getByTestId('status-card-ok');
      expect(card.textContent).toContain('45');
    });

    it('displays correct late count', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      const card = screen.getByTestId('status-card-late');
      expect(card.textContent).toContain('2');
    });
  });

  describe('Click interactions', () => {
    it('clicking urgent card calls setStatusFilter with "urgent"', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      fireEvent.click(screen.getByTestId('status-card-urgent'));
      expect(mockSetStatusFilter).toHaveBeenCalledWith('urgent');
    });

    it('clicking alert card calls setStatusFilter with "alert"', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      fireEvent.click(screen.getByTestId('status-card-alert'));
      expect(mockSetStatusFilter).toHaveBeenCalledWith('alert');
    });

    it('clicking ok card calls setStatusFilter with "ok"', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      fireEvent.click(screen.getByTestId('status-card-ok'));
      expect(mockSetStatusFilter).toHaveBeenCalledWith('ok');
    });

    it('clicking late card calls setStatusFilter with "late"', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      fireEvent.click(screen.getByTestId('status-card-late'));
      expect(mockSetStatusFilter).toHaveBeenCalledWith('late');
    });
  });

  describe('Toggle (clicking active card clears filter)', () => {
    it('clicking the already-active urgent card calls setStatusFilter("all")', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        statusFilter: 'urgent',
      });
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      fireEvent.click(screen.getByTestId('status-card-urgent'));
      expect(mockSetStatusFilter).toHaveBeenCalledWith('all');
    });

    it('clicking the already-active alert card calls setStatusFilter("all")', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        statusFilter: 'alert',
      });
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      fireEvent.click(screen.getByTestId('status-card-alert'));
      expect(mockSetStatusFilter).toHaveBeenCalledWith('all');
    });

    it('clicking a non-active card when another is active sets that filter', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        statusFilter: 'urgent',
      });
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      fireEvent.click(screen.getByTestId('status-card-alert'));
      expect(mockSetStatusFilter).toHaveBeenCalledWith('alert');
    });
  });

  describe('Loading state', () => {
    it('shows skeleton container when isLoading=true', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={true} />);
      expect(screen.getByTestId('status-cards-skeleton')).toBeTruthy();
    });

    it('does not show cards when isLoading=true', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={true} />);
      expect(screen.queryByTestId('status-card-urgent')).toBeNull();
      expect(screen.queryByTestId('status-card-alert')).toBeNull();
      expect(screen.queryByTestId('status-card-ok')).toBeNull();
      expect(screen.queryByTestId('status-card-late')).toBeNull();
    });

    it('shows cards when isLoading=false', () => {
      render(<MobileStatusCards counts={defaultCounts} isLoading={false} />);
      expect(screen.queryByTestId('status-cards-skeleton')).toBeNull();
      expect(screen.getByTestId('status-card-urgent')).toBeTruthy();
    });
  });
});
