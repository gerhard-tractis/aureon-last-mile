'use client';

import { useState } from 'react';
import { PackagePlus } from 'lucide-react';
import {
  useTopupCandidates,
  useAcceptTopup,
  TopupAcceptError,
  type TopupCandidate,
} from '@/hooks/dispatch/useTopupCandidates';
import { PLAN_MANAGER_ROLES } from '@/lib/permissions';

/**
 * spec-73 phase 4b — the manager-facing surface phase 4 deliberately left
 * out: show an under-filled route its top-up candidates, and let a manager
 * accept one. Lives next to `RouteBlockList` in `RouteBuilder.tsx` — the
 * same screen `VehicleCapacityBar`'s under-fill signal is meant for.
 *
 * Non-Goals (strict, per spec-73): no map, no pin, no geocode, no
 * drag-and-drop, no route optimisation. This is a list with one button per
 * row — the manager reads a candidate and clicks "Aceptar", nothing more
 * automated than that.
 *
 * Render-nothing contract (mandatory, mirrors `VehicleCapacityBar`'s own
 * `configured: false -> null`): a route with no candidates, no configured
 * capacity, or no adjacency configured gets no widget at all — never a
 * "no suggestions available" message, which would misreport "capacity
 * never configured" as "nothing to top up". Loading, `eligible: false` for
 * ANY reason (ROUTE_NOT_LOADABLE, AT_MAX_DROPS, ALREADY_HAS_TOPUP), and
 * `eligible: true` with zero candidates all render null.
 *
 * A FAILED READ is the deliberate exception (review item 1). Silence there
 * would assert "there is nothing to suggest" when the true fact is "we
 * could not work out what to suggest" — the same class of defect phase 3's
 * review found in RouteBlockList, where a failed query became a confident
 * complete-looking verdict via `?? []`. A query error renders one muted
 * line and nothing else; it is not a blocking banner, because a manager can
 * still work the route without suggestions. A refusal banner likewise
 * outlives the row it refused, even after the invalidation empties the list.
 *
 * Role gate: `PLAN_MANAGER_ROLES` (defence in depth — the database is the
 * real gate, both at the GET route and inside accept_topup_block itself,
 * per the phase 4 review's security fix). A non-manager never even fires
 * the GET.
 */
interface Props {
  routeId: string;
  operatorId: string;
  role: string | null | undefined;
}

/**
 * The database refuses to guess — every one of these names a distinct
 * operational fact (spec's own framing: "the block is already loaded on
 * the donor's truck", "this route already borrowed one",
 * "accepting would exceed max_drops"). Collapsing any two of these into one
 * generic "Error al aceptar" throws away the entire point of the database
 * enforcing them as separate rules (Decision 5's six sub-rules, Decision 6).
 * Exported so a test can assert the mapping directly, one code at a time.
 */
export const TOPUP_ACCEPT_REFUSAL_MESSAGES: Record<string, string> = {
  BLOCK_ALREADY_STAGED:
    'Este bloque ya se está cargando en el camión de origen — ya no se puede trasladar por relleno.',
  OVER_TOPUP_CAP:
    'Este bloque supera el tope de relleno (aprox. 25% de la carga propia de esta ruta).',
  AT_MAX_DROPS:
    'Aceptar este bloque superaría el máximo de paradas configurado para esta ruta.',
  // The database refuses for ANY donor status outside ('planned','loading') —
  // 'draft' and 'cancelled' included, neither of which has a sealed manifest.
  // Naming the manifest as the cause would send the manager looking for a
  // seal that may never have happened, so this states only what is certain.
  DONOR_ROUTE_NOT_RAIDABLE:
    'La ruta de origen ya no admite préstamos — su estado cambió desde que se calculó esta sugerencia.',
  RECEIVING_ROUTE_NOT_LOADABLE:
    'Esta ruta ya no admite relleno — su estado actual no lo permite.',
  ALREADY_HAS_TOPUP: 'Esta ruta ya aceptó un bloque prestado — solo se admite uno por ruta.',
  BLOCK_NOT_FOUND: 'Ese bloque ya no existe en la ruta de origen — puede que ya haya sido movido.',
  // accept_topup_block raises this both for genuinely non-adjacent andenes
  // and when the RECEIVING route has no source andén at all
  // (`array_length(v_own_zones, 1) IS NULL`). One code, two facts — the copy
  // names both rather than pointing only at the adjacency table.
  NOT_ADJACENT:
    'Ese bloque ya no es adyacente al andén de esta ruta, o esta ruta no tiene andén de origen definido.',
  INVALID_TOPUP: 'La solicitud de relleno no es válida.',
  ROUTE_NOT_FOUND: 'No se encontró una de las rutas involucradas.',
  REASON_REQUIRED: 'Se requiere un motivo para aceptar el relleno.',
  FORBIDDEN: 'Solo un responsable puede aceptar un relleno de camión.',
};

const DEFAULT_REFUSAL_MESSAGE =
  'No se pudo aceptar el relleno — el estado pudo haber cambiado. Intenta de nuevo.';

export function topupRefusalMessage(code: string): string {
  return TOPUP_ACCEPT_REFUSAL_MESSAGES[code] ?? DEFAULT_REFUSAL_MESSAGE;
}

