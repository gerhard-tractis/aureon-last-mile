import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useIsDockDevice } from './useIsDockDevice';

const STORAGE_KEY = 'dispatch:dock-device';

// This repo's global test setup (src/test/setup.ts) replaces
// `window.location` with a plain stub (`href`/`origin` only, no live
// `search`/pushState) — set `href` directly rather than
// `window.history.pushState`, which the hook itself also does not rely on.
function setHref(search: string) {
  window.location.href = `http://localhost:3000/app/dispatch/route-1${search}`;
}

afterEach(() => {
  window.localStorage.clear();
  setHref('');
});

describe('useIsDockDevice', () => {
  it('defaults to false with no query param and nothing in localStorage', async () => {
    const { result } = renderHook(() => useIsDockDevice());
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('reads a persisted flag from localStorage with no query param', async () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    const { result } = renderHook(() => useIsDockDevice());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('?dock=1 sets the device dock and persists it to localStorage', async () => {
    setHref('?dock=1');
    const { result } = renderHook(() => useIsDockDevice());
    await waitFor(() => expect(result.current).toBe(true));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('?dock=0 clears a previously-set flag — a reassigned tablet is not stuck', async () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    setHref('?dock=0');
    const { result } = renderHook(() => useIsDockDevice());
    await waitFor(() => expect(result.current).toBe(false));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('a server render (no effects) always resolves to false, even if localStorage already has the flag', () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    function Probe() {
      return <>{String(useIsDockDevice())}</>;
    }
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toBe('false');
  });
});
