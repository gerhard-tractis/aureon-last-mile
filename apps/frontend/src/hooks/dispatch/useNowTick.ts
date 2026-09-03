'use client';

import { useEffect, useState } from 'react';

/**
 * spec-75 phase 3, rule 9 — "no dates or times computed at module load".
 * The En carga monitor is a PWA open a whole shift; freshness figures
 * (`último escaneo 8 s`, `sin escaneos 14 min`) must recompute as time
 * passes, not once at mount. This hook is the tick that drives every such
 * recompute: it holds no business logic of its own (see
 * lib/dispatch/loading-monitor.ts for the actual formatting), it only
 * forces a re-render on an interval so components calling those pure
 * functions with `Date.now()` get fresh output.
 *
 * 1s default: the design shows single-second freshness ("8 s") on an
 * actively-loading route, which a slower tick would visibly round down to
 * a stale-looking value.
 */
export function useNowTick(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
