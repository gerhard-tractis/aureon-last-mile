// apps/frontend/src/lib/dispatch/mobile/dispatch-review.ts
//
// spec-77 Fase 2 — `2j`, "Despachar a DispatchTrack": pure copy/logic over
// what `POST /api/dispatch/routes/[id]/dispatch` (read in full before this
// file was written — see the endpoint's own comments, spec-79) actually
// does. This is the module's only irreversible action; nothing here may
// imply it can be undone.

/**
 * Decision 5 — the *Qué pasa al despachar* block names all four effects,
 * not a summary. Order matches the spec's own enumeration. The fourth line
 * is only true up to the moment DispatchTrack confirms (spec-77 H2/spec-79)
 * — that nuance is `2k`'s job (Fase 3, blocked), not this screen's; the
 * copy itself is unchanged per decision 5.
 */
export const DISPATCH_EFFECTS: readonly string[] = [
  'Se crean las paradas en DispatchTrack.',
  'Los paquetes pasan a en_ruta y la ruta a despachada.',
  'Después no se edita desde Aureon.',
  'Si el envío falla, nada cambia.',
];

/**
 * Item 10 — the reason is real, not a placeholder: the endpoint resolves
 * `truck_identifier` against `fleet_vehicles.external_vehicle_id` and
 * refuses with `422 VEHICLE_NOT_FOUND` when it does not exist; with no
 * vehicle assigned at all there is nothing to send in that field in the
 * first place. Named here so the same sentence backs both the disabled
 * button and, if the server ever disagrees, the surfaced refusal.
 */
export const NO_VEHICLE_REASON =
  'DispatchTrack exige el identificador del camión para crear la ruta. Asigná un camión antes de despachar.';

/** Item 10 — the one guard this screen owns client-side: no vehicle
 *  identifier, no dispatch attempt. */
export function canDispatch(vehicleExternalId: string | null): boolean {
  return !!vehicleExternalId;
}

export interface DispatchErrorInfo {
  text: string;
  /** Whether the primary action may be shown again as a safe retry. `false`
   *  does not mean the screen has nothing to say — see
   *  `DT_ACCEPTED_LOCAL_FAILED` below, which is a refusal with no safe
   *  retry from THIS phase (its recovery is `2k`, Fase 3, blocked). */
  retryable: boolean;
}

/**
 * The endpoint's response codes are distinct on purpose (spec-79's four
 * review rounds) and must not collapse into one generic "no se pudo
 * despachar" here. `2k` (Fase 3) owns the full recovery UI (checklist,
 * attempt counter); this only has to avoid mislabelling any of them.
 */
export function dispatchErrorCopy(code: string | null | undefined, message?: string | null): DispatchErrorInfo {
  switch (code) {
    case 'EMPTY_ROUTE':
      return { text: 'La ruta no tiene paradas para despachar.', retryable: false };
    case 'EMPTY_MANIFEST':
      return {
        text: message || 'Hay paradas sin bultos cargados; no se puede despachar.',
        retryable: false,
      };
    case 'MISSING_ORDER_NUMBER':
      return {
        text: message || 'Hay órdenes sin número de guía; no se puede despachar.',
        retryable: false,
      };
    case 'VEHICLE_NOT_FOUND':
      return { text: 'El camión indicado no existe en la flota.', retryable: false };
    case 'QUERY_FAILED':
      // 500 — a database fault before DispatchTrack was ever contacted.
      return {
        text: 'No se pudo verificar la ruta. DispatchTrack no fue contactado — podés reintentar.',
        retryable: true,
      };
    case 'DT_API_ERROR':
      // 502, DT rejected with a body — decision 6's first state. Retrying
      // is genuinely safe: nothing local changed.
      return { text: 'DispatchTrack rechazó el despacho. No se creó nada.', retryable: true };
    case 'DT_ACCEPTED_LOCAL_FAILED':
      // 502, DT accepted and the local write failed — decision 6's second
      // state. Never "Reintentar": a retry that skips straight to
      // completeLocalDispatch is the correct recovery, but naming it that
      // way and building it is `2k`'s job (Fase 3, blocked on spec-79).
      return {
        text: 'DispatchTrack ya recibió la ruta; falta completar el registro local. Avisá a tu jefe de turno.',
        retryable: false,
      };
    default:
      return { text: message || 'No se pudo despachar la ruta — intentá de nuevo.', retryable: true };
  }
}
