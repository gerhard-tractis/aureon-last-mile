'use client';

import { useNowTick } from '@/hooks/dispatch/useNowTick';
import { formatFreshness, formatStaleness } from '@/lib/dispatch/loading-monitor';

interface Props {
  lastScanAtIso: string;
  stalled: boolean;
}

/**
 * I4 review — the ONLY thing on the whole "En carga" tab that needs to
 * re-render every second. It owns its own `useNowTick()` instead of
 * receiving `now` as a prop, so a tick here re-renders this one `<p>` and
 * nothing else: not the card around it, not its delete AlertDialog
 * subtree, not the other cards in the grid, not the crew panel. Before
 * this existed, the tab's single 1s tick lived at the top and re-rendered
 * every card on every route (including `ready`/`draft` cards with no
 * time-dependent text at all) every second — this is the fix.
 */
export function ScanFreshness({ lastScanAtIso, stalled }: Props) {
  const now = useNowTick();
  return stalled ? (
    <p className="text-xs font-medium text-status-error-text">sin escaneos {formatStaleness(lastScanAtIso, now)}</p>
  ) : (
    <p className="text-xs text-text-secondary">último escaneo {formatFreshness(lastScanAtIso, now)}</p>
  );
}
