import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme, STORAGE_KEY } from './useTheme';

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  localStorage.clear();
  document.documentElement.className = '';
});

describe('useTheme', () => {
  it('defaults to light mode when no saved preference', () => {
    const { result } = renderHook(() => useTheme({}));
    expect(result.current.mode).toBe('light');
  });

  it('restores saved mode from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    const { result } = renderHook(() => useTheme({}));
    expect(result.current.mode).toBe('dark');
  });

  it('applies the mode class to documentElement', () => {
    const { result } = renderHook(() => useTheme({}));
    act(() => { result.current.setMode('dark'); });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('persists mode to localStorage', () => {
    const { result } = renderHook(() => useTheme({}));
    act(() => { result.current.setMode('dark'); });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
  });

  it('toggle switches between light and dark', () => {
    const { result } = renderHook(() => useTheme({}));
    act(() => { result.current.toggle(); });
    expect(result.current.mode).toBe('dark');
    act(() => { result.current.toggle(); });
    expect(result.current.mode).toBe('light');
  });

  it('does not allow custom mode when hasCustomBranding is false', () => {
    const { result } = renderHook(() => useTheme({ hasCustomBranding: false }));
    act(() => { result.current.setMode('custom'); });
    expect(result.current.mode).toBe('light');
  });

  it('allows custom mode when hasCustomBranding is true', () => {
    const { result } = renderHook(() => useTheme({ hasCustomBranding: true }));
    act(() => { result.current.setMode('custom'); });
    expect(result.current.mode).toBe('custom');
    expect(result.current.isCustom).toBe(true);
  });

  it('exposes isDark: true only in dark mode', () => {
    const { result } = renderHook(() => useTheme({}));
    act(() => { result.current.setMode('dark'); });
    expect(result.current.isDark).toBe(true);
    act(() => { result.current.setMode('light'); });
    expect(result.current.isDark).toBe(false);
  });
});
