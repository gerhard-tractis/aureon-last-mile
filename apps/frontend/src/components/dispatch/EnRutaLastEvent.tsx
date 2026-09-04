'use client';

import { useNowTick } from '@/hooks/dispatch/useNowTick';
import { formatLastEventLabel } from '@/lib/dispatch/en-ruta';

/**
 * ÚLTIMO EVENTO cell — owns its own tick (rule 9 / spec-76 lesson 4) so a
 * 1-minute-granularity re-render happens only for this cell, not the whole
 * table. 60s is enough for a "hace N min" label; the table itself refetches
 * every 30s via `useEnRutaSnapshot`, which is what actually moves the
 * underlying timestamp.
 */
export function EnRutaLastEvent({ lastEventAt }: { lastEventAt: string | null }) {
  const now = useNowTick(60_000);
  return <span className="text-text-secondary">{formatLastEventLabel(lastEventAt, now)}</span>;
}
