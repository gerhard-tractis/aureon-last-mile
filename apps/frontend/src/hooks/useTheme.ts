'use client';

import { useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'custom';

export const STORAGE_KEY = 'aureon-theme';

interface UseThemeOptions {
  hasCustomBranding?: boolean;
}

interface UseThemeReturn {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
  isDark: boolean;
  isCustom: boolean;
}

function getInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'custom') return saved;
  } catch { /* ignore */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme({ hasCustomBranding = false }: UseThemeOptions = {}): UseThemeReturn {
  const [mode, setModeState] = useState<ThemeMode>(getInitialMode);

  // Apply class to <html> on mode change
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark', 'custom');
    root.classList.add(mode);
  }, [mode]);

  // Listen for system preference changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) setModeState(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const setMode = useCallback(
    (next: ThemeMode) => {
      const resolved: ThemeMode = next === 'custom' && !hasCustomBranding ? 'light' : next;
      try { localStorage.setItem(STORAGE_KEY, resolved); } catch { /* ignore */ }
      setModeState(resolved);
    },
    [hasCustomBranding]
  );

  const toggle = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  return { mode, setMode, toggle, isDark: mode === 'dark', isCustom: mode === 'custom' };
}
