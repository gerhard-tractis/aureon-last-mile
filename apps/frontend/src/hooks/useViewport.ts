import { useState, useEffect } from 'react';

const MOBILE_QUERY = '(max-width: 768px)';
const DESKTOP_QUERY = '(min-width: 1024px)';

export interface ViewportState {
  isMobile: boolean;
  isDesktop: boolean;
}

function queryMatches(query: string): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

export function useViewport(): ViewportState {
  const [state, setState] = useState<ViewportState>(() => ({
    isMobile: queryMatches(MOBILE_QUERY),
    isDesktop: queryMatches(DESKTOP_QUERY),
  }));

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const entries = [
      { mql: window.matchMedia(MOBILE_QUERY), key: 'isMobile' as const },
      { mql: window.matchMedia(DESKTOP_QUERY), key: 'isDesktop' as const },
    ];

    const cleanup = entries.map(({ mql, key }) => {
      const handler = (e: MediaQueryListEvent) =>
        setState((prev) => ({ ...prev, [key]: e.matches }));
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    });

    return () => cleanup.forEach((fn) => fn());
  }, []);

  return state;
}

/** Backward-compatible helper exported alongside useViewport */
export function useIsMobileFromViewport(): boolean {
  return useViewport().isMobile;
}
