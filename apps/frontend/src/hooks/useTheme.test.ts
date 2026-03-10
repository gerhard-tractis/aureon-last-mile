import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTheme, STORAGE_KEY } from './useTheme';

const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    mockMatchMedia(false);
  });

  it('defaults to light when OS is light and no stored value', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(false);
  });

  it('defaults to dark when OS is dark and no stored value', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(true);
  });

  it('uses stored dark preference over OS', () => {
    mockMatchMedia(false);
    localStorage.setItem(STORAGE_KEY, 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(true);
  });

  it('uses stored light preference over OS', () => {
    mockMatchMedia(true);
    localStorage.setItem(STORAGE_KEY, 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(false);
  });

  it('toggle() flips dark state', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(result.current.isDark).toBe(true);
  });

  it('toggle() writes preference to localStorage', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
  });

  it('applies .dark class to <html> when isDark is true', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes .dark class from <html> when isDark is false', () => {
    document.documentElement.classList.add('dark');
    localStorage.setItem(STORAGE_KEY, 'light');
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('responds to OS preference change when no stored override', () => {
    let capturedHandler: ((e: MediaQueryListEvent) => void) | null = null;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn((_, handler) => { capturedHandler = handler; }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(false);
    act(() => {
      capturedHandler!({ matches: true } as MediaQueryListEvent);
    });
    expect(result.current.isDark).toBe(true);
  });

  it('ignores OS preference change after manual toggle', () => {
    let capturedHandler: ((e: MediaQueryListEvent) => void) | null = null;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn((_, handler) => { capturedHandler = handler; }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle()); // writes to localStorage
    expect(result.current.isDark).toBe(true);
    act(() => {
      capturedHandler!({ matches: false } as MediaQueryListEvent); // OS goes light
    });
    expect(result.current.isDark).toBe(true); // should stay dark (manual override)
  });

  it('toggle() twice returns to original state', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    act(() => result.current.toggle());
    expect(result.current.isDark).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
  });
});
