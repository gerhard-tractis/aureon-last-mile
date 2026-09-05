// apps/frontend/src/lib/dispatch/mobile/seal-error-copy.ts
//
// B2 (adversarial review of `2i`) — `POST /api/dispatch/routes/[id]/seal`
// refuses with several distinct codes (`seal-route.ts`:
// `UNSEALED_STOPS`/`EMPTY_ROUTE`/`ROUTE_NOT_OPEN`/`NOT_FOUND`/
// `QUERY_FAILED`/`FORCE_REASON_REQUIRED`), and `useSealRoute`'s own network
// catch reports `code: null` with its own message. Every one of them used
// to be discarded by `DispatchRouteScanSession`'s direct-close path — no
// `else` at all. This is the copy that refusal surfaces, mirroring
// `dispatch-review.ts`'s `dispatchErrorCopy`: distinct codes never
// flattened into one sentence, and the server's own `message` (which
// already names live figures — e.g. UNSEALED_STOPS's pending count) is
// trusted whenever it is sent, with fixed copy only as a fallback for the
// codes that carry none.
export interface SealErrorInfo {
  text: string;
  /** Whether "Cerrar ruta"/"Seguir escaneando" is still a sane next step —
   *  `false` for a route that is not open to closing at all (already
   *  sealed under someone else, not found, or in the wrong state). */
  retryable: boolean;
}

export function sealErrorCopy(code: string | null | undefined, message?: string | null): SealErrorInfo {
  switch (code) {
    case 'UNSEALED_STOPS':
      return { text: message || 'Quedan paradas sin estibar — seguí escaneando.', retryable: true };
    case 'EMPTY_ROUTE':
      return { text: message || 'No se puede cerrar una ruta sin paradas.', retryable: false };
    case 'ROUTE_NOT_OPEN':
      return {
        text: message || 'La ruta ya no se puede cerrar en su estado actual.',
        retryable: false,
      };
    case 'NOT_FOUND':
      return { text: 'No se encontró la ruta.', retryable: false };
    case 'QUERY_FAILED':
      return {
        text: message || 'No se pudo verificar la ruta — intentá de nuevo.',
        retryable: true,
      };
    case 'FORCE_REASON_REQUIRED':
      return {
        text: message || 'Se requiere un motivo para cerrar la ruta con paquetes sin cargar.',
        retryable: true,
      };
    default:
      // code === null covers useSealRoute's own network-failure branch,
      // which already sends a real message — trusted verbatim.
      return { text: message || 'No se pudo cerrar la ruta — intentá de nuevo.', retryable: true };
  }
}
