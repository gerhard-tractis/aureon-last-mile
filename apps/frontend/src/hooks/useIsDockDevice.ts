'use client';

// apps/frontend/src/hooks/useIsDockDevice.ts
//
// spec-78 decision 1 (revised after the coordinator's correction — see the
// "Lecciones aplicadas" entry this task added to the spec for the full
// story) — a per-device DISPLAY preference, not identity or authorisation.
// `?dock=1` marks THIS browser (persisted in localStorage) as the tablet
// mounted at a loading dock, so `DispatchRouteSurface` shows the crew scan
// loop (`3a`) instead of the manager's desktop tree at the same viewport
// width. `?dock=0` clears it — a tablet reassigned to another job isn't
// stuck. Say it plainly for the next reader: this grants nothing. A dock
// browser reads the same data under the same RLS as any other session; it
// only changes which layout renders client-side.
//
// Why this over the local `scanning` flag the mobile tree already has
// (`DispatchRouteSurface`'s own `useState`): that flag resets on every
// load/navigation, and the only screen that ever sets it true
// (`DispatchRouteBeforeScan`) never mounts at width >= 1024 — a tablet
// opened fresh at that width could never reach it, spec-78's own fase-1
// tests notwithstanding. A tablet mounted on a post for a whole shift has
// to survive a page reload (or another crew moving the route to
// `loading`) without losing its way back into the loop — "a device
// nobody wants to touch mid-shift is exactly the device that must not
// need touching to recover." This flag is provisioned once, when the
// device goes on the wall, and never touched again.
//
// SSR-safe: resolved in an effect, exactly like useViewport.ts's own
// SSR_SAFE_DEFAULT. Reading localStorage/location.search inside the
// useState initialiser would run on the client's FIRST render too (before
// hydration reconciles), disagreeing with the server's `false` and
// tripping the same hydration bug useViewport.ts's header documents.
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'dispatch:dock-device';

export function useIsDockDevice(): boolean {
  const [isDock, setIsDock] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      // `new URL(href, origin)` rather than `window.location.search`
      // directly: this repo's test setup (src/test/setup.ts) replaces
      // `window.location` with a plain stub carrying only `href`/`origin`,
      // no live `search` getter — parsing `href` works against both that
      // stub and a real browser Location.
      const flag = new URL(window.location.href, window.location.origin).searchParams.get('dock');
      if (flag === '1') {
        window.localStorage.setItem(STORAGE_KEY, '1');
        setIsDock(true);
        return;
      }
      if (flag === '0') {
        window.localStorage.removeItem(STORAGE_KEY);
        setIsDock(false);
        return;
      }
      setIsDock(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      // Private browsing / storage disabled — a dock tablet is a
      // provisioned device, not a guess; failing closed (manager's tree)
      // is the safe default when the flag can't be read at all.
      setIsDock(false);
    }
  }, []);

  return isDock;
}
