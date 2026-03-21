import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSidebarPin, SIDEBAR_PIN_KEY } from './useSidebarPin';

beforeEach(() => {
  localStorage.clear();
});

describe('useSidebarPin', () => {
  it('defaults to unpinned', () => {
    const { result } = renderHook(() => useSidebarPin());
    expect(result.current.pinned).toBe(false);
  });

  it('restores pinned state from localStorage', () => {
    localStorage.setItem(SIDEBAR_PIN_KEY, 'true');
    const { result } = renderHook(() => useSidebarPin());
    expect(result.current.pinned).toBe(true);
  });

  it('togglePin switches state', () => {
    const { result } = renderHook(() => useSidebarPin());
    act(() => { result.current.togglePin(); });
    expect(result.current.pinned).toBe(true);
    act(() => { result.current.togglePin(); });
    expect(result.current.pinned).toBe(false);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useSidebarPin());
    act(() => { result.current.togglePin(); });
    expect(localStorage.getItem(SIDEBAR_PIN_KEY)).toBe('true');
  });
});
