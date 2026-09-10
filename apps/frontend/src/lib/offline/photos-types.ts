/**
 * M-3, review del PR #712 (mayor) — extraído de `photos.ts`, que había
 * pasado de 265 a 402 líneas (límite del repo: 300) al cerrar B1-B3/M1-M2.
 * Tipos compartidos por el lado de encolar (`photos.ts`) y el de enviar
 * (`photos-send.ts`) — vivir en un tercer fichero evita que uno importe del
 * otro sólo para el tipo.
 */

export interface ManifestPhotoPayload {
  sheetNumber: number;
  // Índice compatible con `EnqueueInput.payload`/`PickupQueueEntry.payload`
  // (`Record<string, unknown>`, `queue.ts`) — sin esto, TS rechaza tanto
  // asignar este tipo a esa forma (al encolar) como el cast inverso (al leer
  // `entry.payload` en el drenador), porque un tipo sin índice no es
  // estructuralmente un `Record<string, unknown>`.
  [key: string]: unknown;
}

export interface EnqueueManifestPhotoInput {
  operatorId: string;
  userId: string;
  manifestId: string;
  /** Ver el docstring de `externalLoadId` en `PickupQueueEntry` (`@/lib/db`)
   * — ronda 4 de review del PR #725 (spec-81 fase 4). Opcional: no todo
   * llamador lo tiene a mano; sin él, el chip cae a una instrucción
   * genérica en vez de fingir una navegación inejecutable. */
  externalLoadId?: string;
  sheetNumber: number;
  blob: Blob;
}
