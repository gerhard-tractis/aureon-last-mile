/**
 * spec-80 fase 1, fix round 2 (F3). close_manifest raises in English with a
 * sentinel prefix — the repo's own pattern for a Postgres error a client
 * needs to discriminate on (see app/api/dispatch/routes/[id]/blocks/route.ts:
 * `rpcError.code === 'P0002' && message.startsWith('ROUTE_NOT_FOUND')`).
 * complete/[loadId]/page.tsx is the first caller of that RPC to render the
 * raw message directly to an end user rather than mapping it in a Next.js
 * API route first — this is that mapping, done client-side instead.
 *
 * Unrecognized errors — cross-tenant "MANIFEST_NOT_FOUND", "NO_OPERATOR_IN_JWT"
 * (both now sentinel-prefixed too, spec-80 fase 1b, for consistency with the
 * rest of the RPC's errors and with record_discrepancies' equivalent causes)
 * — fall back to a generic message on purpose: those are anomalies the
 * operator cannot act on, not business-flow rejections worth explaining.
 */

const SENTINEL_MESSAGES: Record<string, string> = {
  MANIFEST_ALREADY_SIGNED:
    'Este manifiesto ya fue firmado. Actualiza la pantalla para ver el estado actual.',
  MANIFEST_NOT_CLOSABLE:
    'Este manifiesto no está listo para cerrarse. Verifica su estado en la lista de Recogida.',
  OPERATOR_SIGNATURE_REQUIRED: 'Falta tu firma. Fírmala antes de continuar.',
};

const FALLBACK_MESSAGE = 'No se pudo completar el manifiesto';

export function mapCloseManifestError(err: unknown): string {
  const rawMessage =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : '';

  const sentinel = Object.keys(SENTINEL_MESSAGES).find((prefix) =>
    rawMessage.startsWith(prefix)
  );

  return sentinel ? SENTINEL_MESSAGES[sentinel] : FALLBACK_MESSAGE;
}

/**
 * spec-81 fase 2, checklist item 5 — distingue la rama "sin conexión" del
 * rechazo de negocio irrecuperable. Vino de un hallazgo de la ronda 3 de
 * review de spec-80 fase 1: `mapCloseManifestError` daba **el mismo texto**
 * a un `TypeError: Failed to fetch` y a un `MANIFEST_NOT_CLOSABLE`, y en
 * ambos casos re-habilitaba el mismo botón. Un operario sin señal que
 * reintenta un rechazo de negocio indefinidamente no tiene forma de saber
 * que su caso es distinto — "encolar y seguir" (offline) contra "detente y
 * pide ayuda" (rechazo de negocio) necesitan mensajes y afordancias
 * distintos, no el mismo fallback.
 *
 * `offline`: un fallo de red. Hay DOS formas posibles, y hasta la ronda 1 de
 * review del PR #679 esta función solo reconocía una:
 *
 * 1. Un `TypeError` nativo lanzado directamente por `fetch()` — pasa por
 *    aquí cuando el caller no usa `supabase.rpc()` (o usa
 *    `{ shouldThrowOnError: true }`, que sí re-lanza).
 * 2. La forma que `supabase.rpc('close_manifest', …)` produce DE VERDAD:
 *    `postgrest-js@1.21.4` (`PostgrestBuilder.ts:218-229`) **captura** el
 *    rechazo de `fetch` y RESUELVE (nunca rechaza) con un objeto plano
 *    `{ message: "TypeError: Failed to fetch", details: stack, hint: '',
 *    code: '' }`. `complete/[loadId]/page.tsx:127` hace `if (error) throw
 *    error` sobre ESE objeto — así que lo que este módulo recibe en el
 *    99% de los casos reales es la forma 2, con forma de error de
 *    Postgrest (tiene `code`) pero `code` VACÍO, nunca un `TypeError`
 *    real. Tratar "tiene `code`" como sinónimo de "es un rechazo de
 *    negocio" (la implementación original) clasificaba esta forma como
 *    `business` siempre — cero cobertura real de la rama offline.
 *
 * Un `code` de Postgrest genuino (RLS, constraint, el propio
 * `close_manifest` con `RAISE EXCEPTION … USING ERRCODE`) SIEMPRE es un
 * SQLSTATE de 5 caracteres, nunca la cadena vacía — un `code === ''`
 * presente (no ausente) es por sí solo una señal segura de la forma 2, sin
 * necesidad de que el mensaje contenga ninguna palabra concreta.
 *
 * B4, ronda 1 de review del PR #679: el sender impone su propio
 * `AbortSignal.timeout(...)` sobre `supabase.rpc('close_manifest', …)`
 * (`offlineQueueSender.ts`) — el mismo catch-y-resuelve de postgrest-js que
 * produce la forma 2 para un fallo de red produce TAMBIÉN esta forma para un
 * abort deliberado: `code: ''`, pero con el `name` de una `DOMException` de
 * abort ("AbortError"/"TimeoutError" según el runtime), no las palabras
 * "fetch"/"network"/"load failed". Exigir esas palabras en el mensaje
 * (versión original de esta función) clasificaba un timeout propio como
 * `business` — por eso el único requisito es `code === ''`.
 *
 * Ronda 2 de review del PR #679 (fix round 2) — `business`/`dead` como
 * único destino no-offline resultó en dos bloqueantes:
 *
 * B1: el 409 `MANIFEST_ALREADY_SIGNED` (23505) es, según la propia migración
 * (`20260913000004:141`), "an idempotent 409" — el cierre YA se aplicó
 * (la respuesta se perdió en un túnel, o el propio `AbortSignal.timeout`
 * del sender la cortó). Tratarlo como rechazo de negocio irrecuperable
 * convierte un envío que SÍ funcionó en un manifiesto muerto para siempre
 * la primera vez que el drenador reintenta. Necesita su propio `kind`:
 * `idempotent` — "ya está aplicado", no "hay que reintentar" ni "hay que
 * matar".
 *
 * B2: todo lo demás caía a `business` → `dead` en el sender
 * (`offlineQueueSender.ts`), incluidos cuatro errores genuinamente
 * transitorios verificados contra el sender real: un JWT expirado tras una
 * noche offline (`PGRST301`), un 502 de Kong sin `code`, un
 * `statement timeout` (`57014`), un deadlock (`40P01`). Los cuatro son
 * recuperables reintentando y los cuatro mataban el manifiesto para
 * siempre. "Ante la duda, detenerse" es razonable para el botón
 * interactivo (el operario está mirando); es el valor por defecto
 * INSEGURO para un drenador de fondo, donde "detenerse" significa "nadie
 * se entera nunca" — B3 mitiga eso con una afordancia humana para `dead`,
 * pero eso no vuelve segura la sobre-clasificación de errores
 * recuperables como irrecuperables.
 *
 * `permanent`: reservado a lo que `close_manifest` declara explícitamente
 * irrecuperable — los cuatro sentinelas de abajo (`MANIFEST_NOT_CLOSABLE`,
 * `OPERATOR_SIGNATURE_REQUIRED`, y los dos cross-tenant `42501`,
 * `MANIFEST_NOT_FOUND`/`NO_OPERATOR_IN_JWT`). Ninguno de los cuatro se
 * arregla reintentando.
 *
 * `transient`: todo lo demás no-offline y no-idempotente, incluido lo
 * desconocido. Es el nuevo valor por defecto seguro para un drenador de
 * fondo — el default anterior (`business`/`dead` para cualquier cosa sin
 * reconocer) es exactamente lo que B2 corrige.
 */
