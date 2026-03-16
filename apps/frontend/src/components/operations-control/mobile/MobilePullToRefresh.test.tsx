/**
 * Tests for MobilePullToRefresh component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MobilePullToRefresh } from './MobilePullToRefresh';

// Mock @tanstack/react-query
const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);
const mockUseQueryClient = vi.fn(() => ({
  invalidateQueries: mockInvalidateQueries,
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockUseQueryClient(),
}));

// Helper: build a minimal TouchEvent-like object that jsdom can handle
// jsdom does not support the Touch constructor, so we simulate via fireEvent
// with custom data. Instead, we directly test the component's triggerRefresh
// method via the data-testid="trigger-refresh" button exposed in test mode.

describe('MobilePullToRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders children', () => {
      render(
        <MobilePullToRefresh>
          <div data-testid="child">Hello</div>
        </MobilePullToRefresh>,
      );
      expect(screen.getByTestId('child')).toBeTruthy();
      expect(screen.getByText('Hello')).toBeTruthy();
    });

    it('renders with pull-to-refresh-container test id', () => {
      render(
        <MobilePullToRefresh>
          <div>content</div>
        </MobilePullToRefresh>,
      );
      expect(screen.getByTestId('pull-to-refresh-container')).toBeTruthy();
    });

    it('does not show spinner initially', () => {
      render(
        <MobilePullToRefresh>
          <div>content</div>
        </MobilePullToRefresh>,
      );
      expect(screen.queryByTestId('refresh-spinner')).toBeNull();
    });
  });

  describe('Refresh behavior via test trigger', () => {
    it('calls invalidateQueries for pipeline-counts on refresh', async () => {
      render(
        <MobilePullToRefresh>
          <div>content</div>
        </MobilePullToRefresh>,
      );

      // Use the hidden test-trigger button to invoke triggerRefresh
      const triggerBtn = screen.getByTestId('test-trigger-refresh');
      await act(async () => {
        triggerBtn.click();
      });

      expect(mockInvalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['pipeline-counts'] }),
      );
    });

    it('calls invalidateQueries for operations-orders on refresh', async () => {
      render(
        <MobilePullToRefresh>
          <div>content</div>
        </MobilePullToRefresh>,
      );

      const triggerBtn = screen.getByTestId('test-trigger-refresh');
      await act(async () => {
        triggerBtn.click();
      });

      expect(mockInvalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['operations-orders'] }),
      );
    });

    it('shows spinner when refreshing', async () => {
      render(
        <MobilePullToRefresh>
          <div>content</div>
        </MobilePullToRefresh>,
      );

      const triggerBtn = screen.getByTestId('test-trigger-refresh');
      await act(async () => {
        triggerBtn.click();
      });

      // Spinner should be visible immediately after triggering refresh
      expect(screen.getByTestId('refresh-spinner')).toBeTruthy();
    });

    it('does not trigger a second refresh while the first is in progress', async () => {
      render(
        <MobilePullToRefresh>
          <div>content</div>
        </MobilePullToRefresh>,
      );

      const triggerBtn = screen.getByTestId('test-trigger-refresh');

      // First click — triggers refresh, sets isRefreshing=true
      await act(async () => {
        triggerBtn.click();
      });
      const firstCallCount = mockInvalidateQueries.mock.calls.length;
      expect(firstCallCount).toBe(2);

      // Second click while still refreshing — should be a no-op
      await act(async () => {
        triggerBtn.click();
      });

      // Call count should not have increased
      expect(mockInvalidateQueries).toHaveBeenCalledTimes(2);
    });
  });
});
