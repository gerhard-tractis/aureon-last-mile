import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useViewport, useIsMobileFromViewport } from './useViewport';

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
