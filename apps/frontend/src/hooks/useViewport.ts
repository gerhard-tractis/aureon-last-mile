import { useState, useEffect } from 'react';

const MOBILE_QUERY = '(max-width: 768px)';
const DESKTOP_QUERY = '(min-width: 1024px)';
// Tailwind's `lg` breakpoint (1024px) — the pickup landing (spec-54 3h/1l)
// swaps its entire layout at this threshold rather than reflowing within one
// tree. A dedicated query rather than `!isDesktop`: both resolve to the SSR
// -safe `false` before mount either way (see SSR_SAFE_DEFAULT below), but
// `isBelowLg` reads directly as "show the mobile tree" at the call site,
// instead of a negation the reader has to flip.
const BELOW_LG_QUERY = '(max-width: 1023px)';

export interface ViewportState {
  isMobile: boolean;
  isDesktop: boolean;
  isBelowLg: boolean;
}

// Always the SSR-safe default. `/app/pickup` (and other consumers of this
// hook, e.g. DrillSheet/PeriodSelector) are server-rendered — the server has
// no `window`, so it can only ever emit this shape. Deliberately NOT reading
// `window.matchMedia` here: the old code called it inside the `useState`
// initializer, which runs during the client's first render too (unlike an
// effect). On a real phone that first client render would already see the
// true viewport and disagree with the server's HTML — a hydration mismatch
// (React #418/#425) that discards the server-rendered markup and flashes the
// wrong layout. The real value is resolved in the effect below, which never
// runs during SSR and always runs strictly after hydration commits, so the
// first client render is guaranteed to match the server's.
const SSR_SAFE_DEFAULT: ViewportState = {
  isMobile: false,
  isDesktop: false,
  isBelowLg: false,
};

export function useViewport(): ViewportState {
  const [state, setState] = useState<ViewportState>(SSR_SAFE_DEFAULT);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const entries = [
      { mql: window.matchMedia(MOBILE_QUERY), key: 'isMobile' as const },
      { mql: window.matchMedia(DESKTOP_QUERY), key: 'isDesktop' as const },
      { mql: window.matchMedia(BELOW_LG_QUERY), key: 'isBelowLg' as const },
    ];

    // Resolve the real values once mounted (client-only, post-hydration).
    // This is a normal client-side state update — not a hydration diff,
    // because it happens strictly after the first commit.
    setState({
      isMobile: entries[0].mql.matches,
      isDesktop: entries[1].mql.matches,
      isBelowLg: entries[2].mql.matches,
    });

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

/**
 * True below the `lg` breakpoint (1024px) — used by screens that swap their
 * entire layout tree at that width (spec-54's pickup landing: mock 3h below
 * `lg`, mock 1l at `lg` and above) instead of reflowing one tree with
 * responsive classes.
 */
export function useIsBelowLg(): boolean {
  return useViewport().isBelowLg;
}
