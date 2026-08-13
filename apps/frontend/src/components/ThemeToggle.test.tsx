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

  it('renders Claro and Oscuro segments when no custom branding', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Tema claro' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tema oscuro' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tema de marca' })).not.toBeInTheDocument();
  });

  it('renders the brand segment when hasBranding is true', () => {
    vi.mocked(useBranding).mockReturnValue({
      hasBranding: true,
      palette: { brand_primary: '#ff0000', brand_background: '#ffffff', brand_text: '#000000' },
      logoUrl: null,
      faviconUrl: null,
      companyName: null,
      isLoading: false,
    });
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Tema de marca' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Tema oscuro' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tema claro' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls setMode with correct value when a button is clicked', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Tema oscuro' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Tema de marca' }));
    expect(mockSetMode).toHaveBeenCalledWith('custom');
  });

  it('labels the segmented group', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('group', { name: 'Tema' })).toBeInTheDocument();
  });
});

describe('ThemeToggle — segmented control (spec-54)', () => {
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
  });

  it('shows both choices at once rather than a single cycling button', () => {
    // The operator has to see which theme is active without clicking to find out.
    render(<ThemeToggle />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('Claro')).toBeInTheDocument();
    expect(screen.getByText('Oscuro')).toBeInTheDocument();
  });

  it('drops the text labels in compact mode but keeps both buttons reachable', () => {
    render(<ThemeToggle compact />);
    expect(screen.queryByText('Claro')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tema claro' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tema oscuro' })).toBeInTheDocument();
  });
});