export interface ClassifiedCloseManifestError {
  kind: 'offline' | 'idempotent' | 'permanent' | 'transient';
  message: string;
}

/**
 * B1 — el único rechazo de `close_manifest` cuyo significado real es "la
 * operación ya está aplicada", no "hay que reintentar" ni "hay que matar".
 */
const IDEMPOTENT_SENTINEL = 'MANIFEST_ALREADY_SIGNED';

/**
 * B2 — los únicos cuatro rechazos que `close_manifest`
 * (`20260913000004_spec80_close_manifest_acl_fix.sql`) declara
 * explícitamente irrecuperables: un manifiesto en estado no cerrable, una
 * firma de operador ausente, y los dos cross-tenant (`42501`) que la propia
 * función distingue por nombre. Cualquier otro rechazo — reconocido o no —
 * es `transient` a partir de esta ronda; el valor por defecto ya no es
 * "matar", es "reintentar".
 */
const PERMANENT_SENTINELS = [
  'MANIFEST_NOT_CLOSABLE',
  'OPERATOR_SIGNATURE_REQUIRED',
  'MANIFEST_NOT_FOUND',
  'NO_OPERATOR_IN_JWT',
];

const OFFLINE_MESSAGE =
  'Sin conexión. Tu firma se guardó en el dispositivo y el cierre se enviará solo al volver la señal.';

const FETCH_FAILURE_PATTERN = /fetch|network|load failed/i;

export function classifyCloseManifestError(err: unknown): ClassifiedCloseManifestError {
  const errObj = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : null;
  const code = errObj && 'code' in errObj ? String(errObj.code) : undefined;
  const rawMessage = errObj && 'message' in errObj ? String(errObj.message) : '';
  const hasSentinel = Object.keys(SENTINEL_MESSAGES).some((prefix) =>
    rawMessage.startsWith(prefix)
  );

  const isRealPostgrestError = code !== undefined && code !== '';

  // Forma 2: postgrest-js's fetch-catch fallback (network failure OR our own
  // AbortSignal.timeout firing) — an empty `code` PRESENT on the object.
  const looksLikeNetworkFallbackShape = code === '' && !hasSentinel;

  // Forma 1: a native TypeError/AbortError thrown directly (no Postgrest
  // shape at all — no `code` property present).
  const looksLikeNativeFetchThrow =
    !isRealPostgrestError &&
    code === undefined &&
    !hasSentinel &&
    err instanceof Error &&
    (err instanceof TypeError || FETCH_FAILURE_PATTERN.test(err.message));

  if (looksLikeNetworkFallbackShape || looksLikeNativeFetchThrow) {
    return { kind: 'offline', message: OFFLINE_MESSAGE };
  }

  if (rawMessage.startsWith(IDEMPOTENT_SENTINEL)) {
    return { kind: 'idempotent', message: mapCloseManifestError(err) };
  }

  const isPermanent = PERMANENT_SENTINELS.some((sentinel) => rawMessage.startsWith(sentinel));
  if (isPermanent) {
    return { kind: 'permanent', message: mapCloseManifestError(err) };
  }

  return { kind: 'transient', message: mapCloseManifestError(err) };
}
