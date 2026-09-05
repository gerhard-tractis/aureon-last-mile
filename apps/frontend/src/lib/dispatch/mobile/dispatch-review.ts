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

/**
 * Fase 3 (`2k`) — decision 6's own vocabulary for "what can the crew safely
 * do next": `retry` (nothing changed, safe — DT_API_ERROR only), `complete`
 * (DT already has the route; the only safe move is to finish the local
 * write, never call DT again), `verify` (we genuinely don't know what DT
 * has — the third state), `wait` (a concurrent attempt is already in
 * flight; nothing failed). `null` is a validation refusal from BEFORE the
 * dispatch attempt (EMPTY_ROUTE/EMPTY_MANIFEST/VEHICLE_NOT_FOUND/
 * MISSING_ORDER_NUMBER) — nothing here is retryable until the crew fixes
 * what's missing, so `2j` shows the refusal inline and never opens `2k`.
 */
export type DispatchErrorAction = 'retry' | 'complete' | 'verify' | 'wait' | null;

export interface DispatchErrorInfo {
  text: string;
  /** Whether the primary action may be shown again as a safe retry. Kept
   *  for callers that only care about "can I show a button at all" —
   *  `true` whenever `primaryAction` is non-null. */
  retryable: boolean;
  /** Item 13 — what did, or did not, change locally. Never claims DT
   *  rejected the route when it was never contacted (QUERY_FAILED), and
   *  never claims nothing changed when DT already has it
   *  (DT_ACCEPTED_LOCAL_FAILED). */
  whatChanged: string;
  primaryAction: DispatchErrorAction;
  primaryLabel: string | null;
  /** Decision 6 — the "Antes de reintentar" checklist is scoped to the ONE
   *  state where a plain retry is genuinely safe: DT_API_ERROR. */
  showChecklist: boolean;
}

function errorInfo(
  text: string,
  whatChanged: string,
  primaryAction: DispatchErrorAction,
  primaryLabel: string | null,
  showChecklist = false,
): DispatchErrorInfo {
  // `retryable` predates the `primaryAction` vocabulary and existing
  // callers (DispatchRouteDispatchReview's inline pre-`2k` refusals) still
  // read it as "does pressing the button again make sense at all" — true
  // for retry/verify/wait (a fresh attempt is a sane next step, even if
  // `verify` is decision 6's "degraded" framing of it), false only for
  // `complete` (retrying literally re-sends to DT — never offered) and the
  // validation refusals (`null` — nothing to retry until something is
  // fixed).
  const retryable = primaryAction === 'retry' || primaryAction === 'verify' || primaryAction === 'wait';
  return { text, whatChanged, primaryAction, primaryLabel, showChecklist, retryable };
}

const NOTHING_CHANGED_LOADED =
  'La ruta sigue en estado loaded y los paquetes cargados siguen en listo_para_despacho — no se llamó a DispatchTrack.';

/**
 * The endpoint's response codes are distinct on purpose (spec-79's five
 * review rounds) and must not collapse into one generic "no se pudo
 * despachar" here. `2k` (Fase 3) reads `primaryAction`/`showChecklist` to
 * decide what to render; `2j`'s pre-flight refusals (validation, before any
 * attempt to reach DispatchTrack) stay inline and never open `2k`.
 */
export function dispatchErrorCopy(code: string | null | undefined, message?: string | null): DispatchErrorInfo {
  switch (code) {
    case 'EMPTY_ROUTE':
      return errorInfo('La ruta no tiene paradas para despachar.', NOTHING_CHANGED_LOADED, null, null);
    case 'EMPTY_MANIFEST':
      return errorInfo(
        message || 'Hay paradas sin bultos cargados; no se puede despachar.',
        NOTHING_CHANGED_LOADED,
        null,
        null,
      );
    case 'MISSING_ORDER_NUMBER':
      return errorInfo(
        message || 'Hay órdenes sin número de guía; no se puede despachar.',
        NOTHING_CHANGED_LOADED,
        null,
        null,
      );
    case 'VEHICLE_NOT_FOUND':
      return errorInfo('El camión indicado no existe en la flota.', NOTHING_CHANGED_LOADED, null, null);
    case 'QUERY_FAILED':
      // 500 — a database fault before DispatchTrack was ever contacted.
      // Must never read as "DT rejected" — DT was never called.
      return errorInfo(
        'No se pudo verificar la ruta. DispatchTrack no fue contactado — podés reintentar.',
        NOTHING_CHANGED_LOADED,
        'retry',
        'Reintentar',
      );
    case 'DT_API_ERROR':
      // 502, DT rejected with a body — decision 6's first state. Retrying
      // is genuinely safe: nothing local changed. The one state that shows
      // the "Antes de reintentar" checklist.
      return errorInfo(
        'DispatchTrack rechazó el despacho. No se creó nada.',
        NOTHING_CHANGED_LOADED,
        'retry',
        'Reintentar',
        true,
      );
    case 'DT_ACCEPTED_LOCAL_FAILED':
      // 502, DT accepted and the local write failed — decision 6's second
      // state. Never "Reintentar": a retry that skips straight to
      // completeLocalDispatch (the endpoint's own confirmed-external-route
      // path, spec-79 phase 3) is the correct recovery — this screen's
      // "Completar".
      return errorInfo(
        'DispatchTrack ya recibió la ruta; falta completar el registro local. Avisá a tu jefe de turno.',
        'DispatchTrack ya tiene esta ruta creada — lo que falta es terminar de registrarla en Aureon, no volver a enviarla.',
        'complete',
        'Completar',
      );
    case 'DISPATCH_IN_PROGRESS':
      // 409 — spec-79 Fase 4's claim: another attempt (this device or
      // another) is mid-flight for this exact route. Self-heals in ~2
      // minutes via the claim's own staleness window. This is not a
      // failure — say so.
      return errorInfo(
        'Ya hay un intento de despacho en curso para esta ruta.',
        'Otro intento está en curso ahora mismo; nada se perdió. Se libera solo en unos minutos si ese intento no termina.',
        'wait',
        'Reintentar',
      );
    case 'RECONCILIATION_REQUIRED':
      // 409 — spec-79 Fase 4's GET pre-check came back ambiguous or failed.
      // The server refused to create a possible duplicate — decision 6's
      // third state, now backed by a real server signal instead of a bare
      // client-side timeout.
      return errorInfo(
        'No se pudo confirmar si esta ruta ya existe en DispatchTrack. Contactá soporte antes de reintentar.',
        'No sabemos si DispatchTrack alcanzó a recibir la ruta — la comprobación previa no pudo confirmarlo.',
        'verify',
        'Verificar',
      );
    default:
      // code === null covers useDispatchRouteToDT's own network-failure
      // branch (fetch threw or timed out) — decision 6's third state in
      // its original form: no response at all, so nothing here can claim
      // to know what DispatchTrack did.
      return errorInfo(
        message || 'No se pudo despachar la ruta — intentá de nuevo.',
        'No sabemos si DispatchTrack alcanzó a recibir la ruta — no llegó respuesta del servidor.',
        'verify',
        'Verificar',
      );
  }
}
