import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TopBar } from './TopBar';

describe('TopBar', () => {
  it('renders brand text', () => {
    render(<TopBar />);
    expect(screen.getByText(/Aureon/)).toBeDefined();
    expect(screen.getByText(/Control de Operaciones/)).toBeDefined();
    expect(screen.getByText(/Mission Deck/)).toBeDefined();
  });

  it('renders formatted date from now prop', () => {
    const now = new Date('2026-04-06T14:30:00');
    render(<TopBar now={now} />);
    // Should render a date string — check for year or month
    expect(screen.getByText(/2026/)).toBeDefined();
  });

  it('renders EN VIVO text', () => {
    render(<TopBar />);
    expect(screen.getByText('EN VIVO')).toBeDefined();
  });

  it('clock ticks: time changes after 1 second', () => {
    vi.useFakeTimers();
    // Start at a known time
    const startTime = new Date('2026-04-06T14:30:00');
    vi.setSystemTime(startTime);

    render(<TopBar />);

    // Get the initial time text
    const initialTimeEl = screen.getByTestId('clock-time');
    const initialText = initialTimeEl.textContent;

    // Advance by 1 second
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const updatedText = screen.getByTestId('clock-time').textContent;
    expect(updatedText).not.toBe(initialText);

    vi.useRealTimers();
  });

  it('renders warehouse code when provided', () => {
    render(<TopBar warehouseCode="SCL-01" />);
    expect(screen.getByText('SCL-01')).toBeDefined();
  });
});
