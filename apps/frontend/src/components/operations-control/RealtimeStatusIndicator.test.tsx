/**
 * Tests for RealtimeStatusIndicator component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { RealtimeStatusIndicator } from './RealtimeStatusIndicator';

describe('RealtimeStatusIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Connected state', () => {
    it('shows "En vivo" when connected', () => {
      render(<RealtimeStatusIndicator status="connected" />);
      expect(screen.getByText('En vivo')).toBeTruthy();
    });

    it('shows green dot when connected', () => {
      render(<RealtimeStatusIndicator status="connected" />);
      const dot = screen.getByTestId('status-dot');
      expect(dot.className).toContain('bg-green-500');
    });

    it('green dot has animate-pulse class', () => {
      render(<RealtimeStatusIndicator status="connected" />);
      const dot = screen.getByTestId('status-dot');
      expect(dot.className).toContain('animate-pulse');
    });
  });

  describe('Disconnected state', () => {
    it('shows "Offline" when disconnected', () => {
      render(<RealtimeStatusIndicator status="disconnected" />);
      expect(screen.getByText('Offline')).toBeTruthy();
    });

    it('shows red dot when disconnected', () => {
      render(<RealtimeStatusIndicator status="disconnected" />);
      const dot = screen.getByTestId('status-dot');
      expect(dot.className).toContain('bg-red-500');
    });

    it('red dot does not have animate-pulse', () => {
      render(<RealtimeStatusIndicator status="disconnected" />);
      const dot = screen.getByTestId('status-dot');
      expect(dot.className).not.toContain('animate-pulse');
    });
  });

  describe('lastFetchedAt display', () => {
    it('does not show time text when lastFetchedAt is not provided', () => {
      render(<RealtimeStatusIndicator status="connected" />);
      expect(screen.queryByText(/Actualizado/)).toBeNull();
    });

    it('does not show time text when lastFetchedAt is null', () => {
      render(<RealtimeStatusIndicator status="connected" lastFetchedAt={null} />);
      expect(screen.queryByText(/Actualizado/)).toBeNull();
    });

    it('shows seconds ago when less than 60 seconds', () => {
      const now = new Date();
      const fetchedAt = new Date(now.getTime() - 30_000); // 30 seconds ago
      render(<RealtimeStatusIndicator status="connected" lastFetchedAt={fetchedAt} />);
      expect(screen.getByText(/Actualizado hace 30s/)).toBeTruthy();
    });

    it('shows minutes ago when 60 seconds or more', () => {
      const now = new Date();
      const fetchedAt = new Date(now.getTime() - 120_000); // 2 minutes ago
      render(<RealtimeStatusIndicator status="connected" lastFetchedAt={fetchedAt} />);
      expect(screen.getByText(/Actualizado hace 2m/)).toBeTruthy();
    });

    it('updates display every 10 seconds', () => {
      const now = new Date();
      const fetchedAt = new Date(now.getTime() - 5_000); // 5 seconds ago
      render(<RealtimeStatusIndicator status="connected" lastFetchedAt={fetchedAt} />);

      expect(screen.getByText(/Actualizado hace 5s/)).toBeTruthy();

      // Advance 10 seconds
      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(screen.getByText(/Actualizado hace 15s/)).toBeTruthy();
    });
  });

  describe('Layout', () => {
    it('renders as a flex row container', () => {
      render(<RealtimeStatusIndicator status="connected" />);
      const container = screen.getByTestId('realtime-status-indicator');
      expect(container.className).toContain('flex');
    });
  });
});