export function TopupSuggestions({ routeId, operatorId, role }: Props) {
  const canManage = !!role && (PLAN_MANAGER_ROLES as readonly string[]).includes(role);
  const { data, isLoading, isError } = useTopupCandidates(routeId, operatorId, canManage);
  const acceptMutation = useAcceptTopup(routeId, operatorId);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  // Defence in depth only — the GET route and accept_topup_block both gate
  // on PLAN_MANAGER_ROLES server-side. This keeps the widget from ever
  // rendering, or firing the request, for a role that could never act on it.
  if (!canManage) return null;

  // Loading, ineligible-for-any-reason, or genuinely zero candidates all
  // render nothing — see the render-nothing contract in the header comment.
  //
  // Review fix (item 1): a FAILED READ is deliberately NOT part of that
  // silence. "There is nothing to suggest" and "we could not work out what
  // to suggest" are different facts, and rendering both as an empty screen
  // asserts the first when the second is true — the same defect phase 3's
  // review found in RouteBlockList. Silence stays the default for every
  // legitimate empty state; only an actual query error says so, and quietly.
  const hasCandidates = !!data && data.eligible && data.candidates.length > 0;
  const readFailed = !!isError && !data;

  // Review fix: `refusal` is checked BEFORE the render-nothing guard. The
  // refusal invalidates the candidate list, and the refetch commonly returns
  // fewer rows — often zero, since the refused row is usually the stale one.
  // With the guard ahead of the banner, that unmounted the widget and took
  // the explanation with it: the manager was prompted for a reason and then
  // watched the screen go blank with no statement that anything was refused.
  if (isLoading || (!hasCandidates && !readFailed && !refusal)) {
    return null;
  }

  const handleAccept = (candidate: TopupCandidate) => {
    setRefusal(null);
    // Same reason-prompt pattern RouteBuilder.handleRemove already uses for
    // the donor-side audited removal this accept performs internally — one
    // convention for "why did a manager take something off a route's plan"
    // across the app, not a second UI for the same kind of action.
    const promptedReason = window.prompt(
      `Motivo para trasladar ${candidate.comunaName} desde la ruta ${candidate.donorExternalRouteId ?? candidate.donorRouteId} a esta ruta:`,
    );
    if (!promptedReason || !promptedReason.trim()) return;

    setAcceptingId(candidate.routeBlockId);
    acceptMutation.mutate(
      {
        donorRouteId: candidate.donorRouteId,
        comunaId: candidate.comunaId,
        reason: promptedReason.trim(),
      },
      {
        onError: (err) => {
          // A suggestion can go stale between render and accept — the
          // database re-checks every Decision 5/6 rule under lock and can
          // refuse for a reason true NOW but not true when this list was
          // fetched (someone else already accepted it, the donor started
          // loading, the route hit max_drops in the meantime). onSettled
          // below (in the hook) already refetches the list regardless of
          // outcome, so a refused suggestion never lingers on screen as if
          // still available or, worse, as if it had been accepted — the
          // list re-renders without it (or with an updated reason) once
          // the refetch lands.
          const code = err instanceof TopupAcceptError ? err.code : 'UNKNOWN';
          setRefusal(topupRefusalMessage(code));
        },
        onSettled: () => setAcceptingId(null),
      },
    );
  };

  return (
    <div className="shrink-0 border-b border-border bg-background">
      <div className="px-5 pt-2 flex items-center gap-1.5 text-[11px] text-text-muted uppercase tracking-[0.06em]">
        <PackagePlus size={12} />
        Sugerencias de relleno
      </div>

      {/* Copy discipline (spec Decision 4's overclaim warning, applied
          here): a suggestion, never an instruction — no "óptimo",
          "recomendado" or "mejor opción" language anywhere in this
          component. */}
      {hasCandidates && (
      <p className="px-5 pb-1 text-[11px] text-text-muted">
        Bloques de una ruta vecina que podrían agregarse a esta. Cada uno requiere
        confirmación manual y un traslado físico escaneado.
      </p>
      )}

      {refusal && (
        <div
          role="alert"
          className="mx-5 mb-2 rounded border border-status-error-border bg-status-error-bg px-3 py-2 text-xs text-status-error"
        >
          ⚠ {refusal}
        </div>
      )}

      {readFailed && (
        <div data-testid="topup-read-failed" className="px-5 pb-2 text-[11px] text-status-warning-text">
          No se pudieron cargar las sugerencias de relleno. Esto no significa que no haya ninguna.
        </div>
      )}

      <ul className="px-3 pb-2 space-y-1.5">
        {(hasCandidates ? data!.candidates : []).map((c) => (
          <li
            key={c.routeBlockId}
            className="flex flex-col gap-1.5 rounded border border-border bg-surface px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{c.comunaName}</span>
                <span className="text-text-muted">
                  {c.packageCount} bulto{c.packageCount === 1 ? '' : 's'}
                </span>
              </div>
              <div className="text-[11px] text-text-muted truncate">
                Ruta {c.donorExternalRouteId ?? c.donorRouteId.slice(0, 8)}
                {c.donorDriverName ? ` · ${c.donorDriverName}` : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleAccept(c)}
              // Review fix: route-wide, not per-row. `ALREADY_HAS_TOPUP` is a
              // one-shot ledger (Decision 5.4a) — a route borrows exactly one
              // block — so while ANY accept is in flight every other row must
              // be inert too, or a manager fires a second accept for the same
              // route and only learns it was wrong after the refusal lands.
              disabled={acceptingId !== null}
              className="shrink-0 rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
            >
              {acceptingId === c.routeBlockId ? 'Aceptando...' : 'Aceptar'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
