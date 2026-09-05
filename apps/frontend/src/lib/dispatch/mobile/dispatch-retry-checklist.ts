// apps/frontend/src/lib/dispatch/mobile/dispatch-retry-checklist.ts
//
// spec-77 Fase 3, item 15 — decision 6's "Antes de reintentar" checklist,
// shown ONLY for the `DT_API_ERROR` state (dispatch-review.ts's
// `showChecklist`), where a plain retry is genuinely safe. Pure formatting
// over data `useDispatchRetryChecklist.ts` fetches — this file owns no
// query of its own so it stays trivially testable.

export interface RetryChecklistStop {
  hasAddress: boolean;
  hasPhone: boolean;
}

export interface RetryChecklistInput {
  vehicleAssigned: boolean;
  driverAssigned: boolean;
  stops: readonly RetryChecklistStop[];
}

export interface RetryChecklist {
  verified: string[];
  warnings: string[];
}

function plural(n: number, singular: string, plural_: string): string {
  return n === 1 ? singular : plural_;
}

/**
 * Decision 6's own worked example: "verificado: camión y conductor
 * asignados, 24 paradas con dirección y teléfono; advertencia: 2 paradas
 * sin teléfono del receptor". A stop with an address but no phone counts
 * toward the warning, never toward the verified stop count — a checklist
 * that calls an incomplete stop "verified" is the thing decision 6 exists
 * to prevent.
 */
export function buildRetryChecklist(input: RetryChecklistInput): RetryChecklist {
  const { vehicleAssigned, driverAssigned, stops } = input;
  const verified: string[] = [];
  const warnings: string[] = [];

  if (vehicleAssigned && driverAssigned) {
    verified.push('Camión y conductor asignados');
  } else {
    warnings.push('Falta asignar camión o conductor.');
  }

  const complete = stops.filter((s) => s.hasAddress && s.hasPhone).length;
  const missingPhone = stops.filter((s) => s.hasAddress && !s.hasPhone).length;

  if (complete > 0) {
    verified.push(`${complete} ${plural(complete, 'parada', 'paradas')} con dirección y teléfono`);
  }
  if (missingPhone > 0) {
    warnings.push(
      `${missingPhone} ${plural(missingPhone, 'parada', 'paradas')} sin teléfono del receptor`,
    );
  }

  return { verified, warnings };
}
