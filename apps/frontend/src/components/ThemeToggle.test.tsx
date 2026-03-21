import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: vi.fn(),
}));

vi.mock('@/providers/BrandingProvider', () => ({
  useBranding: vi.fn(),
}));

import { useTheme } from '@/hooks/useTheme';
import { useBranding } from '@/providers/BrandingProvider';
import ThemeToggle from './ThemeToggle';

const mockSetMode = vi.fn();

describe('ThemeToggle', () => {
  beforeEach(() => {
    vi.mocked(useTheme).mockReturnValue({
      mode: 'light',
      setMode: mockSetMode,
      toggle: vi.fn(),
      isDark: false,
      isCustom: false,
    });
    vi.mocked(useBranding).mockReturnValue({
      hasBranding: false,
      palette: null,
      logoUrl: null,
      faviconUrl: null,
      companyName: null,
      isLoading: false,
    });
    mockSetMode.mockClear();
  });

  it('renders light and dark buttons when no custom branding', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Light mode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dark mode' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Brand mode' })).not.toBeInTheDocument();
  });

  it('renders brand mode button when hasBranding is true', () => {
    vi.mocked(useBranding).mockReturnValue({
      hasBranding: true,
      palette: { brand_primary: '#ff0000', brand_background: '#ffffff', brand_text: '#000000' },
      logoUrl: null,
      faviconUrl: null,
      companyName: null,
      isLoading: false,
    });
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Brand mode' })).toBeInTheDocument();
  });

  it('marks the active mode button as pressed', () => {
    vi.mocked(useTheme).mockReturnValue({
      mode: 'dark',
      setMode: mockSetMode,
      toggle: vi.fn(),
      isDark: true,
      isCustom: false,
    });
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Light mode' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls setMode with correct value when a button is clicked', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Dark mode' }));
    expect(mockSetMode).toHaveBeenCalledWith('dark');
  });

  it('calls setMode with "custom" when brand mode button is clicked', () => {
    vi.mocked(useBranding).mockReturnValue({
      hasBranding: true,
      palette: { brand_primary: '#ff0000', brand_background: '#ffffff', brand_text: '#000000' },
      logoUrl: null,
      faviconUrl: null,
      companyName: null,
      isLoading: false,
    });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Brand mode' }));
    expect(mockSetMode).toHaveBeenCalledWith('custom');
  });

  it('renders the group container with correct aria-label', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('group', { name: 'Theme mode' })).toBeInTheDocument();
  });
});
