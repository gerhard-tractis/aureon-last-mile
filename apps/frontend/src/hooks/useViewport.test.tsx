import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useViewport, useIsMobileFromViewport, useIsBelowLg } from './useViewport';

type MatchFn = (q: string) => boolean;

function mockMatchMedia(matchFn: MatchFn) {
  const listeners: Map<string, ((e: MediaQueryListEvent) => void)[]> = new Map();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: matchFn(query),
      media: query,
      addEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
        if (!listeners.has(query)) listeners.set(query, []);
        listeners.get(query)!.push(handler);
      }),
      removeEventListener: vi.fn(),
    })),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useViewport', () => {
  it('returns isMobile=true at mobile viewport', () => {
    mockMatchMedia((q) => q.includes('max-width: 768px'));
    const { result } = renderHook(() => useViewport());
    expect(result.current.isMobile).toBe(true);
    expect(result.current.isDesktop).toBe(false);
  });

  it('returns isDesktop=true at desktop viewport', () => {
    mockMatchMedia((q) => q.includes('1024px'));
    const { result } = renderHook(() => useViewport());
    expect(result.current.isMobile).toBe(false);
    expect(result.current.isDesktop).toBe(true);
  });

  it('returns all false when window is unavailable (SSR)', () => {
    // jsdom sets window.matchMedia - stub it to undefined
    Object.defineProperty(window, 'matchMedia', { writable: true, value: undefined });
    const { result } = renderHook(() => useViewport());
    expect(result.current.isMobile).toBe(false);
    expect(result.current.isDesktop).toBe(false);
  });
});

describe('hasTabletHeight (spec-78, the dock tablet height cut)', () => {
  it('is true at tablet height (min-height: 700px matches)', () => {
    mockMatchMedia((q) => q.includes('min-height: 700px'));
    const { result } = renderHook(() => useViewport());
    expect(result.current.hasTabletHeight).toBe(true);
  });

  it('is false for a phone in landscape (844 × 390 — width matches desktop, height does not)', () => {
    mockMatchMedia((q) => q.includes('1024px')); // DESKTOP_QUERY matches; height query does not
    const { result } = renderHook(() => useViewport());
    expect(result.current.isDesktop).toBe(true);
    expect(result.current.hasTabletHeight).toBe(false);
  });
});

describe('useIsMobileFromViewport', () => {
  it('returns true on mobile viewport', () => {
    mockMatchMedia((q) => q.includes('max-width: 768px'));
    const { result } = renderHook(() => useIsMobileFromViewport());
    expect(result.current).toBe(true);
  });

  it('returns false on desktop viewport', () => {
    mockMatchMedia((q) => q.includes('1024px'));
    const { result } = renderHook(() => useIsMobileFromViewport());
    expect(result.current).toBe(false);
  });
});

describe('useIsBelowLg', () => {
  it('returns true below the lg breakpoint (max-width: 1023px matches)', () => {
    mockMatchMedia((q) => q.includes('max-width: 1023px'));
    const { result } = renderHook(() => useIsBelowLg());
    expect(result.current).toBe(true);
  });

  it('returns false at/above the lg breakpoint — matches the global test default', () => {
    mockMatchMedia(() => false);
    const { result } = renderHook(() => useIsBelowLg());
    expect(result.current).toBe(false);
  });
});

// spec-54 3h review fix (critical #2) — the old implementation read
// `window.matchMedia` inside the `useState` initializer, which runs during
// the client's FIRST render (hydration), not just after mount. On a real
// phone that first client render would already see the true viewport and
// disagree with what the server rendered (no `window` ⇒ always false) —
// React #418/#425, discarding the server HTML and flashing the wrong
// layout. `renderToStaticMarkup` never runs effects (true of SSR in any
// environment, including jsdom), so it exercises exactly the code path the
// server executes: only the initializer, never the mount effect.
describe('SSR hydration safety', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a server render (no effects) always resolves to the safe default, even if matchMedia already matches', () => {
    // Simulates a phone: every query matches, as it would client-side.
    mockMatchMedia(() => true);

    function Probe() {
      const { isBelowLg, isMobile, isDesktop } = useViewport();
      return <>{JSON.stringify({ isBelowLg, isMobile, isDesktop })}</>;
    }

    const html = renderToStaticMarkup(<Probe />);
    // If the initializer read matchMedia directly (the bug), this would be
    // `{"isBelowLg":true,"isMobile":true,"isDesktop":true}` — disagreeing
    // with what a real Node SSR pass (no `window` at all) would produce.
    // React HTML-escapes the JSON's quotes as text content, so decode them
    // before comparing.
    expect(html.replace(/&quot;/g, '"')).toBe(
      JSON.stringify({ isBelowLg: false, isMobile: false, isDesktop: false }),
    );
  });

  it('the mount effect then resolves the real value on the client (post-hydration)', () => {
    mockMatchMedia((q) => q.includes('max-width: 1023px'));
    const { result } = renderHook(() => useViewport());
    // By the time renderHook (which flushes effects via act()) returns, the
    // client has "hydrated" and corrected the value — proving the app still
    // ends up on the right layout, just without an SSR mismatch on the way.
    expect(result.current.isBelowLg).toBe(true);
  });
});
