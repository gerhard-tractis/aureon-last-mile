/**
 * Tests for RealtimeStatusIndicator component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
      expect(dot.className).toContain('bg-[var(--color-status-success)]');
    });

    it('green dot has animate-pulse class', () => {
      render(<RealtimeStatusIndicator status="connected" />);
      const dot = screen.getByTestId('status-dot');
      expect(dot.className).toContain('animate-pulse');
    });
  });

  describe('Disconnected state', () => {
    it('shows "Sin conexión" when disconnected', () => {
      render(<RealtimeStatusIndicator status="disconnected" />);
      expect(screen.getByText('Sin conexión')).toBeTruthy();
    });

    it('shows red dot when disconnected', () => {
      render(<RealtimeStatusIndicator status="disconnected" />);
      const dot = screen.getByTestId('status-dot');
      expect(dot.className).toContain('bg-[var(--color-status-error)]');
    });

    it('red dot does not have animate-pulse', () => {
      render(<RealtimeStatusIndicator status="disconnected" />);
      const dot = screen.getByTestId('status-dot');
      expect(dot.className).not.toContain('animate-pulse');
    });
  });

  describe('Stale and live states', () => {
    it('shows live state when lastFetchedAt is recent', () => {
      const now = new Date();
      const fetchedAt = new Date(now.getTime() - 5_000); // 5 seconds ago
      render(<RealtimeStatusIndicator status="connected" lastFetchedAt={fetchedAt} />);
      expect(screen.getByText('En vivo')).toBeTruthy();
      const dot = screen.getByTestId('status-dot');
      expect(dot.className).toContain('bg-[var(--color-status-success)]');
    });

    it('shows stale state when lastFetchedAt is older than 30s', () => {
      const now = new Date();
      const fetchedAt = new Date(now.getTime() - 45_000); // 45 seconds ago
      render(<RealtimeStatusIndicator status="connected" lastFetchedAt={fetchedAt} />);
      expect(screen.getByText('Actualizando...')).toBeTruthy();
      const dot = screen.getByTestId('status-dot');
      expect(dot.className).toContain('bg-[var(--color-status-warning)]');
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
