/**
 * Tests for MobilePullToRefresh component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MobilePullToRefresh } from './MobilePullToRefresh';

// Mock @tanstack/react-query
const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);
const mockUseQueryClient = vi.fn(() => ({
  invalidateQueries: mockInvalidateQueries,
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockUseQueryClient(),
}));

// Helper: simulate a pull-down gesture with sufficient deltaY to trigger refresh.
// jsdom requires touches to be set via the `touches` property on the event init.
async function simulatePullDown(container: HTMLElement, deltaY = 80) {
  await act(async () => {
    fireEvent.touchStart(container, { touches: [{ clientY: 0 }] });
    fireEvent.touchEnd(container, { changedTouches: [{ clientY: deltaY }] });
  });
}

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

  describe('Refresh behavior via touch gesture', () => {
    it('calls invalidateQueries for pipeline-counts on refresh', async () => {
      render(
        <MobilePullToRefresh>
          <div>content</div>
        </MobilePullToRefresh>,
      );

      const container = screen.getByTestId('pull-to-refresh-container');
      await simulatePullDown(container);

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

      const container = screen.getByTestId('pull-to-refresh-container');
      await simulatePullDown(container);

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

      const container = screen.getByTestId('pull-to-refresh-container');
      await simulatePullDown(container);

      // Spinner should be visible immediately after triggering refresh
      expect(screen.getByTestId('refresh-spinner')).toBeTruthy();
    });

    it('does not trigger refresh when pull delta is below threshold', async () => {
      render(
        <MobilePullToRefresh>
          <div>content</div>
        </MobilePullToRefresh>,
      );

      const container = screen.getByTestId('pull-to-refresh-container');
      await simulatePullDown(container, 30); // below 60px threshold

      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });

    it('does not trigger a second refresh while the first is in progress', async () => {
      render(
        <MobilePullToRefresh>
          <div>content</div>
        </MobilePullToRefresh>,
      );

      const container = screen.getByTestId('pull-to-refresh-container');

      // First pull — triggers refresh, sets isRefreshing=true
      await simulatePullDown(container);
      const firstCallCount = mockInvalidateQueries.mock.calls.length;
      expect(firstCallCount).toBe(2);

      // Second pull while still refreshing — should be a no-op
      await simulatePullDown(container);

      // Call count should not have increased
      expect(mockInvalidateQueries).toHaveBeenCalledTimes(2);
    });

    it('calls onRefreshStart callback when provided', async () => {
      const onRefreshStart = vi.fn();
      render(
        <MobilePullToRefresh onRefreshStart={onRefreshStart}>
          <div>content</div>
        </MobilePullToRefresh>,
      );

      const container = screen.getByTestId('pull-to-refresh-container');
      await simulatePullDown(container);

      expect(onRefreshStart).toHaveBeenCalledTimes(1);
    });
  });
});
