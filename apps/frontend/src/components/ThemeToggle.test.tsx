import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: vi.fn(),
}));

import { useTheme } from '@/hooks/useTheme';
import ThemeToggle from './ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    vi.mocked(useTheme).mockReturnValue({ isDark: false, toggle: vi.fn() });
  });

  it('renders a button with "switch to dark mode" label in light mode', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeInTheDocument();
  });

  it('renders a button with "switch to light mode" label in dark mode', () => {
    vi.mocked(useTheme).mockReturnValue({ isDark: true, toggle: vi.fn() });
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeInTheDocument();
  });

  it('calls toggle when clicked', () => {
    const toggle = vi.fn();
    vi.mocked(useTheme).mockReturnValue({ isDark: false, toggle });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button'));
    expect(toggle).toHaveBeenCalledOnce();
  });
});
