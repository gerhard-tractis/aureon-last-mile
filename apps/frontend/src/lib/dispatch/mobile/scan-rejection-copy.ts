// apps/frontend/src/lib/dispatch/mobile/scan-rejection-copy.ts
//
// spec-76 phase 4 (2f) — turns one failed `POST /api/dispatch/routes/[id]/scan`
// response into the copy 2f actually renders. Every code `validateScan`
// (lib/dispatch/scan-validator.ts) can return is handled — a code with no
// entry here would render a blank rejection card, which is worse than a
// slightly generic one.
//
// Decision 5 names four reasons: "ya está en otra ruta" (ALREADY_IN_ROUTE),
// "estado en_bodega — no pasó por andén" (NOT_ON_DOCK), "código no
// encontrado en este operador" (NOT_FOUND) and "retenido en consolidación"
// (IN_CONSOLIDATION).
//
// NOT_ON_DOCK's history: `DISPATCHABLE_STATUSES` used to include
// `en_bodega`, which made this reason unreachable — a scan of an `en_bodega`
// package was accepted, not rejected, matching neither decision 5 nor the
// dock-door "block-not-warn" norm this module now follows. Escalated during
// task 3's implementation and fixed at the source (scan-validator.ts):
// migration 20260817000003's own analysis notes `dock_zone_id IS NOT NULL
// AND status = 'en_bodega'` are "very nearly mutually exclusive" — the same
// trigger that writes `dock_zone_id` sets `status = 'sectorizado'` in one
// UPDATE, so `en_bodega` genuinely means "never sorted to an andén", not a
// state the crew could be holding. `en_bodega`'s presence in
// `DISPATCHABLE_STATUSES` was vestigial, not deliberate.
export const ALL_REJECTION_CODES = [
  'NOT_FOUND',
  'WRONG_STATUS',
  'ALREADY_IN_ROUTE',
  'ALREADY_STAGED',
  'IN_CONSOLIDATION',
  'QUERY_FAILED',
  'NOT_ON_DOCK',
] as const;

export type ScanRejectionCode = (typeof ALL_REJECTION_CODES)[number];

export interface ScanRejectionInput {
  code: ScanRejectionCode;
  message: string;
  /** 8-char route code (crew-board.ts's `routeCode`) of the route that
   *  already owns this package, when the API resolved it — only ever set
   *  for ALREADY_IN_ROUTE. */
  conflictingRouteCode?: string | null;
}

export interface ScanRejectionCopy {
  /** Large title shown on the rejected ScanResult card. */
  title: string;
  /** Short caps label for the "OTROS MOTIVOS DE RECHAZO" tally. */
  tallyLabel: string;
  /** One-line label for the inline "ÚLTIMAS LECTURAS" row, e.g. "YA EN
   *  RUT-0087" — shorter than `title`, which repeats the reason as a full
   *  sentence on the big card above it. */
  historyLabel: string;
  /** ALREADY_IN_ROUTE with a resolved route code — offers "Ver ruta", never
   *  an offer to move the package (decision 5: "no se mueve el paquete
   *  solo"). */
  canViewConflictingRoute: boolean;
}

const TALLY_LABEL: Record<ScanRejectionCode, string> = {
  NOT_FOUND: 'CÓDIGO NO ENCONTRADO',
  WRONG_STATUS: 'ESTADO NO VÁLIDO',
  ALREADY_IN_ROUTE: 'YA EN OTRA RUTA',
  ALREADY_STAGED: 'YA CARGADO',
  IN_CONSOLIDATION: 'RETENIDO EN CONSOLIDACIÓN',
  QUERY_FAILED: 'FALLO DE RED',
  NOT_ON_DOCK: 'NO PASÓ POR ANDÉN',
};

export function rejectionCopy(input: ScanRejectionInput): ScanRejectionCopy {
  const { code, message, conflictingRouteCode = null } = input;

  if (code === 'ALREADY_IN_ROUTE') {
    return {
      title: conflictingRouteCode ? `Ya está en otra ruta · ${conflictingRouteCode}` : 'Ya está en otra ruta',
      tallyLabel: TALLY_LABEL[code],
      historyLabel: conflictingRouteCode ? `YA EN ${conflictingRouteCode}` : TALLY_LABEL[code],
      canViewConflictingRoute: !!conflictingRouteCode,
    };
  }

  if (code === 'IN_CONSOLIDATION') {
    return {
      title: 'Retenido en consolidación',
      tallyLabel: TALLY_LABEL[code],
      historyLabel: TALLY_LABEL[code],
      canViewConflictingRoute: false,
    };
  }

  if (code === 'NOT_ON_DOCK') {
    return {
      title: 'Paquete en bodega — no pasó por andén',
      tallyLabel: TALLY_LABEL[code],
      historyLabel: TALLY_LABEL[code],
      canViewConflictingRoute: false,
    };
  }

  if (code === 'NOT_FOUND') {
    // Decision 5: "nunca revela si existe en otro operador" — the title
    // must not even gesture at that possibility.
    return {
      title: 'Código no encontrado en este operador',
      tallyLabel: TALLY_LABEL[code],
      historyLabel: TALLY_LABEL[code],
      canViewConflictingRoute: false,
    };
  }

  // WRONG_STATUS, ALREADY_STAGED, QUERY_FAILED — the server's own message
  // is already specific and correct; repeating it here (rather than a
  // second, hand-written paraphrase) is what keeps this file from drifting
  // out of sync with scan-validator.ts's actual copy.
  return { title: message, tallyLabel: TALLY_LABEL[code], historyLabel: TALLY_LABEL[code], canViewConflictingRoute: false };
}
