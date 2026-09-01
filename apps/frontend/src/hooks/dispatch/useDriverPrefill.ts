import { useEffect, useRef, useState } from 'react';
import type { TerritoryHistoryEntry } from '@/lib/dispatch/types';

/**
 * spec-72 phase 4 (Decision 6) — "pre-fills that route's driver."
 *
 * Fires at most once per mount, and only while `driverName` is still empty
 * (a manager who already typed something, or who deliberately cleared the
 * field after an earlier auto-fill, is never overwritten). Only pre-fills
 * when every comuna this route's territory history covers agrees on ONE
 * driver — an ambiguous route (different comunas, different usual drivers)
 * is left blank rather than guessing, and TerritoryStability.tsx still
 * renders a per-comuna warning once the manager types someone else in.
 *
 * Phase-4 review item 1 (HIGH) — thin evidence: `get_route_territory_history`
 * resolves each comuna to its most-recent non-cancelled driver, so a cover
 * driver who drove the route exactly once yesterday outranks the regular
 * driver's 20 prior runs, and — the dangerous part — if the manager types
 * that regular driver's name back in, it now MATCHES what was pre-filled,
 * so no divergence warning renders either. A single prior run is not a
 * territory. This hook refuses to pre-fill unless EVERY comuna's run_count
 * is > 1 (kept as "most recent wins" per-comuna, per the migration's own
 * decision — see 20260903000006's header — but a substitute's single
 * showing is not allowed to silently outrank the regular driver in the
 * field a manager reads).
 *
 * The second half of Decision 6 lives here too: the caller must be able to
 * tell an auto-filled value from a typed one. `isAutoFilled` is true only
 * for the value THIS hook set, and flips back to false the moment
 * `driverName` diverges from that value for any reason (the manager typed
 * over it, or cleared it) — never re-derived from territory again this
 * mount (see the review's "type → clear → late fill" note below).
 */
export function useDriverPrefill(
  territory: TerritoryHistoryEntry[],
  driverName: string,
  setDriverName: (name: string) => void,
): boolean {
  const didPrefill = useRef(false);
  const prefilledValue = useRef<string | null>(null);
  const [isAutoFilled, setIsAutoFilled] = useState(false);

  useEffect(() => {
    if (didPrefill.current) return;

    if (driverName.trim() !== '') {
      // Phase-4 review "also consider": a field that was ever non-empty
      // this mount (typed by a manager, then cleared, or pre-populated from
      // elsewhere) must never be filled later either — without this, type →
      // clear → territory-resolves fires a late, surprising fill mid-edit.
      // Lock prefilling for the rest of this mount rather than only
      // skipping this one render.
      didPrefill.current = true;
      return;
    }

    if (territory.length === 0) return;

    const distinctDrivers = new Set(territory.map((t) => t.driverName));
    if (distinctDrivers.size !== 1) return;

    // Review item 1 (HIGH): refuse thin evidence. A comuna whose "most
    // recent" driver only ran it once is not a stable territory yet — do
    // not let a single substitute run silently become the pre-filled
    // value (and, downstream, the value that then matches what a manager
    // types, suppressing TerritoryStability's own divergence warning).
    const hasThinEvidence = territory.some((t) => t.runCount <= 1);
    if (hasThinEvidence) return;

    setDriverName(territory[0].driverName);
    prefilledValue.current = territory[0].driverName;
    setIsAutoFilled(true);
    didPrefill.current = true;
  }, [territory, driverName, setDriverName]);

  // Clear the "suggested" marker the instant the field no longer holds
  // exactly the value this hook set — a manager editing (or clearing) an
  // auto-filled value must see it stop being marked as a guess immediately,
  // not keep reading "sugerido por historial" next to something they typed.
  useEffect(() => {
    if (isAutoFilled && driverName !== prefilledValue.current) {
      setIsAutoFilled(false);
    }
  }, [driverName, isAutoFilled]);

  return isAutoFilled;
}
