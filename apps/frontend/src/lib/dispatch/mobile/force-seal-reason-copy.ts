// apps/frontend/src/lib/dispatch/mobile/force-seal-reason-copy.ts
//
// spec-77 Fase 1 (UI) — Spanish labels for the SAME closed vocabulary
// `force-seal-reasons.ts` defines, never a second list: 2i's reason picker
// must offer exactly what `POST /seal` accepts, or the button can show a
// choice the server would reject.
import type { ForceSealReasonCode } from '@/lib/dispatch/force-seal-reasons';

export const FORCE_SEAL_REASON_LABELS: Record<ForceSealReasonCode, string> = {
  paquete_no_ubicado: 'No se ubicó el paquete',
  turno_terminado: 'Terminó el turno',
  vehiculo_lleno: 'El vehículo se llenó',
  paquete_dañado_en_anden: 'Paquete dañado en el andén',
  otro: 'Otro motivo',
};

/** Mirrors the endpoint's zod refinement (`route.ts`'s `bodySchema`):
 * only `otro` requires a non-empty note. */
export function requiresNote(reasonCode: ForceSealReasonCode): boolean {
  return reasonCode === 'otro';
}
