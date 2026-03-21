'use client';

import { useState, useCallback } from 'react';

export const SIDEBAR_PIN_KEY = 'aureon-sidebar-pinned';

export function useSidebarPin() {
  const [pinned, setPinned] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(SIDEBAR_PIN_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const togglePin = useCallback(() => {
    setPinned((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_PIN_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return { pinned, togglePin };
}
