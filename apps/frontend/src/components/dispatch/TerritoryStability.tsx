'use client';
import type { TerritoryHistoryEntry } from '@/lib/dispatch/types';

interface Props {
  /** get_route_territory_history's result — one row per comuna THIS route
   * already has a live block for (see useRouteTerritoryHistory.ts). */
  territory: TerritoryHistoryEntry[];
  /** The driver name currently typed into RoutePanel's input — not yet
   * necessarily saved anywhere. */
  driverName: string;
  /**
   * Orders whose comuna has no live block yet (RouteBlocksResult.unblocked,
   * reason === 'orphan') — invisible to `territory` above. MANDATORY per
   * spec-72's "Notes for phases 4 and 5": surfaced here rather than left for
   * a manager to discover the check was incomplete.
   *
   * Phase-4 review item 4 (HIGH): `null` means the underlying blocks query
   * (`useRouteBlocks`, RouteBuilder.tsx) itself failed — the orphan count is
   * UNKNOWN, not zero. Rendering nothing in that case would show a
   * complete-looking territory answer while silently hiding that the check
   * could not run in full. `0` and `null` are deliberately distinct.
   */
  orphanCount: number | null;
  /**
   * True only for a `driverName` this component's sibling hook
   * (`useDriverPrefill`) itself set, never for anything a manager typed —
   * see that hook's own comment. Renders as "sugerido por historial" next
   * to the field so a manager can tell at a glance the system guessed;
   * disappears the moment the value is edited (the hook clears this itself).
   */
  isDriverSuggested?: boolean;
}

/**
 * spec-72 phase 4 (Decision 6) — the visible half of territory stability.
 *
 * Pre-filling `driverName` itself happens in RouteBuilder.tsx (it owns that
 * piece of state); this component only renders what Decision 6 asks the UI
 * to show once a value is already in the field:
 *
 *   - a warning per comuna where the current `driverName` diverges from the
 *     most recent non-cancelled driver on record for that comuna (name, and
 *     how many times they've run it) — "if the manager picks someone else,
 *     a visible warning explains what's being broken ... rather than
 *     silently letting the territory move."
 *   - the incomplete-manifest caveat: `territory` only ever covers comunas
 *     with a live `route_blocks` row, so an orphan order is invisible to
 *     the check above. Never silently absent.
 *   - the same caveat again, differently worded, when the orphan count
 *     itself could not be determined (`orphanCount === null`) — see review
 *     item 4.
 *
 * Phase-4 review item 3 (HIGH): the migration's run_count is an unweighted,
 * ALL-TIME count (see 20260903000006's header — no "recently" convention
 * exists elsewhere in this schema to time-box it against). The warning copy
 * says "en total", not "recientemente", so it never claims a recency the
 * data does not support.
 */
export function TerritoryStability({
  territory,
  driverName,
  orphanCount,
  isDriverSuggested = false,
}: Props) {
  const trimmedDriver = driverName.trim();
  const divergent = trimmedDriver
    ? territory.filter((t) => t.driverName !== trimmedDriver)
    : [];

  const orphanUnknown = orphanCount === null;
  const orphanKnownCount = orphanCount ?? 0;

  if (
    territory.length === 0 &&
    orphanKnownCount === 0 &&
    !orphanUnknown &&
    !isDriverSuggested
  ) {
    return null;
  }

  return (
    <div className="mt-2.5 space-y-1.5">
      {isDriverSuggested && (
        <div className="text-[11px] text-text-muted italic">sugerido por historial</div>
      )}
      {divergent.map((t) => (
        <div
          key={t.comunaId}
          className="flex items-start gap-1.5 rounded-md border border-status-warning-border bg-status-warning-bg px-2.5 py-1.5 text-[11px] text-status-warning-text"
        >
          <span aria-hidden>⚠</span>
          <span>
            Cambiando de conductor en <strong>{t.comunaName}</strong>: normalmente la
            maneja <strong>{t.driverName}</strong> ({t.runCount}{' '}
            {t.runCount === 1 ? 'vez' : 'veces'} en total).
          </span>
        </div>
      ))}
      {orphanUnknown && (
        <div className="flex items-start gap-1.5 rounded-md border border-status-error-border bg-status-error-bg px-2.5 py-1.5 text-[11px] text-status-error">
          <span aria-hidden>⚠</span>
          <span>
            No se pudo verificar si faltan paradas sin secuencia — este chequeo de
            territorio está incompleto.
          </span>
        </div>
      )}
      {!orphanUnknown && orphanKnownCount > 0 && (
        <div className="text-[11px] text-text-muted">
          {orphanKnownCount} parada{orphanKnownCount === 1 ? '' : 's'} aún sin secuencia
          asignada — no se {orphanKnownCount === 1 ? 'considera' : 'consideran'} en este
          chequeo de territorio.
        </div>
      )}
    </div>
  );
}
